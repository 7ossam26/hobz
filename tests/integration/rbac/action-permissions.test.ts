import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'
import { PERMISSIONS, type Permission } from '@/lib/rbac'

import {
  createRole,
  createSuperAdmin,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import {
  clearSessionActor,
  setSessionActor,
} from '../../helpers/session-mock'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const { createRoleAction, deleteRoleAction, updateRoleAction } = await import(
  '@/modules/role/actions'
)
const {
  activateUserAction,
  createUserAction,
  deactivateUserAction,
  resetUserPasswordAction,
  updateUserAction,
} = await import('@/modules/user/actions')

/**
 * The phase brief, verbatim:
 *
 *   "Integration: each server action called by a user lacking the permission
 *    must throw and must not mutate."
 *
 * Both halves are asserted for every action. The second half is the one worth
 * having: an action that throws *after* writing has still written, and no
 * amount of `expect(...).rejects` would notice. Every case snapshots the whole
 * relevant table before the call and compares afterwards.
 */

const db = testDb()

interface ActionCase {
  name: string
  permission: Permission
  /** Runs the action with a payload that WOULD succeed if permitted. */
  invoke: (fixtures: Fixtures) => Promise<unknown>
  /** Tables the action would touch if it got through. */
  watch: Array<'user' | 'role' | 'userRole' | 'rolePermission'>
}

interface Fixtures {
  targetUserId: string
  targetRoleId: string
  spareRoleId: string
}

const validUserPayload = (roleId: string) => ({
  username: 'new.person',
  password: 'a-sufficiently-long-password',
  fullName: 'شخص جديد',
  phone: '01012345678',
  isWorker: true,
  payType: 'PER_TASK' as const,
  defaultTaskRate: '400.00',
  weeklyCapacityHours: 40,
  roles: [roleId],
})

const ACTIONS: ActionCase[] = [
  {
    name: 'createUserAction',
    permission: 'user.create',
    invoke: (f) => createUserAction(validUserPayload(f.spareRoleId)),
    watch: ['user', 'userRole'],
  },
  {
    name: 'updateUserAction',
    permission: 'user.edit',
    invoke: (f) =>
      updateUserAction({
        id: f.targetUserId,
        fullName: 'اسم معدَّل',
        phone: '01112345678',
        isWorker: false,
        payType: 'PER_TASK',
        defaultTaskRate: '999.00',
        weeklyCapacityHours: 20,
        roles: [f.spareRoleId],
      }),
    watch: ['user', 'userRole'],
  },
  {
    name: 'deactivateUserAction',
    permission: 'user.deactivate',
    invoke: (f) => deactivateUserAction({ id: f.targetUserId }),
    watch: ['user'],
  },
  {
    name: 'activateUserAction',
    permission: 'user.deactivate',
    invoke: (f) => activateUserAction({ id: f.targetUserId }),
    watch: ['user'],
  },
  {
    name: 'resetUserPasswordAction',
    permission: 'user.resetPassword',
    invoke: (f) =>
      resetUserPasswordAction({
        id: f.targetUserId,
        newPassword: 'a-brand-new-password',
      }),
    watch: ['user'],
  },
  {
    name: 'createRoleAction',
    permission: 'role.manage',
    invoke: () =>
      createRoleAction({
        nameAr: 'دور جديد',
        nameEn: 'BRAND_NEW_ROLE',
        permissions: ['task.assign'],
      }),
    watch: ['role', 'rolePermission'],
  },
  {
    name: 'updateRoleAction',
    permission: 'role.manage',
    invoke: (f) =>
      updateRoleAction({
        id: f.targetRoleId,
        nameAr: 'دور معدَّل',
        permissions: ['payout.approve'],
      }),
    watch: ['role', 'rolePermission'],
  },
  {
    name: 'deleteRoleAction',
    permission: 'role.manage',
    invoke: (f) => deleteRoleAction({ id: f.targetRoleId }),
    watch: ['role'],
  },
]

async function snapshot(tables: ActionCase['watch']) {
  const out: Record<string, unknown> = {}
  for (const table of tables) {
    if (table === 'user') {
      out.user = await db.user.findMany({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          username: true,
          fullName: true,
          phone: true,
          isWorker: true,
          isActive: true,
          mustChangePassword: true,
          passwordHash: true,
          defaultTaskRate: true,
          weeklyCapacityHours: true,
          deletedAt: true,
        },
      })
    }
    if (table === 'role') {
      out.role = await db.role.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, nameAr: true, nameEn: true, isSystem: true, deletedAt: true },
      })
    }
    if (table === 'userRole') {
      out.userRole = await db.userRole.findMany({
        orderBy: [{ userId: 'asc' }, { roleId: 'asc' }],
      })
    }
    if (table === 'rolePermission') {
      out.rolePermission = await db.rolePermission.findMany({
        orderBy: [{ roleId: 'asc' }, { permissionKey: 'asc' }],
      })
    }
  }
  return JSON.parse(JSON.stringify(out)) as unknown
}

