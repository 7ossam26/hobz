import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import { PERMISSIONS, SUPER_ADMIN_ROLE } from '@/lib/rbac'
import { createRole, deleteRole, getRole, listRoles, updateRole } from '@/modules/role/service'

import {
  createRole as makeRole,
  createSuperAdminRole,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

async function manager() {
  await seedPermissionCatalog(db)
  const user = await createUserWithPermissions(db, ['role.manage', 'role.view'])
  return actorFor(db, user.id)
}

describe('modules/role — الدور المحجوز', () => {
  it('يمنع تعديل دور مدير النظام', async () => {
    const actor = await manager()
    const superAdmin = await createSuperAdminRole(db)

    await expect(
      updateRole(db, {
        actor,
        input: { id: superAdmin.id, nameAr: 'محاولة', permissions: [] },
      }),
    ).rejects.toMatchObject({ messageKey: 'roles.systemRoleLocked' })

    expect(
      (await db.role.findUniqueOrThrow({ where: { id: superAdmin.id } })).nameAr,
    ).toBe('مدير النظام')
  })

  it('يمنع حذف دور مدير النظام', async () => {
    const actor = await manager()
    const superAdmin = await createSuperAdminRole(db)

    await expect(deleteRole(db, { actor, id: superAdmin.id })).rejects.toMatchObject({
      messageKey: 'roles.systemRoleLocked',
    })

    expect(
      (await db.role.findUniqueOrThrow({ where: { id: superAdmin.id } })).deletedAt,
    ).toBeNull()
  })

  it('يمنع إنشاء دور بالمعرّف المحجوز', async () => {
    const actor = await manager()

    await expect(
      createRole(db, {
        actor,
        input: { nameAr: 'مزيّف', nameEn: SUPER_ADMIN_ROLE, permissions: [] },
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(await db.role.count({ where: { nameEn: SUPER_ADMIN_ROLE } })).toBe(0)
  })

  it('يمنع تعديل أي دور نظام آخر', async () => {
    const actor = await manager()
    const system = await makeRole(db, { nameEn: 'SYSTEM_THING', isSystem: true })

    await expect(
      updateRole(db, { actor, input: { id: system.id, nameAr: 'x', permissions: [] } }),
    ).rejects.toMatchObject({ messageKey: 'roles.systemRoleLocked' })
  })

  it('يعرض صلاحيات مدير النظام ضمنيًا لا مخزَّنة', async () => {
    // SPEC §2. The DB row has no RolePermission children; `getRole` reports the
    // whole catalog anyway, and `permissionCount` is null so the UI renders a
    // sentence rather than a number that would go stale next phase.
    await manager()
    const superAdmin = await createSuperAdminRole(db)

    expect(await db.rolePermission.count({ where: { roleId: superAdmin.id } })).toBe(0)

    const detail = await getRole(db, superAdmin.id)
    expect(detail.holdsAllPermissions).toBe(true)
    expect(detail.permissionCount).toBeNull()
    expect([...detail.permissions].sort()).toEqual([...PERMISSIONS].sort())

    const summary = (await listRoles(db)).find((r) => r.id === superAdmin.id)
    expect(summary?.permissionCount).toBeNull()
  })
})

describe('modules/role — دورة حياة الدور', () => {
  it('ينشئ دورًا بصلاحياته ويكتب سجل تدقيق', async () => {
    const actor = await manager()

    const role = await createRole(db, {
      actor,
      input: {
        nameAr: 'مدير مشروع',
        nameEn: 'PROJECT_MANAGER',
        permissions: ['project.view.all', 'task.assign'],
      },
    })

    expect(role.permissions.sort()).toEqual(['project.view.all', 'task.assign'])

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'role.created', entityId: role.id },
    })
    expect(audit.after).toMatchObject({
      nameEn: 'PROJECT_MANAGER',
      permissions: ['project.view.all', 'task.assign'],
    })
  })

  it('يرفض معرّفًا إنجليزيًا مستخدمًا بالفعل', async () => {
    const actor = await manager()
    await makeRole(db, { nameEn: 'DESIGNER' })

    await expect(
      createRole(db, {
        actor,
        input: { nameAr: 'مصمم آخر', nameEn: 'DESIGNER', permissions: [] },
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    expect(await db.role.count({ where: { nameEn: 'DESIGNER' } })).toBe(1)
  })

  it('يعيد إحياء دور محذوف ناعمًا بنفس المعرّف', async () => {
    // `nameEn` is unique at the database level, so a soft-deleted row still
    // owns the identifier. Failing with "taken" for a role the operator cannot
    // see would contradict what is on their screen.
    const actor = await manager()
    const dead = await makeRole(db, {
      nameEn: 'EDITOR',
      permissions: ['task.comment'],
      deletedAt: new Date('2026-01-01'),
    })

    const revived = await createRole(db, {
      actor,
      input: { nameAr: 'محرّر', nameEn: 'EDITOR', permissions: ['task.approve'] },
    })

    expect(revived.id).toBe(dead.id)
    expect(revived.permissions).toEqual(['task.approve'])
    expect(await db.role.count({ where: { nameEn: 'EDITOR' } })).toBe(1)
  })

  it('يستبدل مجموعة الصلاحيات كاملة عند التعديل', async () => {
    const actor = await manager()
    const role = await makeRole(db, {
      permissions: ['task.comment', 'task.approve'],
    })

    const updated = await updateRole(db, {
      actor,
      input: { id: role.id, nameAr: 'اسم جديد', permissions: ['payout.approve'] },
    })

    expect(updated.permissions).toEqual(['payout.approve'])
    expect(await db.rolePermission.count({ where: { roleId: role.id } })).toBe(1)
  })

  it('يميّز تغيير الصلاحيات عن مجرّد إعادة التسمية في السجل', async () => {
    // A permission change is the security-relevant event and must be findable
    // on its own, not buried among renames.
    const actor = await manager()
    const role = await makeRole(db, { permissions: ['task.comment'] })

    await updateRole(db, {
      actor,
      input: { id: role.id, nameAr: 'اسم آخر', permissions: ['task.comment'] },
    })
    await updateRole(db, {
      actor,
      input: { id: role.id, nameAr: 'اسم آخر', permissions: ['payout.approve'] },
    })

    const actions = await db.auditLog.findMany({
      where: { entityId: role.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    })
    expect(actions.map((a) => a.action)).toEqual(['role.updated', 'role.permissionsChanged'])
  })

  it('يمنع حذف دور مسنَد إلى مستخدمين', async () => {
    // Deleting it out from under its holders would strip their access with no
    // trace of why.
    const actor = await manager()
    const role = await makeRole(db, { nameEn: 'IN_USE' })
    await createUser(db, { roleIds: [role.id] })

    try {
      await deleteRole(db, { actor, id: role.id })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError)
      expect((error as ConflictError).messageKey).toBe('roles.inUse')
      expect(ar.roles.inUse).toBeTruthy()
    }

    expect(
      (await db.role.findUniqueOrThrow({ where: { id: role.id } })).deletedAt,
    ).toBeNull()
  })

  it('يحذف الدور ناعمًا لا نهائيًا', async () => {
    // CLAUDE.md invariant 8 / SPEC §2: soft-delete everywhere.
    const actor = await manager()
    const role = await makeRole(db, { nameEn: 'UNUSED' })

    await deleteRole(db, { actor, id: role.id })

    const row = await db.role.findUniqueOrThrow({ where: { id: role.id } })
    expect(row.deletedAt).not.toBeNull()
    expect((await listRoles(db)).map((r) => r.id)).not.toContain(role.id)
  })

  it('يخفي الأدوار المحذوفة عن القراءة بالمعرّف المباشر', async () => {
    await manager()
    const role = await makeRole(db, { deletedAt: new Date('2026-01-01') })
    await expect(getRole(db, role.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يعدّ المستخدمين المسنَد إليهم الدور', async () => {
    await manager()
    const role = await makeRole(db, { nameEn: 'COUNTED' })
    await createUser(db, { roleIds: [role.id] })
    await createUser(db, { roleIds: [role.id] })

    expect((await getRole(db, role.id)).memberCount).toBe(2)
  })
})
