import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@/lib/errors'

import {
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const {
  bulkAssignTaskAction,
  bulkChangeTaskDueDateAction,
  bulkChangeTaskPriorityAction,
  getTaskOptionsForProjectAction,
  getTaskSheetDataAction,
} = await import('@/modules/task/actions')

/**
 * docs/TESTING.md §4 — axis 4 (permissions) and axis 11 (soft-delete),
 * scoped to Phase 5's four new server actions:
 *
 *   - `bulkAssignTaskAction` / `bulkChangeTaskPriorityAction` /
 *     `bulkChangeTaskDueDateAction` — permission denial must throw AND leave
 *     every row untouched AND write no `AuditLog` row
 *     (`tests/integration/rbac/action-permissions.test.ts`'s exact shape),
 *     and a permitted caller's partial batch (one already soft-deleted task
 *     mixed with valid ones) must report the real per-row outcome, proven by
 *     re-reading the database rather than trusting the returned counts.
 *   - `getTaskSheetDataAction` / `getTaskOptionsForProjectAction` — both are
 *     `requireAuth`, not `requirePermission`; scoping is enforced entirely by
 *     `scopeTasks` inside the queries they compose
 *     (`tests/integration/task/scoped-reads.test.ts`'s precedent), so the
 *     cases here are about that scope, not about a permission key.
 */

const db = testDb()

beforeEach(() => {
  clearSessionActor()
})

async function baseFixture() {
  await seedPermissionCatalog(db)
  const owner = await createUserWithPermissions(db, ['task.view.all'])
  const project = await createProject(db, { ownerId: owner.id })
  return { owner, project }
}

async function snapshotTask(id: string) {
  return db.task.findUnique({
    where: { id },
    select: {
      id: true,
      assigneeId: true,
      status: true,
      priority: true,
      dueDate: true,
      deletedAt: true,
    },
  })
}

async function auditLogRows() {
  return db.auditLog.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, action: true, entity: true, entityId: true },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// bulkAssignTaskAction — permission: task.assign
// ─────────────────────────────────────────────────────────────────────────────

describe('bulkAssignTaskAction — الصلاحيات', () => {
  it('يرفض التعيين الجماعي لمن لا يملك task.assign ولا يغيّر أي صف ولا يكتب سجل تدقيق', async () => {
    const { project } = await baseFixture()
    const task = await createTask(db, { projectId: project.id, status: 'BACKLOG' })
    const assignee = await createUserWithPermissions(db, [])
    const stranger = await createUserWithPermissions(db, ['task.edit'])
    setSessionActor(await actorFor(db, stranger.id))

    const before = await snapshotTask(task.id)
    const auditBefore = await auditLogRows()

    await expect(
      bulkAssignTaskAction({ taskIds: [task.id], assigneeId: assignee.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await snapshotTask(task.id)).toEqual(before)
    expect(await auditLogRows()).toEqual(auditBefore)
  })

  it('يرفض التعيين الجماعي لمستخدم غير مسجَّل الدخول ولا يغيّر أي صف', async () => {
    const { project } = await baseFixture()
    const task = await createTask(db, { projectId: project.id, status: 'BACKLOG' })
    const assignee = await createUserWithPermissions(db, [])
    clearSessionActor()

    const before = await snapshotTask(task.id)
    const auditBefore = await auditLogRows()

    await expect(
      bulkAssignTaskAction({ taskIds: [task.id], assigneeId: assignee.id }),
    ).rejects.toBeInstanceOf(UnauthenticatedError)

    expect(await snapshotTask(task.id)).toEqual(before)
    expect(await auditLogRows()).toEqual(auditBefore)
  })

  it('ينجح التعيين للمهام الصالحة ويبلّغ عن فشل حقيقي للمهمة المحذوفة ضمن نفس الدفعة', async () => {
    const { project } = await baseFixture()
    const permitted = await createUserWithPermissions(db, ['task.assign'])
    const assignee = await createUserWithPermissions(db, [])

    const validOne = await createTask(db, { projectId: project.id, status: 'BACKLOG' })
    const validTwo = await createTask(db, { projectId: project.id, status: 'BACKLOG' })
    const deleted = await createTask(db, {
      projectId: project.id,
      status: 'BACKLOG',
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    })
    setSessionActor(await actorFor(db, permitted.id))

    const result = await bulkAssignTaskAction({
      taskIds: [validOne.id, validTwo.id, deleted.id],
      assigneeId: assignee.id,
    })

    expect(result).toEqual({ succeeded: 2, failed: 1 })

    // Re-read the database — the counts alone would not catch a handler that
    // reports success without actually writing.
    const [afterValidOne, afterValidTwo, afterDeleted] = await Promise.all([
      snapshotTask(validOne.id),
      snapshotTask(validTwo.id),
      snapshotTask(deleted.id),
    ])
    expect(afterValidOne?.assigneeId).toBe(assignee.id)
    expect(afterValidOne?.status).toBe('ASSIGNED')
    expect(afterValidTwo?.assigneeId).toBe(assignee.id)
    expect(afterValidTwo?.status).toBe('ASSIGNED')
    // The already-deleted row never got near `loadTask`'s ALIVE filter.
    expect(afterDeleted?.assigneeId).toBeNull()
    expect(afterDeleted?.status).toBe('BACKLOG')
    expect(afterDeleted?.deletedAt).not.toBeNull()

    const audit = await auditLogRows()
    expect(audit.filter((a) => a.action === 'task.assigned')).toHaveLength(2)
    expect(audit.some((a) => a.entityId === deleted.id)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// bulkChangeTaskPriorityAction — permission: task.edit
// ─────────────────────────────────────────────────────────────────────────────

describe('bulkChangeTaskPriorityAction — الصلاحيات', () => {
  it('يرفض تغيير الأولوية الجماعي لمن لا يملك task.edit ولا يغيّر أي صف ولا يكتب سجل تدقيق', async () => {
    const { project } = await baseFixture()
    const task = await createTask(db, { projectId: project.id, priority: 'LOW' })
    const stranger = await createUserWithPermissions(db, ['task.comment'])
    setSessionActor(await actorFor(db, stranger.id))

    const before = await snapshotTask(task.id)
    const auditBefore = await auditLogRows()

    await expect(
      bulkChangeTaskPriorityAction({ taskIds: [task.id], priority: 'URGENT' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await snapshotTask(task.id)).toEqual(before)
    expect(await auditLogRows()).toEqual(auditBefore)
  })

  it('يرفض تغيير الأولوية الجماعي لمستخدم غير مسجَّل الدخول ولا يغيّر أي صف', async () => {
    const { project } = await baseFixture()
    const task = await createTask(db, { projectId: project.id, priority: 'LOW' })
    clearSessionActor()

    const before = await snapshotTask(task.id)
    const auditBefore = await auditLogRows()

    await expect(
      bulkChangeTaskPriorityAction({ taskIds: [task.id], priority: 'URGENT' }),
    ).rejects.toBeInstanceOf(UnauthenticatedError)

    expect(await snapshotTask(task.id)).toEqual(before)
    expect(await auditLogRows()).toEqual(auditBefore)
  })

  it('يغيّر أولوية المهام الصالحة ويبلّغ عن فشل حقيقي للمهمة المحذوفة ضمن نفس الدفعة', async () => {
    const { project } = await baseFixture()
    const permitted = await createUserWithPermissions(db, ['task.edit'])

    const validOne = await createTask(db, { projectId: project.id, priority: 'LOW' })
    const validTwo = await createTask(db, { projectId: project.id, priority: 'LOW' })
    const deleted = await createTask(db, {
      projectId: project.id,
      priority: 'LOW',
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    })
    setSessionActor(await actorFor(db, permitted.id))

    const result = await bulkChangeTaskPriorityAction({
      taskIds: [validOne.id, validTwo.id, deleted.id],
      priority: 'URGENT',
    })

    expect(result).toEqual({ succeeded: 2, failed: 1 })

    const [afterValidOne, afterValidTwo, afterDeleted] = await Promise.all([
      snapshotTask(validOne.id),
      snapshotTask(validTwo.id),
      snapshotTask(deleted.id),
    ])
    expect(afterValidOne?.priority).toBe('URGENT')
    expect(afterValidTwo?.priority).toBe('URGENT')
    // Still LOW — `loadUpdatableCore` returned null for the deleted row, so
    // `updateTask` was never reached for it.
    expect(afterDeleted?.priority).toBe('LOW')

    const audit = await auditLogRows()
    expect(audit.filter((a) => a.action === 'task.updated')).toHaveLength(2)
    expect(audit.some((a) => a.entityId === deleted.id)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// bulkChangeTaskDueDateAction — permission: task.edit
// ─────────────────────────────────────────────────────────────────────────────

describe('bulkChangeTaskDueDateAction — الصلاحيات', () => {
  const originalDueDate = new Date('2026-04-01T12:00:00Z')
  const newDueDate = new Date('2026-05-15T12:00:00Z')

  it('يرفض تغيير الموعد الجماعي لمن لا يملك task.edit ولا يغيّر أي صف ولا يكتب سجل تدقيق', async () => {
    const { project } = await baseFixture()
    const task = await createTask(db, { projectId: project.id, dueDate: originalDueDate })
    const stranger = await createUserWithPermissions(db, ['task.comment'])
    setSessionActor(await actorFor(db, stranger.id))

    const before = await snapshotTask(task.id)
    const auditBefore = await auditLogRows()

    await expect(
      bulkChangeTaskDueDateAction({ taskIds: [task.id], dueDate: newDueDate }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await snapshotTask(task.id)).toEqual(before)
    expect(await auditLogRows()).toEqual(auditBefore)
  })

  it('يرفض تغيير الموعد الجماعي لمستخدم غير مسجَّل الدخول ولا يغيّر أي صف', async () => {
    const { project } = await baseFixture()
    const task = await createTask(db, { projectId: project.id, dueDate: originalDueDate })
    clearSessionActor()

    const before = await snapshotTask(task.id)
    const auditBefore = await auditLogRows()

    await expect(
      bulkChangeTaskDueDateAction({ taskIds: [task.id], dueDate: newDueDate }),
    ).rejects.toBeInstanceOf(UnauthenticatedError)

    expect(await snapshotTask(task.id)).toEqual(before)
    expect(await auditLogRows()).toEqual(auditBefore)
  })

  it('يغيّر موعد المهام الصالحة ويبلّغ عن فشل حقيقي للمهمة المحذوفة ضمن نفس الدفعة', async () => {
    const { project } = await baseFixture()
    const permitted = await createUserWithPermissions(db, ['task.edit'])

    const validOne = await createTask(db, {
      projectId: project.id,
      dueDate: originalDueDate,
    })
    const validTwo = await createTask(db, {
      projectId: project.id,
      dueDate: originalDueDate,
    })
    const deleted = await createTask(db, {
      projectId: project.id,
      dueDate: originalDueDate,
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    })
    setSessionActor(await actorFor(db, permitted.id))

    const result = await bulkChangeTaskDueDateAction({
      taskIds: [validOne.id, validTwo.id, deleted.id],
      dueDate: newDueDate,
    })

    expect(result).toEqual({ succeeded: 2, failed: 1 })

    const [afterValidOne, afterValidTwo, afterDeleted] = await Promise.all([
      snapshotTask(validOne.id),
      snapshotTask(validTwo.id),
      snapshotTask(deleted.id),
    ])
    expect(afterValidOne?.dueDate).toEqual(newDueDate)
    expect(afterValidTwo?.dueDate).toEqual(newDueDate)
    expect(afterDeleted?.dueDate).toEqual(originalDueDate)

    const audit = await auditLogRows()
    expect(audit.filter((a) => a.action === 'task.updated')).toHaveLength(2)
    expect(audit.some((a) => a.entityId === deleted.id)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getTaskSheetDataAction — requireAuth, self-scoped via scopeTasks
// ─────────────────────────────────────────────────────────────────────────────

describe('getTaskSheetDataAction — النطاق', () => {
  it('يرفض فتح المهمة لصاحب task.view.assigned حين لا يكون منفّذًا ولا متابعًا', async () => {
    const { owner, project } = await baseFixture()
    const stranger = await createUserWithPermissions(db, ['task.view.assigned'])
    const task = await createTask(db, { projectId: project.id, assigneeId: owner.id })
    setSessionActor(await actorFor(db, stranger.id))

    await expect(getTaskSheetDataAction(task.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يعيد الحزمة الكاملة لصاحب task.view.assigned حين يكون هو المنفّذ', async () => {
    const { owner, project } = await baseFixture()
    const assignee = await createUserWithPermissions(db, ['task.view.assigned'])
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: assignee.id,
      status: 'ASSIGNED',
    })
    const dependsOn = await createTask(db, { projectId: project.id, title: 'مهمة سابقة' })
    const dependent = await createTask(db, { projectId: project.id, title: 'مهمة لاحقة' })
    await db.taskDependency.create({
      data: { taskId: task.id, dependsOnTaskId: dependsOn.id },
    })
    await db.taskDependency.create({
      data: { taskId: dependent.id, dependsOnTaskId: task.id },
    })
    await db.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.id,
        body: 'تعليق تجريبي على المهمة',
        mentions: [],
      },
    })
    setSessionActor(await actorFor(db, assignee.id))

    const data = await getTaskSheetDataAction(task.id)

    expect(data.task.id).toBe(task.id)
    expect(data.comments).toHaveLength(1)
    expect(data.comments[0]?.body).toBe('تعليق تجريبي على المهمة')
    expect(data.dependencies.map((d) => d.taskId)).toEqual([dependsOn.id])
    expect(data.dependents.map((d) => d.taskId)).toEqual([dependent.id])
    expect(data.warnings.map((w) => w.taskId)).toEqual([dependsOn.id])
    expect(Array.isArray(data.activity)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getTaskOptionsForProjectAction — requireAuth, self-scoped via scopeTasks
// ─────────────────────────────────────────────────────────────────────────────

describe('getTaskOptionsForProjectAction — النطاق', () => {
  it('يعيد قائمة فارغة لصاحب task.view.assigned بلا مهام في هذا المشروع بدل رمي خطأ', async () => {
    const { project } = await baseFixture()
    // A task exists in the project, but this actor is neither assignee nor
    // watcher on it.
    await createTask(db, { projectId: project.id })
    const outsider = await createUserWithPermissions(db, ['task.view.assigned'])
    setSessionActor(await actorFor(db, outsider.id))

    const options = await getTaskOptionsForProjectAction(project.id)

    expect(options).toEqual([])
  })

  it('لا تظهر مهمة محذوفة ناعمًا في نفس المشروع حتى لصاحب task.view.all', async () => {
    const { owner, project } = await baseFixture()
    const alive = await createTask(db, { projectId: project.id, title: 'مهمة حية' })
    await createTask(db, {
      projectId: project.id,
      title: 'مهمة محذوفة',
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    })
    setSessionActor(await actorFor(db, owner.id))

    const options = await getTaskOptionsForProjectAction(project.id)

    expect(options.map((o) => o.id)).toEqual([alive.id])
  })
})