async function fixtures(): Promise<Fixtures> {
  await seedPermissionCatalog(db)
  const targetRole = await createRole(db, { permissions: ['task.comment'] })
  const spareRole = await createRole(db, { nameEn: 'SPARE_ROLE' })
  const target = await createUser(db, { username: 'target.user' })
  return {
    targetUserId: target.id,
    targetRoleId: targetRole.id,
    spareRoleId: spareRole.id,
  }
}

beforeEach(() => {
  clearSessionActor()
})

describe('الصلاحيات — كل إجراء يرفض من لا يملكه', () => {
  for (const action of ACTIONS) {
    it(`يرفض ${action.name} ولا يغيّر أي صف`, async () => {
      const f = await fixtures()

      // A real, signed-in user who simply lacks this one permission — not an
      // anonymous request. The interesting failure is the authenticated user
      // reaching an action they were never meant to reach.
      const other = PERMISSIONS.find((p) => p !== action.permission)!
      const stranger = await createUserWithPermissions(db, [other], {
        username: 'stranger',
      })
      setSessionActor(await actorFor(db, stranger.id))

      const before = await snapshot(action.watch)

      await expect(action.invoke(f)).rejects.toBeInstanceOf(ForbiddenError)

      expect(await snapshot(action.watch)).toEqual(before)
    })

    it(`يرفض ${action.name} لمستخدم بلا أي صلاحية`, async () => {
      const f = await fixtures()
      const nobody = await createUser(db, { username: 'nobody.user' })
      setSessionActor(await actorFor(db, nobody.id))

      const before = await snapshot(action.watch)
      await expect(action.invoke(f)).rejects.toBeInstanceOf(ForbiddenError)
      expect(await snapshot(action.watch)).toEqual(before)
    })

    it(`يرفض ${action.name} لمستخدم غير مسجَّل`, async () => {
      const f = await fixtures()
      clearSessionActor()

      const before = await snapshot(action.watch)

      // Unauthenticated must read as "sign in", not "forbidden" — the UI shows
      // a different recovery path for each.
      await expect(action.invoke(f)).rejects.toBeInstanceOf(UnauthenticatedError)

      expect(await snapshot(action.watch)).toEqual(before)
    })

    it(`يسمح ${action.name} لصاحب الصلاحية`, async () => {
      // The mirror image. Without it, an action that threw for *everyone* would
      // pass every denial test above and look perfectly secure.
      const f = await fixtures()
      const permitted = await createUserWithPermissions(
        db,
        [action.permission, 'role.view', 'user.view'],
        { username: 'permitted.user' },
      )
      setSessionActor(await actorFor(db, permitted.id))

      await expect(action.invoke(f)).resolves.not.toThrow()
    })

    it(`يسمح ${action.name} لمدير النظام دون تخزين المفتاح`, async () => {
      // SPEC §2: SUPER_ADMIN holds every permission implicitly, including ones
      // added in future phases.
      const f = await fixtures()
      const admin = await createSuperAdmin(db, { username: 'root.admin' })
      const actor = await actorFor(db, admin.id)
      expect(actor.permissions.size).toBe(0)
      expect(actor.isSuperAdmin).toBe(true)
      setSessionActor(actor)

      await expect(action.invoke(f)).resolves.not.toThrow()
    })
  }
})

describe('الصلاحيات — تغطية الإجراءات', () => {
  it('يغطّي كل إجراء خادم يكتب في هذه المرحلة', async () => {
    // A guard against the quiet failure mode of a table-driven suite: someone
    // adds an action and forgets to add it here, and the "every action is
    // checked" claim silently stops being true.
    const modules = await Promise.all([
      import('@/modules/role/actions'),
      import('@/modules/user/actions'),
    ])

    const exported = modules
      .flatMap((m) => Object.keys(m))
      .filter((name) => name.endsWith('Action'))
      .sort()

    expect(exported).toEqual(ACTIONS.map((a) => a.name).sort())
  })
})
