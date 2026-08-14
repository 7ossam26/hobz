import { describe, expect, it } from 'vitest'

import { ConflictError, NotFoundError } from '@/lib/errors'
import type { OpenTaskLookup } from '@/modules/user/open-tasks'
import { activateUser, deactivateUser } from '@/modules/user/service'

import {
  createSuperAdmin,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor, maybeActorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * The phase brief: "Deactivation is BLOCKED while the user has open tasks —
 * return a clear Arabic error listing them."
 *
 * `Task` is a Phase 4 table, so the *lookup* is injected (see
 * `modules/user/open-tasks.ts`). The rule itself ships now and is tested now,
 * against a lookup that returns real tasks. When Phase 4 replaces the lookup
 * with a query, every assertion below keeps its meaning.
 */

const withOpenTasks =
  (tasks: Array<{ id: string; title: string }>): OpenTaskLookup =>
  async () =>
    tasks

describe('modules/user — منع التعطيل مع وجود مهام مفتوحة', () => {
  it('يمنع التعطيل ويسمّي المهام المفتوحة', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUser(db, { username: 'busy.worker' })

    const open = [
      { id: 't1', title: 'تصميم الهوية البصرية' },
      { id: 't2', title: 'حملة رمضان' },
    ]

    try {
      await deactivateUser(db, {
        actor: await actorFor(db, admin.id),
        id: worker.id,
        openTasks: withOpenTasks(open),
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError)
      // The message key resolves to the Arabic sentence; the task list travels
      // in `details` so the UI can name them rather than say "there are some".
      expect((error as ConflictError).messageKey).toBe('users.hasOpenTasks')
      expect((error as ConflictError).details?.tasks).toEqual(open)
    }

    // The account is untouched — this is the half that matters.
    expect((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).isActive).toBe(
      true,
    )
  })

  it('لا يكتب سجل تدقيق عند منع التعطيل', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUser(db)

    await expect(
      deactivateUser(db, {
        actor: await actorFor(db, admin.id),
        id: worker.id,
        openTasks: withOpenTasks([{ id: 't1', title: 'مهمة' }]),
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    expect(await db.auditLog.count({ where: { action: 'user.deactivated' } })).toBe(0)
  })

  it('يسمح بالتعطيل حين لا توجد مهام مفتوحة ويكتب سجل تدقيق', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUser(db)

    await deactivateUser(db, {
      actor: await actorFor(db, admin.id),
      id: worker.id,
      openTasks: withOpenTasks([]),
    })

    expect((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).isActive).toBe(
      false,
    )

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.deactivated', entityId: worker.id },
    })
    expect(audit.actorId).toBe(admin.id)
    expect(audit.before).toEqual({ isActive: true })
    expect(audit.after).toEqual({ isActive: false })
  })

  it('يستخدم البحث الافتراضي حين لا يُمرَّر بحث', async () => {
    // Phase 1's implementation answers "none", which is the honest answer for a
    // database with no `tasks` table. Phase 4 replaces it with one query.
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUser(db)

    await deactivateUser(db, { actor: await actorFor(db, admin.id), id: worker.id })
    expect((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).isActive).toBe(
      false,
    )
  })
})

