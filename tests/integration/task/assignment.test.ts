import { describe, expect, it } from 'vitest'

import type { Db } from '@/lib/db'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import type { AdjustmentIntent, LedgerPort } from '@/modules/task/ports'
import { addWatcher, assignTask, createTask, removeWatcher } from '@/modules/task/service'

import {
  createProject,
  createTask as createTaskRow,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

const CATEGORIES = [{ id: 'design' }, { id: 'development' }]
const NOW = cairo('2026-03-01T09:00')

/** Captures what Phase 7 will receive, so the payload is asserted, not assumed. */
function recordingLedger(): LedgerPort & { intents: AdjustmentIntent[] } {
  const intents: AdjustmentIntent[] = []
  return {
    intents,
    recordAdjustment: async (_db: Db, intent: AdjustmentIntent) => {
      intents.push(intent)
    },
  }
}

async function fixture() {
  await seedPermissionCatalog(db)
  const manager = await createUserWithPermissions(db, ['task.create', 'task.assign'])
  const first = await createUserWithPermissions(db, ['task.edit'], {
    defaultTaskRate: '400.00',
  })
  const second = await createUserWithPermissions(db, ['task.edit'], {
    defaultTaskRate: '750.00',
  })
  const project = await createProject(db, { ownerId: manager.id })
  const actor = await actorFor(db, manager.id)
  return { manager, first, second, project, actor }
}

describe('modules/task — الإسناد الأول', () => {
  it('ينقل المهمة إلى "مسنَدة" ويختم وقت الإسناد', async () => {
    const { first, project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id })

    const result = await assignTask(db, {
      actor,
      input: { taskId: task.id, assigneeId: first.id, taskValue: null },
      now: NOW,
    })

    expect(result.status).toBe('ASSIGNED')
    expect(result.assignee?.id).toBe(first.id)

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.assignedAt).toEqual(NOW)
  })

  it('يملأ قيمة المهمة تلقائيًا من أجر المنفّذ الافتراضي', async () => {
    const { first, project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id, taskValue: '0.00' })

    const result = await assignTask(db, {
      actor,
      input: { taskId: task.id, assigneeId: first.id, taskValue: null },
      now: NOW,
    })

    expect(result.taskValue).toBe('400.00')
  })

  it('يحترم قيمة المهمة الصريحة ولا يستبدلها بالأجر الافتراضي', async () => {
    const { first, project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id, taskValue: '0.00' })

    const result = await assignTask(db, {
      actor,
      input: { taskId: task.id, assigneeId: first.id, taskValue: '1250.50' },
      now: NOW,
    })

    expect(result.taskValue).toBe('1250.50')
  })

  it('يترك القيمة المحددة مسبقًا كما هي عند الإسناد', async () => {
    const { first, project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id, taskValue: '900.00' })

    const result = await assignTask(db, {
      actor,
      input: { taskId: task.id, assigneeId: first.id, taskValue: null },
      now: NOW,
    })

    expect(result.taskValue).toBe('900.00')
  })

  it('يعطي قيمة صفرية لمنفّذ بلا أجر افتراضي', async () => {
    const { project, actor } = await fixture()
    const noRate = await createUserWithPermissions(db, ['task.edit'], {
      defaultTaskRate: null,
    })
    const task = await createTaskRow(db, { projectId: project.id, taskValue: '0.00' })

    const result = await assignTask(db, {
      actor,
      input: { taskId: task.id, assigneeId: noRate.id, taskValue: null },
      now: NOW,
    })

    expect(result.taskValue).toBe('0.00')
  })

  it('يرفض الإسناد لحساب معطّل أو محذوف', async () => {
    const { project, actor } = await fixture()
    const inactive = await createUserWithPermissions(db, [], { isActive: false })
    const deleted = await createUserWithPermissions(db, [], { deletedAt: new Date() })
    const task = await createTaskRow(db, { projectId: project.id })

    await expect(
      assignTask(db, {
        actor,
        input: { taskId: task.id, assigneeId: inactive.id, taskValue: null },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)

    await expect(
      assignTask(db, {
        actor,
        input: { taskId: task.id, assigneeId: deleted.id, taskValue: null },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يرفض إعادة إسناد المهمة لنفس المنفّذ', async () => {
    const { first, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'ASSIGNED',
    })

    await expect(
      assignTask(db, {
        actor,
        input: { taskId: task.id, assigneeId: first.id, taskValue: null },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('modules/task — إعادة الإسناد أثناء التنفيذ (SPEC M4)', () => {
  it('لا ينقل حالة المهمة عند تغيير المنفّذ أثناء التنفيذ', async () => {
    const { first, second, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
      startedAt: cairo('2026-02-20T09:00'),
    })

    const result = await assignTask(db, {
      actor,
      input: { taskId: task.id, assigneeId: second.id, taskValue: null },
      now: NOW,
    })

    expect(result.status).toBe('IN_PROGRESS')
    expect(result.assignee?.id).toBe(second.id)
  })

  it('لا يعيد تسعير المهمة تلقائيًا بأجر المنفّذ الجديد', async () => {
    const { first, second, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
      taskValue: '400.00',
    })

    const result = await assignTask(db, {
      actor,
      input: { taskId: task.id, assigneeId: second.id, taskValue: null },
      now: NOW,
    })

    // The second worker's default rate is 750; repricing silently would change
    // somebody's earnings with nobody deciding it.
    expect(result.taskValue).toBe('400.00')
  })

  it('يصرف مستحقًا جزئيًا للمنفّذ السابق عند طلب ذلك', async () => {
    const { first, second, project, actor } = await fixture()
    const ledger = recordingLedger()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
      taskValue: '400.00',
    })

    await assignTask(db, {
      actor,
      ledger,
      input: {
        taskId: task.id,
        assigneeId: second.id,
        taskValue: null,
        partialAmount: '150.00',
      },
      now: NOW,
    })

    expect(ledger.intents).toHaveLength(1)
    expect(ledger.intents[0]).toMatchObject({
      userId: first.id,
      taskId: task.id,
      amount: '150.00',
      createdById: actor.id,
      at: NOW,
    })
  })

  /**
   * The note becomes `LedgerEntry.note`, which the *worker* reads on their own
   * مستحقاتي page (SPEC B6). "task-id:user-id" would be unreadable there, so it
   * has to name the person and say what the money is for.
   */
  it('يكتب سبب الصرف بالعربية باسم المنفّذ السابق', async () => {
    const { first, second, project, actor } = await fixture()
    const ledger = recordingLedger()
    const previous = await db.user.findUniqueOrThrow({ where: { id: first.id } })
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
      taskValue: '400.00',
    })

    await assignTask(db, {
      actor,
      ledger,
      input: {
        taskId: task.id,
        assigneeId: second.id,
        taskValue: null,
        partialAmount: '150.00',
      },
      now: NOW,
    })

    expect(ledger.intents[0]?.note).toContain(previous.fullName)
    expect(ledger.intents[0]?.note).not.toContain(task.id)
  })

  it('لا يصرف شيئًا حين لا يطلب المدير ذلك', async () => {
    const { first, second, project, actor } = await fixture()
    const ledger = recordingLedger()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
    })

    await assignTask(db, {
      actor,
      ledger,
      input: { taskId: task.id, assigneeId: second.id, taskValue: null },
      now: NOW,
    })

    expect(ledger.intents).toHaveLength(0)
  })

  /**
   * The ledger is Phase 7's, so today's port is a no-op. The decision still has
   * to survive: the audit row is what Phase 7 can replay.
   */
  it('يسجّل نية الصرف في سجل التدقيق حتى قبل وجود دفتر الحسابات', async () => {
    const { first, second, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
      taskValue: '400.00',
    })

    // No `ledger` passed at all — the production default (`noopLedgerPort`).
    await assignTask(db, {
      actor,
      input: {
        taskId: task.id,
        assigneeId: second.id,
        taskValue: null,
        partialAmount: '175.25',
      },
      now: NOW,
    })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'task.partialPaymentIntent', entityId: task.id },
    })
    expect(audit.after).toMatchObject({
      userId: first.id,
      amount: '175.25',
      type: 'ADJUSTMENT',
    })
  })

  it('يرفض مستحقًا جزئيًا يتجاوز قيمة المهمة', async () => {
    const { first, second, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
      taskValue: '400.00',
    })

    await expect(
      assignTask(db, {
        actor,
        input: {
          taskId: task.id,
          assigneeId: second.id,
          taskValue: null,
          partialAmount: '400.01',
        },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يقبل مستحقًا جزئيًا مساويًا لقيمة المهمة بالضبط', async () => {
    const { first, second, project, actor } = await fixture()
    const ledger = recordingLedger()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
      taskValue: '400.00',
    })

    await assignTask(db, {
      actor,
      ledger,
      input: {
        taskId: task.id,
        assigneeId: second.id,
        taskValue: null,
        partialAmount: '400.00',
      },
      now: NOW,
    })

    expect(ledger.intents[0]?.amount).toBe('400.00')
  })

  it('يرفض مستحقًا جزئيًا لمهمة بلا منفّذ سابق', async () => {
    const { first, project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id, taskValue: '400.00' })

    await expect(
      assignTask(db, {
        actor,
        input: {
          taskId: task.id,
          assigneeId: first.id,
          taskValue: null,
          partialAmount: '100.00',
        },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يسجّل تغيير المنفّذ في سجل المهمة وسجل التدقيق', async () => {
    const { first, second, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'IN_PROGRESS',
    })

    await assignTask(db, {
      actor,
      input: { taskId: task.id, assigneeId: second.id, taskValue: null },
      now: NOW,
    })

    const activity = await db.taskActivity.findFirstOrThrow({
      where: { taskId: task.id, type: 'ASSIGNED' },
    })
    expect(activity.from).toBe(first.id)
    expect(activity.to).toBe(second.id)

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'task.reassigned', entityId: task.id },
    })
    expect(audit.before).toMatchObject({ assigneeId: first.id })
    expect(audit.after).toMatchObject({ assigneeId: second.id })
  })
})

