import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'
import { PERMISSIONS, type Permission } from '@/lib/rbac'

import {
  createClient as createClientRow,
  createMilestone as createMilestoneRow,
  createProject as createProjectRow,
  createProjectTemplate as createProjectTemplateRow,
  createSuperAdmin,
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

const { createClientAction, deleteClientAction, updateClientAction } =
  await import('@/modules/client/actions')
const {
  addProjectMemberAction,
  createProjectAction,
  deleteProjectAction,
  removeProjectMemberAction,
  setProjectHealthOverrideAction,
  updateProjectAction,
  updateProjectMemberRoleAction,
} = await import('@/modules/project/actions')
const {
  createMilestoneAction,
  deleteMilestoneAction,
  reorderMilestonesAction,
  updateMilestoneAction,
} = await import('@/modules/milestone/actions')
const { createProjectFromTemplateAction, saveProjectAsTemplateAction } =
  await import('@/modules/project-template/actions')

/**
 * docs/TESTING.md §4 axis 4 — the write (action) half of Phase 3's permission
 * sweep. `tests/integration/rbac/scoped-reads.test.ts` already proves the read
 * half ("نطاق المشاريع" / "نطاق المراحل"): a `view.assigned` user cannot read a
 * project it does not own or belong to, even by direct id. This file proves the
 * companion claim for every write path Phase 3 ships — client, project,
 * milestone, project-template — following the exact shape
 * `tests/integration/rbac/action-permissions.test.ts` established in Phase 1:
 *
 *   "each server action called by a user lacking the permission must throw
 *    AND must not mutate" — both halves, for every action, plus the mirror
 *    image (a permitted user succeeds) so an action that threw for everyone
 *    could not pass the suite by accident.
 *
 * SPEC §6's scoping rule is also asserted directly: `project.view.assigned` is
 * a *read* scope. `lib/rbac/require.ts` (`assertCan`) checks one named
 * permission key with no scope fallback, so owning or belonging to the very
 * project under edit must not substitute for holding `project.edit`.
 */

const db = testDb()

interface Fixtures {
  clientId: string
  projectId: string
  projectCode: string
  projectOwnerId: string
  milestoneAId: string
  milestoneBId: string
  memberCandidateId: string
  existingMemberId: string
  templateId: string
}

interface ActionCase {
  name: string
  permission: Permission
  /** Runs the action with a payload that WOULD succeed if permitted. */
  invoke: (fixtures: Fixtures) => Promise<unknown>
  /** Tables the action would touch if it got through. */
  watch: Array<'client' | 'project' | 'projectMember' | 'milestone' | 'projectTemplate'>
}

/**
 * One project (with a client, two milestones, and one pre-existing member)
 * owned by `owner`. `opts.extraMemberIds` additionally seats other users on
 * the project's team — used by the scoping section below to make an actor a
 * genuine member of the very project they are attempting to edit.
 */
async function buildFixtures(
  owner: { id: string },
  opts: { extraMemberIds?: string[] } = {},
): Promise<Fixtures> {
  const client = await createClientRow(db, { name: 'عميل الاختبار' })
  const existingMember = await createUser(db)
  const memberCandidate = await createUser(db)
  const project = await createProjectRow(db, {
    ownerId: owner.id,
    clientId: client.id,
    memberIds: [existingMember.id, ...(opts.extraMemberIds ?? [])],
  })
  const milestoneA = await createMilestoneRow(db, { projectId: project.id, order: 0 })
  const milestoneB = await createMilestoneRow(db, { projectId: project.id, order: 1 })
  const template = await createProjectTemplateRow(db, {
    payload: {
      milestones: [
        { name: 'مرحلة القالب', order: 0, dueDateOffsetDays: null, status: 'PENDING' },
      ],
      tasks: [],
    },
  })

  return {
    clientId: client.id,
    projectId: project.id,
    projectCode: project.code,
    projectOwnerId: owner.id,
    milestoneAId: milestoneA.id,
    milestoneBId: milestoneB.id,
    memberCandidateId: memberCandidate.id,
    existingMemberId: existingMember.id,
    templateId: template.id,
  }
}

async function fixtures(): Promise<Fixtures> {
  await seedPermissionCatalog(db)
  const owner = await createUser(db, { username: 'fixture.project.owner' })
  return buildFixtures(owner)
}

const ACTIONS: ActionCase[] = [
  {
    name: 'createClientAction',
    permission: 'client.manage',
    invoke: () =>
      createClientAction({
        name: 'عميل جديد للاختبار',
        phone: '01012345678',
        notes: 'ملاحظة',
      }),
    watch: ['client'],
  },
  {
    name: 'updateClientAction',
    permission: 'client.manage',
    invoke: (f) =>
      updateClientAction({
        id: f.clientId,
        name: 'اسم عميل معدَّل',
        phone: '01099999999',
        notes: 'ملاحظة محدثة',
      }),
    watch: ['client'],
  },
  {
    name: 'deleteClientAction',
    permission: 'client.manage',
    invoke: (f) => deleteClientAction({ id: f.clientId }),
    watch: ['client'],
  },
  {
    name: 'createProjectAction',
    permission: 'project.create',
    invoke: (f) =>
      createProjectAction({
        name: 'مشروع جديد للاختبار',
        clientId: f.clientId,
        ownerId: f.existingMemberId,
        engagementType: 'FIXED_PRICE',
        status: 'DRAFT',
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        dueDate: new Date('2026-05-01T00:00:00.000Z'),
        gracePeriodHours: null,
        penalizeRevisionLateness: null,
      }),
    watch: ['project'],
  },
  {
    name: 'updateProjectAction',
    permission: 'project.edit',
    invoke: (f) =>
      updateProjectAction({
        id: f.projectId,
        code: f.projectCode,
        name: 'اسم مشروع معدَّل',
        clientId: f.clientId,
        ownerId: f.projectOwnerId,
        engagementType: 'RETAINER',
        status: 'ACTIVE',
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        dueDate: new Date('2026-05-01T00:00:00.000Z'),
        gracePeriodHours: 48,
        penalizeRevisionLateness: false,
      }),
    watch: ['project'],
  },
  {
    name: 'deleteProjectAction',
    permission: 'project.delete',
    invoke: (f) => deleteProjectAction({ id: f.projectId }),
    watch: ['project'],
  },
  {
    name: 'setProjectHealthOverrideAction',
    permission: 'project.edit',
    invoke: (f) =>
      setProjectHealthOverrideAction({
        id: f.projectId,
        health: 'RED',
        reason: 'سبب واضح ومفصَّل لتجاوز الحالة الصحية لهذا المشروع',
      }),
    watch: ['project'],
  },
  {
    name: 'addProjectMemberAction',
    permission: 'project.edit',
    invoke: (f) =>
      addProjectMemberAction({
        projectId: f.projectId,
        userId: f.memberCandidateId,
        role: 'CONTRIBUTOR',
      }),
    watch: ['projectMember'],
  },
  {
    name: 'updateProjectMemberRoleAction',
    permission: 'project.edit',
    invoke: (f) =>
      updateProjectMemberRoleAction({
        projectId: f.projectId,
        userId: f.existingMemberId,
        role: 'MANAGER',
      }),
    watch: ['projectMember'],
  },
  {
    name: 'removeProjectMemberAction',
    permission: 'project.edit',
    invoke: (f) =>
      removeProjectMemberAction({ projectId: f.projectId, userId: f.existingMemberId }),
    watch: ['projectMember'],
  },
  {
    name: 'createMilestoneAction',
    permission: 'project.edit',
    invoke: (f) =>
      createMilestoneAction({
        projectId: f.projectId,
        name: 'مرحلة جديدة للاختبار',
        dueDate: null,
        status: 'PENDING',
      }),
    watch: ['milestone'],
  },
  {
    name: 'updateMilestoneAction',
    permission: 'project.edit',
    invoke: (f) =>
      updateMilestoneAction({
        id: f.milestoneAId,
        name: 'اسم مرحلة معدَّل',
        dueDate: null,
        status: 'DONE',
      }),
    watch: ['milestone'],
  },
  {
    name: 'deleteMilestoneAction',
    permission: 'project.edit',
    invoke: (f) => deleteMilestoneAction({ id: f.milestoneAId }),
    watch: ['milestone'],
  },
  {
    name: 'reorderMilestonesAction',
    permission: 'project.edit',
    invoke: (f) =>
      reorderMilestonesAction({
        projectId: f.projectId,
        orderedIds: [f.milestoneBId, f.milestoneAId],
      }),
    watch: ['milestone'],
  },
  {
    name: 'saveProjectAsTemplateAction',
    permission: 'project.edit',
    invoke: (f) =>
      saveProjectAsTemplateAction({ projectId: f.projectId, name: 'قالب من الاختبار' }),
    watch: ['projectTemplate'],
  },
  {
    name: 'createProjectFromTemplateAction',
    permission: 'project.create',
    invoke: (f) =>
      createProjectFromTemplateAction({
        templateId: f.templateId,
        name: 'مشروع من القالب للاختبار',
        ownerId: f.projectOwnerId,
        engagementType: 'FIXED_PRICE',
        status: 'DRAFT',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        dueDate: new Date('2026-06-01T00:00:00.000Z'),
        gracePeriodHours: null,
        penalizeRevisionLateness: null,
      }),
    watch: ['project', 'milestone'],
  },
]

async function snapshot(tables: ActionCase['watch']) {
  const out: Record<string, unknown> = {}
  for (const table of tables) {
    if (table === 'client') {
      out.client = await db.client.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, name: true, phone: true, notes: true, deletedAt: true },
      })
    }
    if (table === 'project') {
      out.project = await db.project.findMany({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          clientId: true,
          ownerId: true,
          engagementType: true,
          status: true,
          startDate: true,
          dueDate: true,
          gracePeriodHours: true,
          penalizeRevisionLateness: true,
          healthOverride: true,
          healthReason: true,
          deletedAt: true,
        },
      })
    }
    if (table === 'projectMember') {
      out.projectMember = await db.projectMember.findMany({
        orderBy: [{ projectId: 'asc' }, { userId: 'asc' }],
        select: { projectId: true, userId: true, role: true },
      })
    }
    if (table === 'milestone') {
      out.milestone = await db.milestone.findMany({
        orderBy: [{ projectId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          projectId: true,
          name: true,
          dueDate: true,
          order: true,
          status: true,
        },
      })
    }
    if (table === 'projectTemplate') {
      out.projectTemplate = await db.projectTemplate.findMany({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          payload: true,
          createdById: true,
          deletedAt: true,
        },
      })
    }
  }
  return JSON.parse(JSON.stringify(out)) as unknown
}