describe('modules/user — حماية الحسابات الحرجة', () => {
  it('يمنع المستخدم من تعطيل حسابه', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])

    await expect(
      deactivateUser(db, { actor: await actorFor(db, admin.id), id: admin.id }),
    ).rejects.toMatchObject({ messageKey: 'users.cannotDeactivateSelf' })

    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive).toBe(
      true,
    )
  })

  it('يمنع تعطيل آخر مدير نظام نشط', async () => {
    // Not a state the UI should be able to reach, whatever the operator meant
    // to click: it would lock everyone out of the product permanently.
    await seedPermissionCatalog(db)
    const onlyAdmin = await createSuperAdmin(db, { username: 'only.admin' })
    const deputy = await createUserWithPermissions(db, ['user.deactivate'], {
      username: 'deputy',
    })

    await expect(
      deactivateUser(db, { actor: await actorFor(db, deputy.id), id: onlyAdmin.id }),
    ).rejects.toMatchObject({ messageKey: 'users.cannotDeactivateLastSuperAdmin' })

    expect(
      (await db.user.findUniqueOrThrow({ where: { id: onlyAdmin.id } })).isActive,
    ).toBe(true)
  })

  it('يسمح بتعطيل مدير نظام ما دام هناك مدير آخر نشط', async () => {
    await seedPermissionCatalog(db)
    const first = await createSuperAdmin(db, { username: 'admin.one' })
    await createSuperAdmin(db, { username: 'admin.two' })
    const deputy = await createUserWithPermissions(db, ['user.deactivate'], {
      username: 'deputy',
    })

    await deactivateUser(db, { actor: await actorFor(db, deputy.id), id: first.id })
    expect((await db.user.findUniqueOrThrow({ where: { id: first.id } })).isActive).toBe(
      false,
    )
  })

  it('لا يحتسب مدير نظام معطَّل ضمن المديرين الباقين', async () => {
    await seedPermissionCatalog(db)
    const active = await createSuperAdmin(db, { username: 'admin.active' })
    await createSuperAdmin(db, { username: 'admin.disabled', isActive: false })
    const deputy = await createUserWithPermissions(db, ['user.deactivate'], {
      username: 'deputy',
    })

    await expect(
      deactivateUser(db, { actor: await actorFor(db, deputy.id), id: active.id }),
    ).rejects.toMatchObject({ messageKey: 'users.cannotDeactivateLastSuperAdmin' })
  })

  it('يرفض تعطيل مستخدم محذوف ناعمًا', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const gone = await createUser(db, { deletedAt: new Date('2026-01-01') })

    await expect(
      deactivateUser(db, { actor: await actorFor(db, admin.id), id: gone.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/user — أثر التعطيل على الجلسة', () => {
  it('يمنع بناء فاعل لمستخدم معطَّل', async () => {
    // A deactivated account must stop working immediately, including for a
    // session that was already signed in when the deactivation happened.
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUser(db)

    expect(await maybeActorFor(db, worker.id)).not.toBeNull()

    await deactivateUser(db, { actor: await actorFor(db, admin.id), id: worker.id })
    expect(await maybeActorFor(db, worker.id)).toBeNull()
  })

  it('يعيد الفاعل بعد إعادة التفعيل', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUser(db, { isActive: false })

    await activateUser(db, { actor: await actorFor(db, admin.id), id: worker.id })
    expect(await maybeActorFor(db, worker.id)).not.toBeNull()

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.activated', entityId: worker.id },
    })
    expect(audit.after).toEqual({ isActive: true })
  })

  it('لا يكرّر سجل التدقيق عند تعطيل حساب معطَّل أصلًا', async () => {
    // Idempotent: the operator double-clicked, nothing happened, and the log
    // does not claim otherwise.
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUser(db, { isActive: false })
    const actor = await actorFor(db, admin.id)

    await deactivateUser(db, { actor, id: worker.id })
    await deactivateUser(db, { actor, id: worker.id })

    expect(await db.auditLog.count({ where: { action: 'user.deactivated' } })).toBe(0)
  })

  it('يمنع بناء فاعل لمستخدم محذوف ناعمًا', async () => {
    // CLAUDE.md invariant 8.
    const gone = await createUser(db, { deletedAt: new Date('2026-01-01') })
    expect(await maybeActorFor(db, gone.id)).toBeNull()
  })

  it('يتجاهل الأدوار المحذوفة ناعمًا عند بناء الفاعل', async () => {
    await seedPermissionCatalog(db)
    const { createRole } = await import('../../factories/db')
    const live = await createRole(db, { permissions: ['user.view'] })
    const dead = await createRole(db, {
      permissions: ['payout.approve'],
      deletedAt: new Date('2026-01-01'),
    })
    const user = await createUser(db, { roleIds: [live.id, dead.id] })

    const actor = await actorFor(db, user.id)
    expect([...actor.permissions]).toEqual(['user.view'])
  })
})