describe('modules/task — الإنشاء مع منفّذ', () => {
  it('ينشئ المهمة مسنَدة مباشرة حين يُعطى منفّذ', async () => {
    const { first, project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: {
        projectId: project.id,
        title: 'تصميم الغلاف',
        description: null,
        milestoneId: null,
        assigneeId: first.id,
        priority: 'HIGH',
        categoryId: 'design',
        estimatedHours: 6,
        taskValue: null,
        dueDate: cairo('2026-03-15T17:00'),
        watcherIds: [],
      },
    })

    expect(result.task.status).toBe('ASSIGNED')
    expect(result.task.assignedAt).toEqual(NOW)
    expect(result.task.taskValue).toBe('400.00')
    expect(result.task.originalDueDate).toEqual(result.task.dueDate)
  })

  it('ينشئ المهمة في قائمة الانتظار بلا منفّذ', async () => {
    const { project, actor } = await fixture()

    const result = await createTask(db, {
      actor,
      categories: CATEGORIES,
      now: NOW,
      input: {
        projectId: project.id,
        title: 'مهمة بلا منفّذ',
        description: null,
        milestoneId: null,
        assigneeId: null,
        priority: 'MEDIUM',
        categoryId: 'design',
        estimatedHours: 0,
        taskValue: null,
        dueDate: cairo('2026-03-15T17:00'),
        watcherIds: [],
      },
    })

    expect(result.task.status).toBe('BACKLOG')
    expect(result.task.assignedAt).toBeNull()
    expect(result.task.taskValue).toBe('0.00')
  })

  it('يرفض تصنيفًا غير موجود في الإعدادات', async () => {
    const { project, actor } = await fixture()

    await expect(
      createTask(db, {
        actor,
        categories: CATEGORIES,
        now: NOW,
        input: {
          projectId: project.id,
          title: 'مهمة',
          description: null,
          milestoneId: null,
          assigneeId: null,
          priority: 'MEDIUM',
          categoryId: 'no-such-category',
          estimatedHours: 0,
          taskValue: null,
          dueDate: cairo('2026-03-15T17:00'),
          watcherIds: [],
        },
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('modules/task — المتابعون', () => {
  it('يضيف متابعًا ويزيله ويسجّل الحركتين', async () => {
    const { first, second, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'ASSIGNED',
    })

    await addWatcher(db, {
      actor,
      input: { taskId: task.id, userId: second.id },
      now: NOW,
    })
    expect(await db.taskWatcher.count({ where: { taskId: task.id } })).toBe(1)

    await removeWatcher(db, {
      actor,
      input: { taskId: task.id, userId: second.id },
      now: NOW,
    })
    expect(await db.taskWatcher.count({ where: { taskId: task.id } })).toBe(0)

    const activity = await db.taskActivity.findMany({
      where: { taskId: task.id, type: { in: ['WATCHER_ADDED', 'WATCHER_REMOVED'] } },
      orderBy: { type: 'asc' },
    })
    expect(activity).toHaveLength(2)
  })

  it('يرفض جعل المنفّذ متابعًا لمهمته', async () => {
    const { first, project, actor } = await fixture()
    const task = await createTaskRow(db, {
      projectId: project.id,
      assigneeId: first.id,
      status: 'ASSIGNED',
    })

    await expect(
      addWatcher(db, {
        actor,
        input: { taskId: task.id, userId: first.id },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('لا يكرّر المتابع نفسه', async () => {
    const { second, project, actor } = await fixture()
    const task = await createTaskRow(db, { projectId: project.id })

    await addWatcher(db, {
      actor,
      input: { taskId: task.id, userId: second.id },
      now: NOW,
    })
    await addWatcher(db, {
      actor,
      input: { taskId: task.id, userId: second.id },
      now: NOW,
    })

    expect(await db.taskWatcher.count({ where: { taskId: task.id } })).toBe(1)
  })
})
