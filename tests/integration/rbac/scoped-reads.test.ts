import { describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'
import { isEmptyScope, scopeProjects, scopeTasks } from '@/lib/rbac'

import {
  createRole,
  createSuperAdmin,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))

const { getUserById, getUsers, getOwnProfile } = await import('@/modules/user/queries')
const { getRoleById, getRoles } = await import('@/modules/role/queries')
const { getAuditEntries, getAuditEntryById, getAuditFacets } = await import(
  '@/modules/audit/queries'
)

const db = testDb()

/**
 * The phase brief asks for: "a view.assigned user must not read another user's
 * projects even by direct ID."
 *
 * `Project` and `Task` are Phase 3 and Phase 4 tables — `prisma/schema.prisma`
 * carries an explicit scope guard against adding them early. So this file
 * proves the principle on the read paths that **do** ship in this phase, and
 * the scope fragments themselves are proven exhaustively as pure functions in
 * `tests/unit/rbac/scope.test.ts`.
 *
 * The direct-ID case is the one that matters, and it is asserted here for every
 * shipped entity: guessing or copying an id must buy nothing, because the check
 * lives in the query and not in the list page that linked to it. Phase 3
 * inherits this file's shape for `Project`.
 */

describe('القراءة بالمعرّف المباشر — لا تتجاوز الصلاحية', () => {
  it('يمنع قراءة مستخدم بالمعرّف المباشر دون صلاحية العرض', async () => {
    await seedPermissionCatalog(db)
    const target = await createUser(db, { username: 'private.person' })
    const stranger = await createUserWithPermissions(db, ['task.comment'])
    setSessionActor(await actorFor(db, stranger.id))

    // The id is known — copied from a URL, guessed, or left over in a stale
    // page. Knowing it must buy nothing.
    await expect(getUserById(target.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(getUsers()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('يمنع قراءة دور بالمعرّف المباشر دون صلاحية العرض', async () => {
    await seedPermissionCatalog(db)
    const role = await createRole(db, { permissions: ['payout.approve'] })
    const stranger = await createUserWithPermissions(db, ['user.view'])
    setSessionActor(await actorFor(db, stranger.id))

    await expect(getRoleById(role.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(getRoles()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('يمنع قراءة سجل تدقيق بالمعرّف المباشر دون صلاحية العرض', async () => {
    await seedPermissionCatalog(db)
    const author = await createUserWithPermissions(db, ['audit.view'])
    await db.auditLog.create({
      data: {
        actorId: author.id,
        action: 'user.created',
        entity: 'User',
        entityId: 'x',
      },
    })
    const entry = await db.auditLog.findFirstOrThrow()

    const stranger = await createUserWithPermissions(db, ['user.view'])
    setSessionActor(await actorFor(db, stranger.id))

    await expect(getAuditEntryById(entry.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(getAuditEntries()).rejects.toBeInstanceOf(ForbiddenError)
    // The list of everyone who has ever acted in the system is itself
    // information, so the facets are gated too.
    await expect(getAuditFacets()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('يمنع كل القراءات عن مستخدم غير مسجَّل', async () => {
    await seedPermissionCatalog(db)
    const target = await createUser(db)
    clearSessionActor()

    await expect(getUserById(target.id)).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(getRoles()).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(getAuditEntries()).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('يسمح لصاحب الصلاحية بالقراءة نفسها', async () => {
    // Without this, a query that threw for everyone would pass every test above.
    await seedPermissionCatalog(db)
    const target = await createUser(db, { username: 'visible.person' })
    const viewer = await createUserWithPermissions(db, ['user.view', 'role.view'])
    setSessionActor(await actorFor(db, viewer.id))

    expect((await getUserById(target.id)).username).toBe('visible.person')
    expect((await getUsers()).items.length).toBeGreaterThan(0)
    await expect(getRoles()).resolves.toBeInstanceOf(Array)
  })

  it('يقرأ المستخدم ملفه الشخصي بلا صلاحية عرض المستخدمين', async () => {
    // Reading your own record is not a privilege. Gating it would mean a worker
    // cannot see their own name in the header.
    await seedPermissionCatalog(db)
    const worker = await createUser(db, { username: 'self.reader' })
    setSessionActor(await actorFor(db, worker.id))

    expect((await getOwnProfile()).username).toBe('self.reader')
    await expect(getUserById(worker.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('القراءة — الحذف الناعم محترم في كل مسار', () => {
  it('يخفي المستخدمين المحذوفين عن القائمة والقراءة المباشرة', async () => {
    // CLAUDE.md invariant 8.
    await seedPermissionCatalog(db)
    const viewer = await createUserWithPermissions(db, ['user.view'])
    const gone = await createUser(db, {
      username: 'deleted.person',
      deletedAt: new Date('2026-01-01'),
    })
    setSessionActor(await actorFor(db, viewer.id))

    const page = await getUsers()
    expect(page.items.map((u) => u.id)).not.toContain(gone.id)
    await expect(getUserById(gone.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('يخفي الأدوار المحذوفة عن قائمة أدوار المستخدم', async () => {
    await seedPermissionCatalog(db)
    const live = await createRole(db, { nameEn: 'LIVE_ROLE' })
    const dead = await createRole(db, {
      nameEn: 'DEAD_ROLE',
      deletedAt: new Date('2026-01-01'),
    })
    const viewer = await createUserWithPermissions(db, ['user.view'])
    const member = await createUser(db, { roleIds: [live.id, dead.id] })
    setSessionActor(await actorFor(db, viewer.id))

    const detail = await getUserById(member.id)
    expect(detail.roles.map((r) => r.nameEn)).toEqual(['LIVE_ROLE'])
  })
})

describe('نطاق المشاريع والمهام — العقد الذي ترثه المرحلتان الثالثة والرابعة', () => {
  it('ينتج نطاقًا مغلقًا لمستخدم حقيقي بلا صلاحية عرض', async () => {
    // Built from real rows through the real `resolveActor`, so this also proves
    // the actor is *assembled* correctly — not just that `can()` works when
    // handed a hand-made permission set.
    await seedPermissionCatalog(db)
    const worker = await createUserWithPermissions(db, ['task.comment'])
    const actor = await actorFor(db, worker.id)

    expect(isEmptyScope(scopeProjects(actor))).toBe(true)
    expect(isEmptyScope(scopeTasks(actor))).toBe(true)
  })

  it('يقصر النطاق على معرّف المستخدم الحقيقي', async () => {
    await seedPermissionCatalog(db)
    const worker = await createUserWithPermissions(db, [
      'project.view.assigned',
      'task.view.assigned',
    ])
    const actor = await actorFor(db, worker.id)

    expect(scopeProjects(actor)).toEqual({
      deletedAt: null,
      OR: [{ ownerId: worker.id }, { members: { some: { userId: worker.id } } }],
    })
    expect(scopeTasks(actor)).toEqual({
      deletedAt: null,
      OR: [{ assigneeId: worker.id }, { watchers: { some: { userId: worker.id } } }],
    })
  })

  it('يفتح النطاق لمدير النظام دون أي صف صلاحيات مخزَّن', async () => {
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db)
    const actor = await actorFor(db, admin.id)

    expect(await db.rolePermission.count()).toBe(0)
    expect(scopeProjects(actor)).toEqual({ deletedAt: null })
    expect(scopeTasks(actor)).toEqual({ deletedAt: null })
  })
})
