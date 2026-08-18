import { describe, expect, it } from 'vitest'

import { DomainError } from '@/lib/errors'
import { MONEY_MAX } from '@/lib/money'
import { scopeTasks } from '@/lib/rbac'
import { SETTINGS_CATALOG } from '@/lib/settings'
import { taskHealthSignals } from '@/modules/project/health'
import { listTasksSchema } from '@/modules/task/schema'
import {
  approveTask,
  assignTask,
  createTask,
  getTask,
  listTasks,
  transitionTask,
  updateTask,
} from '@/modules/task/service'

import {
  createBlockActivity,
  createProject,
  createTask as createTaskRow,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/** The facet horizon, from the catalog rather than a literal (docs/TESTING.md §5). */
const DUE_SOON_DAYS = SETTINGS_CATALOG['tasks.dueSoonDays'].default

const db = testDb()

/**
 * Axis 1 of the edge-case protocol (docs/TESTING.md §4) — **Boundaries**:
 * 0, 1, exactly-at-deadline, one minute after, max values.
 *
 * The money boundaries matter most. `Decimal(12,2)` has a hard ceiling, and
 * `lib/money`'s `fitsColumn` is the only thing standing between a fat-fingered
 * amount and a silently truncated column — the kind of defect that surfaces
 * as a wrong payout months later (CLAUDE.md invariant 2).
 */

const CATEGORIES = [{ id: 'design' }, { id: 'development' }]
const DUE = cairo('2026-03-10T17:00')
const NOW = cairo('2026-03-15T09:00')

async function fixture() {
  await seedPermissionCatalog(db)
  const manager = await createUserWithPermissions(db, [
    'task.create',
    'task.edit',
    'task.assign',
    'task.approve',
    'task.view.all',
  ])
  const worker = await createUserWithPermissions(db, [], { defaultTaskRate: '400.00' })
  const other = await createUserWithPermissions(db, [], { defaultTaskRate: '500.00' })
  const project = await createProject(db, { ownerId: manager.id })
  const actor = await actorFor(db, manager.id)
  return { manager, worker, other, project, actor }
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
    dueDate: DUE,
    watcherIds: [],
  }
}

describe('حدود المال — قيمة المهمة', () => {
  it('يقبل قيمة صفرية', async () => {
    const { project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), taskValue: '0' },
    })

    expect(result.task.taskValue).toBe('0.00')
  })

  it('يقبل أصغر قيمة موجبة (قرش واحد)', async () => {
    const { project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), taskValue: '0.01' },
    })

    expect(result.task.taskValue).toBe('0.01')
  })

  it('يقبل الحد الأقصى للعمود بالضبط', async () => {
    const { project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), taskValue: MONEY_MAX.toFixed(2) },
    })

    expect(result.task.taskValue).toBe(MONEY_MAX.toFixed(2))
  })

  it('يرفض قيمة تتجاوز الحد الأقصى للعمود بقرش واحد', async () => {
    const { project, actor } = await fixture()
    const overflow = MONEY_MAX.plus('0.01').toFixed(2)

    await expect(
      createTask(db, {
        actor,
        categories: CATEGORIES,
        now: NOW,
        input: { ...baseInput(project.id), taskValue: overflow },
      }),
    ).rejects.toBeInstanceOf(DomainError)

    // And nothing was written — the guard runs before the insert.
    expect(await db.task.count()).toBe(0)
  })

  it('يرفض تجاوز الحد الأقصى عند التعديل أيضًا', async () => {
    const { project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id })
    const overflow = MONEY_MAX.plus('0.01').toFixed(2)

    await expect(
      updateTask(db, {
        actor,
        categories: CATEGORIES,
        now: NOW,
        input: {
          id: task.id,
          title: 'مهمة',
          description: null,
          milestoneId: null,
          priority: 'MEDIUM',
          categoryId: 'design',
          estimatedHours: 0,
          taskValue: overflow,
          dueDate: DUE,
          delayReason: null,
          delayAttribution: null,
        },
      }),
    ).rejects.toBeInstanceOf(DomainError)

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.taskValue.toFixed(2)).toBe('500.00')
  })
})

