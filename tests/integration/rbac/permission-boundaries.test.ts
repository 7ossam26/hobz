import { describe, expect, it, vi } from 'vitest'

import { resolveActor } from '@/lib/auth/resolve'
import { ForbiddenError } from '@/lib/errors'
import { SUPER_ADMIN_ROLE, can } from '@/lib/rbac'

import {
  createRole,
  createSuperAdmin,
  createSuperAdminRole,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

/**
 * Stubs the Auth.js token round trip, and nothing else.
 *
 * `setImpersonation` re-mints the JWT, which pulls in NextAuth and therefore
 * `next/server` — a module that does not resolve in a plain Vitest process.
 * Every guard this file actually asserts (SUPER_ADMIN only, no nesting, no
 * self, no disabled target) runs in the action *before* this call, so stubbing
 * it removes the framework without removing anything under test. The token
 * minting itself is covered by the Playwright flow.
 */
vi.mock('@/lib/auth/impersonation', () => ({
  setImpersonation: vi.fn(),
  refreshSessionToken: vi.fn(),
}))

const { updateUserAction } = await import('@/modules/user/actions')
const { updateRoleAction } = await import('@/modules/role/actions')
const { startImpersonationAction } = await import('@/modules/impersonation/actions')

const db = testDb()

/**
 * docs/TESTING.md §4 axis 4, the cases that only a real database can express:
 * what happens when the permission set *changes underneath a session*, and
 * whether any action can be used to widen the permissions its own caller holds.
 */

/**
 * Shaped like what the form actually posts — empty strings for the untouched
 * optional fields, not the `null`s the *parsed* type carries. Actions parse raw
 * input, so a payload built from the post-parse shape would fail validation
 * before ever reaching the guard under test.
 */
const userPayload = (id: string, roles: string[]) => ({
  id,
  fullName: 'اسم',
  phone: '',
  isWorker: true,
  payType: 'PER_TASK' as const,
  monthlySalary: '',
  defaultTaskRate: '500.00',
  weeklyCapacityHours: 40,
  penaltyProfileId: '',
  roles,
})

describe('الصلاحيات — التغيير أثناء الجلسة', () => {
  it('يفقد المستخدم الصلاحية فور سحبها من دوره', async () => {
    // The reason `getActor` re-reads from the database on every call instead of
    // trusting the JWT's copy: a revoke that only takes effect at next sign-out
    // is not a revoke.
    await seedPermissionCatalog(db)
    const role = await createRole(db, { permissions: ['user.edit', 'user.view'] })
    const user = await createUser(db, { roleIds: [role.id] })

    expect(can(await actorFor(db, user.id), 'user.edit')).toBe(true)

    await db.rolePermission.delete({
      where: { roleId_permissionKey: { roleId: role.id, permissionKey: 'user.edit' } },
    })

    const after = await actorFor(db, user.id)
    expect(can(after, 'user.edit')).toBe(false)
    expect(can(after, 'user.view')).toBe(true)
  })

  it('يكتسب المستخدم الصلاحية فور منحها لدوره', async () => {
    await seedPermissionCatalog(db)
    const role = await createRole(db, { permissions: [] })
    const user = await createUser(db, { roleIds: [role.id] })

    expect(can(await actorFor(db, user.id), 'audit.view')).toBe(false)

    await db.rolePermission.create({
      data: { roleId: role.id, permissionKey: 'audit.view' },
    })

    expect(can(await actorFor(db, user.id), 'audit.view')).toBe(true)
  })

  it('يفقد المستخدم الصلاحية فور نزع الدور عنه', async () => {
    await seedPermissionCatalog(db)
    const role = await createRole(db, { permissions: ['payout.approve'] })
    const user = await createUser(db, { roleIds: [role.id] })

    expect(can(await actorFor(db, user.id), 'payout.approve')).toBe(true)

    await db.userRole.delete({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
    })

    expect(can(await actorFor(db, user.id), 'payout.approve')).toBe(false)
  })

  it('يحتفظ بالصلاحية إن منحها دور ثانٍ', async () => {
    // Union semantics against real rows: removing one of two granting roles
    // must not remove the permission.
    await seedPermissionCatalog(db)
    const first = await createRole(db, { nameEn: 'FIRST', permissions: ['task.approve'] })
    const second = await createRole(db, {
      nameEn: 'SECOND',
      permissions: ['task.approve', 'task.assign'],
    })
    const user = await createUser(db, { roleIds: [first.id, second.id] })

    await db.userRole.delete({
      where: { userId_roleId: { userId: user.id, roleId: first.id } },
    })

    const actor = await actorFor(db, user.id)
    expect(can(actor, 'task.approve')).toBe(true)
    expect(can(actor, 'task.assign')).toBe(true)
  })
})

describe('الصلاحيات — منع تصعيد الامتيازات', () => {
  it('يمنع من يملك تعديل المستخدمين من منح نفسه دور مدير النظام', async () => {
    // The escalation path worth closing: `user.edit` is the power to assign
    // roles, and without a guard it is transitively the power to assign the one
    // role that holds every permission implicitly — to yourself.
    await seedPermissionCatalog(db)
    const superRole = await createSuperAdminRole(db)
    await createSuperAdmin(db, { username: 'the.real.admin' })

    const editor = await createUserWithPermissions(db, ['user.edit'], {
      username: 'ambitious.editor',
    })
    setSessionActor(await actorFor(db, editor.id))

    await expect(
      updateUserAction(userPayload(editor.id, [superRole.id])),
    ).rejects.toMatchObject({ messageKey: 'users.superAdminRoleRestricted' })

    const after = await actorFor(db, editor.id)
    expect(after.isSuperAdmin).toBe(false)
  })

  it('يمنع منح دور مدير النظام لمستخدم آخر', async () => {
    await seedPermissionCatalog(db)
    const superRole = await createSuperAdminRole(db)
    await createSuperAdmin(db, { username: 'the.real.admin' })

    const editor = await createUserWithPermissions(db, ['user.edit'], {
      username: 'editor',
    })
    const target = await createUser(db, { username: 'target' })
    setSessionActor(await actorFor(db, editor.id))

    await expect(
      updateUserAction(userPayload(target.id, [superRole.id])),
    ).rejects.toMatchObject({ messageKey: 'users.superAdminRoleRestricted' })

    expect((await actorFor(db, target.id)).isSuperAdmin).toBe(false)
  })

  it('يسمح لمدير النظام وحده بمنح دور مدير النظام', async () => {
    await seedPermissionCatalog(db)
    const superRole = await createSuperAdminRole(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const target = await createUser(db, { username: 'target' })

    setSessionActor(await actorFor(db, admin.id))
    await updateUserAction(userPayload(target.id, [superRole.id]))

    expect((await actorFor(db, target.id)).isSuperAdmin).toBe(true)
  })

  it('يمنع نزع دور مدير النظام عن مستخدم بواسطة غير مدير نظام', async () => {
    // The mirror image, and just as important: a mere editor must not be able
    // to demote the administrators and take over an empty product.
    await seedPermissionCatalog(db)
    const superRole = await createSuperAdminRole(db)
    const admin = await createSuperAdmin(db, { username: 'root' })

    const editor = await createUserWithPermissions(db, ['user.edit'], {
      username: 'editor',
    })
    setSessionActor(await actorFor(db, editor.id))

    await expect(updateUserAction(userPayload(admin.id, []))).rejects.toMatchObject({
      messageKey: 'users.superAdminRoleRestricted',
    })

    expect((await actorFor(db, admin.id)).isSuperAdmin).toBe(true)
    expect(superRole.nameEn).toBe(SUPER_ADMIN_ROLE)
  })

  it('يترك تعديل الأدوار العادية متاحًا لصاحب الصلاحية', async () => {
    // The guard must be narrow. Blocking every role change would make
    // `user.edit` useless.
    await seedPermissionCatalog(db)
    await createSuperAdminRole(db)
    const ordinary = await createRole(db, { nameEn: 'ORDINARY' })

    const editor = await createUserWithPermissions(db, ['user.edit'], {
      username: 'editor',
    })
    const target = await createUser(db, { username: 'target' })
    setSessionActor(await actorFor(db, editor.id))

    await updateUserAction(userPayload(target.id, [ordinary.id]))

    const roles = await db.userRole.findMany({ where: { userId: target.id } })
    expect(roles.map((r) => r.roleId)).toEqual([ordinary.id])
  })

  it('يمنع صاحب إدارة الأدوار من إضافة صلاحيات إلى دور النظام', async () => {
    // Already covered at the service level; asserted here through the action so
    // the whole stack is on record.
    await seedPermissionCatalog(db)
    const superRole = await createSuperAdminRole(db)
    const manager = await createUserWithPermissions(db, ['role.manage'], {
      username: 'role.manager',
    })
    setSessionActor(await actorFor(db, manager.id))

    await expect(
      updateRoleAction({ id: superRole.id, nameAr: 'محاولة', permissions: [] }),
    ).rejects.toMatchObject({ messageKey: 'roles.systemRoleLocked' })
  })
})

describe('الصلاحيات — حدود العرض كمستخدم آخر', () => {
  it('لا يمنح العرض كمستخدم آخر صلاحيات المنتحِل', async () => {
    // The impersonated actor's permissions govern. If the impersonator's set
    // leaked through, "عرض كـ" would show the admin what the admin can do —
    // which is the one thing it must not do.
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const worker = await createUserWithPermissions(db, ['task.comment'], {
      username: 'worker',
    })

    const impersonating = (await resolveActor(db, worker.id, {
      impersonator: { id: admin.id, fullName: 'مدير النظام' },
    }))!.actor

    setSessionActor(impersonating)

    // The admin could do this as themselves; as the worker they cannot.
    await expect(
      updateRoleAction({ id: 'anything', nameAr: 'x', permissions: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('يمنع المستخدم المعروض من بدء عرض جديد', async () => {
    // Nesting would make "who did this" unanswerable, so it is refused even
    // when the impersonated user happens to hold `user.impersonate`.
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const target = await createUserWithPermissions(db, ['user.impersonate'], {
      username: 'target',
    })
    const third = await createUser(db, { username: 'third' })

    const impersonating = (await resolveActor(db, target.id, {
      impersonator: { id: admin.id, fullName: 'مدير النظام' },
    }))!.actor
    setSessionActor(impersonating)

    await expect(
      startImpersonationAction({ userId: third.id }),
    ).rejects.toMatchObject({ messageKey: 'impersonation.notAllowed' })
  })

  it('يمنع من يحمل صلاحية العرض دون أن يكون مدير نظام', async () => {
    // The phase brief says SUPER_ADMIN *only*. Holding the catalog permission
    // is necessary and not sufficient — a role could be granted it by mistake.
    await seedPermissionCatalog(db)
    const pretender = await createUserWithPermissions(db, ['user.impersonate'], {
      username: 'pretender',
    })
    const target = await createUser(db, { username: 'target' })
    setSessionActor(await actorFor(db, pretender.id))

    await expect(
      startImpersonationAction({ userId: target.id }),
    ).rejects.toMatchObject({ messageKey: 'impersonation.notAllowed' })
  })

  it('يمنع العرض بحساب معطّل', async () => {
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const disabled = await createUser(db, { username: 'disabled', isActive: false })
    setSessionActor(await actorFor(db, admin.id))

    await expect(
      startImpersonationAction({ userId: disabled.id }),
    ).rejects.toMatchObject({ messageKey: 'impersonation.cannotImpersonateInactive' })
  })

  it('يمنع العرض بحساب المستخدم نفسه', async () => {
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    setSessionActor(await actorFor(db, admin.id))

    await expect(
      startImpersonationAction({ userId: admin.id }),
    ).rejects.toMatchObject({ messageKey: 'impersonation.cannotImpersonateSelf' })
  })

  it('يمنع غير المسجَّل من بدء العرض', async () => {
    await seedPermissionCatalog(db)
    const target = await createUser(db)
    clearSessionActor()

    await expect(startImpersonationAction({ userId: target.id })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
  })
})