beforeEach(() => {
  clearSessionActor()
})

describe('الصلاحيات — كل إجراء كتابة في المرحلة الثالثة يرفض من لا يملكه', () => {
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
      const permitted = await createUserWithPermissions(db, [action.permission], {
        username: 'permitted.user',
      })
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

describe('الصلاحيات — تغطية إجراءات المرحلة الثالثة', () => {
  it('يغطّي كل إجراء خادم يكتب في العملاء والمشاريع والمراحل والقوالب', async () => {
    // Same guard as Phase 1's exemplar: someone adds an action and forgets to
    // add it here, and the "every action is checked" claim silently stops
    // being true.
    const modules = await Promise.all([
      import('@/modules/client/actions'),
      import('@/modules/project/actions'),
      import('@/modules/milestone/actions'),
      import('@/modules/project-template/actions'),
    ])

    const exported = modules
      .flatMap((m) => Object.keys(m))
      .filter((name) => name.endsWith('Action'))
      .sort()

    expect(exported).toEqual(ACTIONS.map((a) => a.name).sort())
  })
})

/**
 * SPEC §6, verbatim: "`*.view.assigned` is limited to projects where the user
 * is owner/member" — a READ scope. `project.edit` is a distinct permission
 * key, and `lib/rbac/require.ts` (`assertCan`) checks the single named key
 * with no fallback to scope — so owning, or belonging to, the very project
 * under edit must not substitute for holding `project.edit`.
 */
describe('الصلاحيات — نطاق العرض المحدود لا يمنح صلاحية تعديل المشروع', () => {
  const editGatedActions = ACTIONS.filter((a) => a.permission === 'project.edit')

  for (const action of editGatedActions) {
    it(`يرفض ${action.name} لمالك المشروع نفسه حين يملك project.view.assigned فقط`, async () => {
      await seedPermissionCatalog(db)
      const owner = await createUserWithPermissions(db, ['project.view.assigned'], {
        username: 'scope.owner.actor',
      })
      const f = await buildFixtures(owner)
      setSessionActor(await actorFor(db, owner.id))

      const before = await snapshot(action.watch)
      await expect(action.invoke(f)).rejects.toBeInstanceOf(ForbiddenError)
      expect(await snapshot(action.watch)).toEqual(before)
    })

    it(`يرفض ${action.name} لعضو المشروع حين يملك project.view.assigned فقط`, async () => {
      await seedPermissionCatalog(db)
      const outsiderOwner = await createUser(db, { username: 'scope.outsider.owner' })
      const member = await createUserWithPermissions(db, ['project.view.assigned'], {
        username: 'scope.member.actor',
      })
      const f = await buildFixtures(outsiderOwner, { extraMemberIds: [member.id] })
      setSessionActor(await actorFor(db, member.id))

      const before = await snapshot(action.watch)
      await expect(action.invoke(f)).rejects.toBeInstanceOf(ForbiddenError)
      expect(await snapshot(action.watch)).toEqual(before)
    })
  }
})

/**
 * The specific concern the axis names for `setProjectHealthOverrideAction`:
 * confirm the permission gate itself runs — and rejects — before the handler
 * body (and its Zod parse) ever executes, using a payload that is valid in
 * every other respect. `requirePermission` (lib/rbac/require.ts) resolves the
 * actor and asserts the permission before the handler's first line — a
 * perfectly valid reason removes any possibility that a validation error was
 * what actually stopped the write.
 */
describe('الصلاحيات — حارس الصلاحية يسبق أي حارس تحقق آخر', () => {
  it('يرفض تعيين تجاوز الحالة الصحية دون project.edit حتى مع سبب صالح تمامًا', async () => {
    const f = await fixtures()
    const stranger = await createUserWithPermissions(db, ['task.comment'], {
      username: 'health.override.stranger',
    })
    setSessionActor(await actorFor(db, stranger.id))

    const before = await snapshot(['project'])
    await expect(
      setProjectHealthOverrideAction({
        id: f.projectId,
        health: 'RED',
        reason: 'سبب مفصَّل وصحيح تمامًا يفي بكل شروط التحقق',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(await snapshot(['project'])).toEqual(before)
  })
})