describe('حدود المال — المستحق الجزئي عند إعادة الإسناد (SPEC M4)', () => {
  async function reassignWith(partialAmount: string, taskValue = '400.00') {
    const { worker, other, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      taskValue,
    })

    return assignTask(db, {
      actor,
      now: NOW,
      input: { taskId: task.id, assigneeId: other.id, taskValue: null, partialAmount },
    })
  }

  it('يقبل قرشًا واحدًا', async () => {
    await expect(reassignWith('0.01')).resolves.toBeDefined()
  })

  it('يقبل مبلغًا مساويًا لقيمة المهمة بالضبط', async () => {
    await expect(reassignWith('400.00')).resolves.toBeDefined()
  })

  it('يرفض قرشًا واحدًا فوق قيمة المهمة', async () => {
    await expect(reassignWith('400.01')).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض أي مبلغ على مهمة قيمتها صفر', async () => {
    await expect(reassignWith('0.01', '0.00')).rejects.toBeInstanceOf(DomainError)
  })
})

describe('حدود الساعات التقديرية', () => {
  it('يقبل صفر ساعة وأصغر جزء من الساعة', async () => {
    const { project, actor } = await fixture()

    const zero = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), estimatedHours: 0 },
    })
    const smallest = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), estimatedHours: 0.01 },
    })

    expect(zero.task.estimatedHours).toBe('0.00')
    expect(smallest.task.estimatedHours).toBe('0.01')
  })

  it('يقبل الحد الأقصى المسموح به في المخطط', async () => {
    const { project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), estimatedHours: 9999 },
    })

    expect(result.task.estimatedHours).toBe('9999.00')
  })
})

describe('حدود تقييم الجودة', () => {
  async function approveWith(qualityRating: number) {
    const { worker, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
    })

    return approveTask(db, { actor, now: NOW, input: { taskId: task.id, qualityRating } })
  }

  it('يقبل الطرفين ١ و٥', async () => {
    await expect(approveWith(1)).resolves.toBeDefined()
    await expect(approveWith(5)).resolves.toBeDefined()
  })

  it('يرفض ما دون الواحد وما فوق الخمسة', async () => {
    await expect(approveWith(0)).rejects.toBeInstanceOf(DomainError)
    await expect(approveWith(6)).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض تقييمًا كسريًا', async () => {
    await expect(approveWith(4.5)).rejects.toBeInstanceOf(DomainError)
  })
})

describe('حدود التأخير — لحظة الموعد بالضبط', () => {
  /**
   * SPEC §5.3 and `lib/calendar`'s contract: ranges are half-open, "a task due
   * and submitted at the same instant is 0 days late, not 1". The `isOverdue`
   * flag has to agree — strictly after, never at.
   */
  it('لا تُعد المهمة متأخرة في لحظة الموعد بالضبط', async () => {
    const { project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: DUE,
    })

    const dto = await getTask(db, { scope: scopeTasks(actor), id: task.id, now: DUE })
    expect(dto.isOverdue).toBe(false)
  })

  it('تُعد متأخرة بعد الموعد بمللي ثانية واحدة', async () => {
    const { project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: DUE,
    })

    const dto = await getTask(db, {
      scope: scopeTasks(actor),
      id: task.id,
      now: new Date(DUE.getTime() + 1),
    })
    expect(dto.isOverdue).toBe(true)
  })

  it('يتفق مرشّح المتأخرات مع علامة التأخير عند نفس الحدّ', async () => {
    const { project, actor } = await fixture()
    await createTaskRow(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: DUE,
    })
    const scope = scopeTasks(actor)
    const filters = listTasksSchema.parse({ overdueOnly: true })

    const atDeadline = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope,
      filters,
      now: DUE,
    })
    const oneMsAfter = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope,
      filters,
      now: new Date(DUE.getTime() + 1),
    })

    expect(atDeadline.total).toBe(0)
    expect(oneMsAfter.total).toBe(1)
  })
})

describe('حدود الزمن المنقضي', () => {
  it('يسجّل صفرًا للتسليم في لحظة الإسناد نفسها', async () => {
    const { worker, project, actor } = await fixture()
    const at = cairo('2026-03-02T09:00')
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      assignedAt: at,
    })

    await transitionTask(db, {
      actor,
      now: at,
      input: { taskId: task.id, to: 'SUBMITTED', reason: null },
    })

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.elapsedMinutesRaw).toBe(0)
  })

  it('يسجّل دقيقة واحدة بعد دقيقة، ويهمل الثواني الناقصة', async () => {
    const { worker, project, actor } = await fixture()
    const assignedAt = cairo('2026-03-02T09:00')
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      assignedAt,
    })

    await transitionTask(db, {
      actor,
      now: new Date(assignedAt.getTime() + 119_000), // 1 min 59 s
      input: { taskId: task.id, to: 'SUBMITTED', reason: null },
    })

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.elapsedMinutesRaw).toBe(1)
  })
})

