import { describe, expect, it } from 'vitest'

import { ConflictError } from '@/lib/errors'
import { deleteRole, getRole, listRoles } from '@/modules/role/service'

import {
  createRole as makeRole,
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

/**
 * docs/TESTING.md §4 axis 11, the half that is not about hiding rows but about
 * the *counts derived from them*.
 *
 * A soft-deleted user is invisible everywhere — which means a count that still
 * includes them is not merely cosmetic. `deleteRole` refuses when the member
 * count is above zero, so an over-counting `memberCount` turns into "this role
 * can never be deleted, and the screen will not tell you why".
 */

describe('الحذف الناعم — عدّاد أعضاء الدور', () => {
  it('لا يحتسب المستخدم المحذوف ضمن أعضاء الدور', async () => {
    await manager()
    const role = await makeRole(db, { nameEn: 'HAUNTED' })
    await createUser(db, { roleIds: [role.id], deletedAt: new Date('2026-01-01') })

    expect((await getRole(db, role.id)).memberCount).toBe(0)
    expect((await listRoles(db)).find((r) => r.id === role.id)?.memberCount).toBe(0)
  })

  it('يسمح بحذف دور لم يبق له إلا أعضاء محذوفون', async () => {
    // The consequence of the count above. Without it, deleting a departed
    // employee permanently strands the role they held.
    const actor = await manager()
    const role = await makeRole(db, { nameEn: 'STRANDED' })
    await createUser(db, { roleIds: [role.id], deletedAt: new Date('2026-01-01') })

    await deleteRole(db, { actor, id: role.id })

    expect(
      (await db.role.findUniqueOrThrow({ where: { id: role.id } })).deletedAt,
    ).not.toBeNull()
  })

  it('يظل يمنع حذف دور له عضو نشط واحد على الأقل', async () => {
    // The guard must not be loosened into uselessness by the fix above.
    const actor = await manager()
    const role = await makeRole(db, { nameEn: 'STILL_HELD' })
    await createUser(db, { roleIds: [role.id], deletedAt: new Date('2026-01-01') })
    await createUser(db, { roleIds: [role.id] })

    await expect(deleteRole(db, { actor, id: role.id })).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect((await getRole(db, role.id)).memberCount).toBe(1)
  })

  it('يحتسب المستخدم المعطَّل غير المحذوف ضمن الأعضاء', async () => {
    // Deactivated is not deleted. The account still exists, still holds the
    // role, and can be switched back on — so removing the role from under it
    // would be a silent change nobody asked for.
    const actor = await manager()
    const role = await makeRole(db, { nameEn: 'HELD_BY_DISABLED' })
    await createUser(db, { roleIds: [role.id], isActive: false })

    expect((await getRole(db, role.id)).memberCount).toBe(1)
    await expect(deleteRole(db, { actor, id: role.id })).rejects.toBeInstanceOf(
      ConflictError,
    )
  })
})

describe('الحذف الناعم — قوائم الأدوار', () => {
  it('يخفي الدور المحذوف عن القائمة ويُبقي غيره', async () => {
    await manager()
    const live = await makeRole(db, { nameEn: 'LIVE' })
    const dead = await makeRole(db, {
      nameEn: 'DEAD',
      deletedAt: new Date('2026-01-01'),
    })

    const ids = (await listRoles(db)).map((r) => r.id)
    expect(ids).toContain(live.id)
    expect(ids).not.toContain(dead.id)
  })

  it('لا يحتسب صلاحيات الدور المحذوف في أي عدّاد', async () => {
    await manager()
    const dead = await makeRole(db, {
      nameEn: 'DEAD_WITH_PERMS',
      permissions: ['payout.approve', 'user.create'],
      deletedAt: new Date('2026-01-01'),
    })

    // The RolePermission rows survive — history, not grants — but the role is
    // absent from every listing that could imply they still apply.
    expect(await db.rolePermission.count({ where: { roleId: dead.id } })).toBe(2)
    expect((await listRoles(db)).map((r) => r.id)).not.toContain(dead.id)
  })
})
