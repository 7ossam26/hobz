import { describe, expect, it } from 'vitest'

import { DomainError } from '@/lib/errors'
import { scopeTasks } from '@/lib/rbac'
import { taskHealthSignals } from '@/modules/project/health'
import { listTasksSchema } from '@/modules/task/schema'
import {
  addComment,
  assignTask,
  createTask,
  getDependencyWarnings,
  getTask,
  listActivity,
  listComments,
  listTasks,
  recomputeElapsed,
  unblockTask,
} from '@/modules/task/service'
import { openTasksForUser } from '@/modules/user/open-tasks'

import {
  createProject,
  createTask as createTaskRow,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { businessDayCalendar } from '../../helpers/calendar'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * Axis 12 of the edge-case protocol (docs/TESTING.md §4) — **Empty/null**:
 * no assignee, no due date, no salary, brand-new user, empty cycle.
 *
 * The theme is that "nothing yet" must read as a real, calm answer everywhere —
 * an empty list, a zero, a `null` — and never as a crash or, worse, as a
 * plausible wrong number. A brand-new agency's first hour in the product is
 * entirely made of these cases.
 */

const CATEGORIES = [{ id: 'design' }, { id: 'development' }]
const NOW = cairo('2026-03-15T09:00')

async function fixture() {
  await seedPermissionCatalog(db)
  const manager = await createUserWithPermissions(db, [
    'task.create',
    'task.edit',
    'task.assign',
    'task.comment',
    'task.view.all',
  ])
  const project = await createProject(db, { ownerId: manager.id })
  const actor = await actorFor(db, manager.id)
  return { manager, project, actor }
}

function baseInput(projectId: string) {
  return {
    projectId,
    title: 'مهمة',
    description: null,
    milestoneId: null,
    assigneeId: null,
    priority: 'MEDIUM' as const,
    categoryId: 'design',
    estimatedHours: 0,
    taskValue: null,
    dueDate: cairo('2026-04-01T17:00'),
    watcherIds: [],
  }
}

describe('قيم فارغة — مهمة بلا منفّذ', () => {
  it('ينشئ مهمة بلا منفّذ ولا وصف ولا مرحلة ولا قيمة', async () => {
    const { project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: baseInput(project.id),
    })

    expect(result.task).toMatchObject({
      status: 'BACKLOG',
      assignee: null,
      description: null,
      milestoneId: null,
      taskValue: '0.00',
      estimatedHours: '0.00',
      qualityRating: null,
      delayReason: null,
      delayAttribution: null,
      elapsedMinutesRaw: 0,
      elapsedMinutesWorking: 0,
      watchers: [],
    })
    expect(result.task.assignedAt).toBeNull()
    expect(result.task.startedAt).toBeNull()
    expect(result.task.submittedAt).toBeNull()
    expect(result.task.approvedAt).toBeNull()
    expect(result.warnings).toEqual([])
  })

  it('يعطي زمنًا منقضيًا صفريًا لمهمة لم تُسنَد قط', async () => {
    const { project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id, assigneeId: null })

    const elapsed = await recomputeElapsed(db, {
      taskId: task.id,
      calendar: businessDayCalendar(),
      actor,
      now: NOW,
    })

    expect(elapsed).toEqual({ raw: 0, working: 0 })
    // Nothing changed, so nothing is written to the feed.
    expect(
      await db.taskActivity.count({
        where: { taskId: task.id, type: 'ELAPSED_RECOMPUTED' },
      }),
    ).toBe(0)
  })

  it('يستعلم بتقويم الوكالة وحده لمهمة بلا منفّذ', async () => {
    const { project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: null,
      status: 'BACKLOG',
      assignedAt: cairo('2026-03-05T09:00'),
      submittedAt: cairo('2026-03-05T17:00'),
    })

    const elapsed = await recomputeElapsed(db, {
      taskId: task.id,
      calendar: businessDayCalendar(),
      actor,
      now: NOW,
    })

    expect(elapsed.working).toBe(8 * 60)
  })
})

describe('قيم فارغة — منفّذ بلا أجر افتراضي', () => {
  it('يسند المهمة بقيمة صفرية بدل أن يفشل', async () => {
    const { project, actor } = await fixture()
    const noRate = await createUserWithPermissions(db, [], { defaultTaskRate: null })
    const task = await createTaskRow(db, {
      projectId: project.id,
      taskValue: '0.00',
      assigneeId: null,
    })

    const result = await assignTask(db, {
      actor,
      now: NOW,
      input: { taskId: task.id, assigneeId: noRate.id, taskValue: null },
    })

    expect(result.task.taskValue).toBe('0.00')
    expect(result.task.status).toBe('ASSIGNED')
  })

  it('ينشئ مهمة لمنفّذ بلا أجر افتراضي بقيمة صفرية', async () => {
    const { project, actor } = await fixture()
    const noRate = await createUserWithPermissions(db, [], { defaultTaskRate: null })

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), assigneeId: noRate.id },
    })

    expect(result.task.taskValue).toBe('0.00')
    expect(result.task.status).toBe('ASSIGNED')
  })
})