describe('حدود التقسيم إلى صفحات', () => {
  it('يعيد صفحة فارغة سليمة حين لا توجد نتائج', async () => {
    const { actor } = await fixture()

    const page = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({}),
      now: NOW,
    })

    expect(page).toMatchObject({ items: [], total: 0, page: 1 })
  })

  it('يحترم حجم صفحة يساوي واحدًا', async () => {
    const { project, actor } = await fixture()
    await createTaskRow(db, { projectId: project.id })
    await createTaskRow(db, { projectId: project.id })

    const page = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({ pageSize: 1 }),
      now: NOW,
    })

    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(2)
  })

  it('يعيد قائمة فارغة لصفحة بعد نهاية النتائج مع إبقاء الإجمالي صحيحًا', async () => {
    const { project, actor } = await fixture()
    await createTaskRow(db, { projectId: project.id })

    const page = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({ page: 5, pageSize: 25 }),
      now: NOW,
    })

    expect(page.items).toEqual([])
    expect(page.total).toBe(1)
  })

  it('يعيد الصفحة الأخيرة الناقصة كاملة العدّ', async () => {
    const { project, actor } = await fixture()
    for (let i = 0; i < 3; i += 1) await createTaskRow(db, { projectId: project.id })

    const page = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({ page: 2, pageSize: 2 }),
      now: NOW,
    })

    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(3)
  })
})

describe('حدود إشارات صحة المشروع (SPEC §5.7)', () => {
  /**
   * The RAG thresholds are `>` not `>=` (`computeProjectHealth`), so a project
   * sitting exactly on the threshold is not yet RED. Pinned at the signal level
   * because an off-by-one here turns a dashboard into a liar.
   */
  it('يحتسب عدد المتأخرات عند الحد وفوقه بدقة', async () => {
    const { project } = await fixture()
    const past = cairo('2026-03-01T17:00')

    for (let i = 0; i < 3; i += 1) {
      await createTaskRow(db, {
        projectId: project.id,
        status: 'IN_PROGRESS',
        dueDate: past,
      })
    }
    expect((await taskHealthSignals(NOW)(db, project.id)).overdueTaskCount).toBe(3)

    await createTaskRow(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: past,
    })
    expect((await taskHealthSignals(NOW)(db, project.id)).overdueTaskCount).toBe(4)
  })

  it('لا يحتسب مهمة مستحقة في لحظة القياس نفسها متأخرة', async () => {
    const { project } = await fixture()
    await createTaskRow(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: NOW,
    })

    expect((await taskHealthSignals(NOW)(db, project.id)).overdueTaskCount).toBe(0)
  })

  it('يعطي صفر أيام تعليق لمهمة عُلّقت للتو', async () => {
    const { project } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id, status: 'BLOCKED' })
    await createBlockActivity(db, { taskId: task.id, from: 'IN_PROGRESS', at: NOW })

    expect((await taskHealthSignals(NOW)(db, project.id)).maxBlockedDays).toBe(0)
  })

  it('يعطي يومًا واحدًا بعد أربع وعشرين ساعة بالضبط', async () => {
    const { project } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id, status: 'BLOCKED' })
    await createBlockActivity(db, {
      taskId: task.id,
      from: 'IN_PROGRESS',
      at: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    })

    expect((await taskHealthSignals(NOW)(db, project.id)).maxBlockedDays).toBe(1)
  })

  it('لا يحتسب مهمة معلَّقة بلا سجل تعليق', async () => {
    const { project } = await fixture()
    await createTaskRow(db, { projectId: project.id, status: 'BLOCKED' })

    expect((await taskHealthSignals(NOW)(db, project.id)).maxBlockedDays).toBe(0)
  })
})

describe('حدود المتابعين والاعتماديات', () => {
  it('ينشئ مهمة بلا متابعين وبمتابع واحد', async () => {
    const { worker, project, actor } = await fixture()

    const none = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), watcherIds: [] },
    })
    const one = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), watcherIds: [worker.id] },
    })

    expect(none.task.watchers).toEqual([])
    expect(one.task.watchers).toHaveLength(1)
  })

  it('يتجاهل تكرار نفس المتابع في نفس الطلب', async () => {
    const { worker, project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: { ...baseInput(project.id), watcherIds: [worker.id, worker.id] },
    })

    expect(result.task.watchers).toHaveLength(1)
  })

  it('لا يجعل المنفّذ متابعًا لنفسه عند الإنشاء', async () => {
    const { worker, project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: {
        ...baseInput(project.id),
        assigneeId: worker.id,
        watcherIds: [worker.id],
      },
    })

    expect(result.task.watchers).toEqual([])
    expect(result.task.assignee?.id).toBe(worker.id)
  })
})
