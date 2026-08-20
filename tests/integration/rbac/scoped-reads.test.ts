import { describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'
import { isEmptyScope, scopeProjects, scopeTasks } from '@/lib/rbac'

import {
  createClient,
  createMilestone,
  createProject,
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
const { getAuditEntries, getAuditEntryById, getAuditFacets } =
  await import('@/modules/audit/queries')
const { getClientById, getClients } = await import('@/modules/client/queries')
const { getProjectById, getProjects } = await import('@/modules/project/queries')
const { getMilestones } = await import('@/modules/milestone/queries')

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

  it('يمنع قراءة عميل بالمعرّف المباشر دون صلاحية العرض', async () => {
    // `client.view` is all-or-nothing, like `user.view` — there is no
    // `client.view.assigned` in the SPEC §6 catalog, so the denial here is a
    // thrown `ForbiddenError`, not a silently empty scope.
    await seedPermissionCatalog(db)
    const client = await createClient(db, { name: 'عميل خاص' })
    const stranger = await createUserWithPermissions(db, ['task.comment'])
    setSessionActor(await actorFor(db, stranger.id))

    await expect(getClientById(client.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(getClients()).rejects.toBeInstanceOf(ForbiddenError)
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
    expect(detail.roles.map((r) => r.nameEn)).toEqual(['live_role'])
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

/**
 * Phase 3's promised extension of this file: the read paths that actually
 * ship for `Project`, plus its `Client` label and `Milestone` satellite.
 * The phase brief, verbatim: "a view.assigned user must never see a project
 * they aren't on, including by direct URL."
 */
describe('نطاق المشاريع — القراءة الفعلية عبر modules/project/queries', () => {
  it('يقصر القائمة على ما يملكه أو يشارك فيه صاحب العرض المحدود', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.assigned'], {
      username: 'owner.scoped',
    })
    const stranger = await createUser(db, { username: 'stranger.owner' })
    const mine = await createProject(db, { ownerId: owner.id, code: 'PRJ-MINE' })
    await createProject(db, { ownerId: stranger.id, code: 'PRJ-THEIRS' })

    setSessionActor(await actorFor(db, owner.id))
    const page = await getProjects()
    expect(page.items.map((p) => p.id)).toEqual([mine.id])
  })

  it('يمنع قراءة مشروع بالمعرّف المباشر لا يملكه ولا يشارك فيه — دون أي خطأ يفصح عن وجوده', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUser(db, { username: 'private.project.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-PRIVATE' })

    const outsider = await createUserWithPermissions(db, ['project.view.assigned'], {
      username: 'outsider',
    })
    setSessionActor(await actorFor(db, outsider.id))

    // The id is known — copied from a URL. It must buy nothing: the failure
    // is indistinguishable from a project that never existed.
    await expect(getProjectById(project.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('يسمح للعضو المُسنَد إلى المشروع بقراءته رغم أنه ليس مالكه', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUser(db, { username: 'owner.with.team' })
    const member = await createUserWithPermissions(db, ['project.view.assigned'], {
      username: 'team.member',
    })
    const project = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-TEAM',
      memberIds: [member.id],
    })

    setSessionActor(await actorFor(db, member.id))
    const detail = await getProjectById(project.id)
    expect(detail.id).toBe(project.id)

    const page = await getProjects()
    expect(page.items.map((p) => p.id)).toContain(project.id)
  })

  it('يمنح صاحب العرض الشامل رؤية كل المشاريع بصرف النظر عن الملكية', async () => {
    await seedPermissionCatalog(db)
    const someone = await createUser(db, { username: 'irrelevant.owner' })
    await createProject(db, { ownerId: someone.id, code: 'PRJ-ANY-1' })
    await createProject(db, { ownerId: someone.id, code: 'PRJ-ANY-2' })

    const admin = await createUserWithPermissions(db, ['project.view.all'], {
      username: 'sees.all.projects',
    })
    setSessionActor(await actorFor(db, admin.id))

    const page = await getProjects()
    expect(page.total).toBeGreaterThanOrEqual(2)
  })

  it('لا يرى أي مشروع من لا يملك أي صلاحية عرض مشاريع، دون أن يفشل الاستدعاء', async () => {
    // No `assertCan` throw here — the scope is the enforcement, and an
    // unpermitted user simply sees nothing (lib/rbac's documented contract).
    await seedPermissionCatalog(db)
    const someone = await createUser(db, { username: 'yet.another.owner' })
    await createProject(db, { ownerId: someone.id, code: 'PRJ-HIDDEN' })

    const nobody = await createUserWithPermissions(db, ['task.comment'], {
      username: 'no.project.access',
    })
    setSessionActor(await actorFor(db, nobody.id))

    const page = await getProjects()
    expect(page.items).toEqual([])
  })

  it('يخفي المشاريع المحذوفة ناعمًا عن القائمة والقراءة المباشرة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'], {
      username: 'sees.all.for.softdelete',
    })
    const gone = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-GONE',
      deletedAt: new Date('2026-01-01'),
    })

    setSessionActor(await actorFor(db, owner.id))
    const page = await getProjects()
    expect(page.items.map((p) => p.id)).not.toContain(gone.id)
    await expect(getProjectById(gone.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('نطاق المراحل — تابعة لنطاق المشروع الذي تنتمي إليه', () => {
  it('يمنع قراءة مراحل مشروع لا يملكه المستخدم ولا يشارك فيه', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUser(db, { username: 'milestone.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-DENY' })
    await createMilestone(db, { projectId: project.id, name: 'مرحلة أولى' })

    const outsider = await createUserWithPermissions(db, ['project.view.assigned'], {
      username: 'milestone.outsider',
    })
    setSessionActor(await actorFor(db, outsider.id))

    await expect(getMilestones(project.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('يسمح بقراءة المراحل لمن يملك صلاحية العرض الشامل', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUser(db, { username: 'milestone.owner.2' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-ALLOW' })
    await createMilestone(db, { projectId: project.id, name: 'مرحلة التصميم', order: 0 })
    await createMilestone(db, { projectId: project.id, name: 'مرحلة التطوير', order: 1 })

    const viewer = await createUserWithPermissions(db, ['project.view.all'], {
      username: 'milestone.viewer',
    })
    setSessionActor(await actorFor(db, viewer.id))

    const milestones = await getMilestones(project.id)
    expect(milestones.map((m) => m.name)).toEqual(['مرحلة التصميم', 'مرحلة التطوير'])
  })
})