describe('قيم فارغة — مستخدم جديد ومشروع جديد', () => {
  it('لا مهام مفتوحة لمستخدم أُنشئ للتو', async () => {
    await seedPermissionCatalog(db)
    const brandNew = await createUserWithPermissions(db, [])

    expect(await openTasksForUser(db, brandNew.id)).toEqual([])
  })

  it('يعطي إشارات صحة صفرية لمشروع بلا مهام', async () => {
    const { project } = await fixture()

    expect(await taskHealthSignals(NOW)(db, project.id)).toEqual({
      overdueTaskCount: 0,
      maxBlockedDays: 0,
      adminEscalationCount: 0,
    })
  })

  it('يعطي إشارات صفرية لمعرّف مشروع غير موجود بدل أن يفشل', async () => {
    await seedPermissionCatalog(db)

    expect(await taskHealthSignals(NOW)(db, 'no-such-project')).toEqual({
      overdueTaskCount: 0,
      maxBlockedDays: 0,
      adminEscalationCount: 0,
    })
  })

  it('يعيد قائمة مهام فارغة لمستخدم بلا أي مهمة', async () => {
    const { actor } = await fixture()

    const page = await listTasks(db, {
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({}),
      now: NOW,
    })

    expect(page).toMatchObject({ items: [], total: 0, page: 1, pageSize: 25 })
  })
})

describe('قيم فارغة — قوائم فرعية فارغة', () => {
  it('يعيد تعليقات وحركات واعتماديات فارغة لمهمة جديدة', async () => {
    const { project } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id })

    expect(await listComments(db, task.id)).toEqual([])
    expect(await listActivity(db, task.id)).toEqual([])
    expect(await getDependencyWarnings(db, task.id)).toEqual([])
  })

  it('يحفظ تعليقًا بلا إشارات كمصفوفة فارغة لا كقيمة عدمية', async () => {
    const { project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id })

    const comment = await addComment(db, {
      actor,
      now: NOW,
      input: { taskId: task.id, body: 'تعليق بلا إشارات' },
    })

    expect(comment.mentions).toEqual([])

    const row = await db.taskComment.findUniqueOrThrow({ where: { id: comment.id } })
    expect(row.mentions).toEqual([])
  })

  it('لا ينبّه لمهمة بلا اعتماديات عند بدء التنفيذ', async () => {
    const { project } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id })

    expect(await getDependencyWarnings(db, task.id)).toEqual([])
  })
})

describe('قيم فارغة — مرشّحات ونصوص فارغة', () => {
  it('يتجاهل مرشّحات بمصفوفات فارغة', async () => {
    const { project, actor } = await fixture()
    await createTaskRow(db, { projectId: project.id })

    const page = await listTasks(db, {
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({
        status: [],
        priority: [],
        categoryId: [],
        assigneeId: [],
        projectId: [],
        milestoneId: [],
      }),
      now: NOW,
    })

    expect(page.total).toBe(1)
  })

  it('يتجاهل بحثًا بنص فارغ بدل أن يعيد لا شيء', async () => {
    const { project, actor } = await fixture()
    await createTaskRow(db, { projectId: project.id })

    const page = await listTasks(db, {
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({ search: '   ' }),
      now: NOW,
    })

    expect(page.total).toBe(1)
  })
})

describe('قيم فارغة — حالات لا يمكن استئنافها', () => {
  /**
   * A task sitting in BLOCKED with no `STATUS_CHANGED → BLOCKED` row cannot say
   * where it came from. It must refuse loudly rather than guess a status —
   * guessing would move a task into a state the machine never authorised.
   */
  it('يرفض استئناف مهمة معلَّقة بلا سجل تعليق', async () => {
    const { project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id, status: 'BLOCKED' })

    await expect(
      unblockTask(db, { actor, now: NOW, input: { taskId: task.id } }),
    ).rejects.toBeInstanceOf(DomainError)

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.status).toBe('BLOCKED')
  })
})

describe('قيم فارغة — القراءة المفردة', () => {
  it('يعيد مهمة بكل حقولها الاختيارية عدمية دون انهيار', async () => {
    const { project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: null,
      description: null,
      milestoneId: null,
      qualityRating: null,
    })

    const dto = await getTask(db, { scope: scopeTasks(actor), id: task.id, now: NOW })

    expect(dto.assignee).toBeNull()
    expect(dto.description).toBeNull()
    expect(dto.milestoneId).toBeNull()
    expect(dto.qualityRating).toBeNull()
    expect(dto.watchers).toEqual([])
    // Money still crosses the boundary as a string, never null (invariant 2).
    expect(dto.taskValue).toBe('500.00')
  })
})
