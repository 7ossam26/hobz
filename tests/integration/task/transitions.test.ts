import { describe, expect, it } from 'vitest'

import { DomainError, NotFoundError } from '@/lib/errors'
import {
  approveTask,
  blockTask,
  cancelTask,
  completeTask,
  requestRevision,
  reviewTask,
  startTask,
  submitTask,
  transitionTask,
  unblockTask,
} from '@/modules/task/service'
import { TASK_STATUSES, type TaskStatus } from '@/modules/task/state-machine'

import {
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
  type CreatedUser,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * SPEC §5.1 against a real database. The pure matrix lives in
 * tests/unit/task/state-machine.test.ts; what is proved here is that the
 * *service* honours it — that each transition writes its timestamp, its
 * activity row and its audit row, and that an illegal one changes nothing.
 */

const T = {
  create: cairo('2026-03-01T09:00'),
  start: cairo('2026-03-02T10:00'),
  submit: cairo('2026-03-03T16:00'),
  review: cairo('2026-03-04T09:00'),
  approve: cairo('2026-03-05T11:00'),
  done: cairo('2026-03-05T12:00'),
}

async function fixture() {
  await seedPermissionCatalog(db)
  const manager = await createUserWithPermissions(db, [
    'task.create',
    'task.edit',
    'task.assign',
    'task.approve',
    'task.cancel',
  ])
  const worker = await createUserWithPermissions(db, ['task.edit'], {
    defaultTaskRate: '400.00',
  })
  const project = await createProject(db, { ownerId: manager.id })
  const actor = await actorFor(db, manager.id)
  return { manager, worker, project, actor }
}

/** Walks a task to `target` through the legal path, using the service itself. */
async function taskInStatus(
  target: TaskStatus,
  ctx: {
    worker: CreatedUser
    project: { id: string }
    actor: Awaited<ReturnType<typeof actorFor>>
  },
): Promise<string> {
  const task = await createTask(db, {
    projectId: ctx.project.id,
    assigneeId: ctx.worker.id,
    status: 'ASSIGNED',
    assignedAt: T.create,
  })
  const input = { taskId: task.id }
  const base = { actor: ctx.actor, input }

  if (target === 'BACKLOG' || target === 'ASSIGNED') {
    if (target === 'BACKLOG') {
      await db.task.update({
        where: { id: task.id },
        data: { status: 'BACKLOG', assigneeId: null, assignedAt: null },
      })
    }
    return task.id
  }

  await startTask(db, { ...base, now: T.start })
  if (target === 'IN_PROGRESS') return task.id

  await submitTask(db, { ...base, now: T.submit })
  if (target === 'SUBMITTED') return task.id

  await reviewTask(db, { ...base, now: T.review })
  if (target === 'IN_REVIEW') return task.id

  if (target === 'REVISION_REQUESTED') {
    await requestRevision(db, {
      actor: ctx.actor,
      input: {
        taskId: task.id,
        reason: 'الألوان غير مطابقة',
        newDueDate: cairo('2026-03-20T17:00'),
      },
      now: T.approve,
    })
    return task.id
  }

  if (target === 'BLOCKED') {
    await blockTask(db, {
      actor: ctx.actor,
      input: { taskId: task.id, reason: 'في انتظار العميل' },
      now: T.approve,
    })
    return task.id
  }

  if (target === 'CANCELLED') {
    await cancelTask(db, {
      actor: ctx.actor,
      input: { taskId: task.id, reason: 'أُلغي النطاق' },
      now: T.approve,
    })
    return task.id
  }

  await approveTask(db, {
    actor: ctx.actor,
    input: { taskId: task.id, qualityRating: 4 },
    now: T.approve,
  })
  if (target === 'APPROVED') return task.id

  await completeTask(db, { ...base, now: T.done })
  return task.id
}

describe('modules/task — المسار الكامل (SPEC §5.1)', () => {
  it('يمرّ بالمهمة من الإسناد حتى الإنهاء ويختم كل وقت في موضعه', async () => {
    const { worker, project, actor } = await fixture()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'ASSIGNED',
      assignedAt: T.create,
    })
    const base = { actor, input: { taskId: task.id } }

    await startTask(db, { ...base, now: T.start })
    await submitTask(db, { ...base, now: T.submit })
    await reviewTask(db, { ...base, now: T.review })
    await approveTask(db, {
      actor,
      input: { taskId: task.id, qualityRating: 5 },
      now: T.approve,
    })
    const final = await completeTask(db, { ...base, now: T.done })

    expect(final.task.status).toBe('DONE')

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.assignedAt).toEqual(T.create)
    expect(row.startedAt).toEqual(T.start)
    expect(row.submittedAt).toEqual(T.submit)
    expect(row.approvedAt).toEqual(T.approve)
    expect(row.qualityRating).toBe(5)
  })

  it('يسجّل كل انتقال في سجل المهمة وفي سجل التدقيق', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('IN_PROGRESS', { worker, project, actor })

    const activity = await db.taskActivity.findMany({
      where: { taskId, type: 'STATUS_CHANGED' },
      orderBy: { createdAt: 'asc' },
    })
    expect(activity.map((a) => [a.from, a.to])).toEqual([['ASSIGNED', 'IN_PROGRESS']])
    expect(activity[0]?.createdAt).toEqual(T.start)
    expect(activity[0]?.actorId).toBe(actor.id)

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'task.statusChanged', entityId: taskId },
    })
    expect(audit.before).toMatchObject({ status: 'ASSIGNED' })
    expect(audit.after).toMatchObject({ status: 'IN_PROGRESS' })
  })
})

describe('modules/task — الانتقالات غير القانونية', () => {
  it('يرفض كل انتقال غير منصوص عليه من كل حالة', async () => {
    const { worker, project, actor } = await fixture()

    const legal: Record<TaskStatus, TaskStatus[]> = {
      BACKLOG: ['ASSIGNED', 'BLOCKED', 'CANCELLED'],
      ASSIGNED: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
      IN_PROGRESS: ['SUBMITTED', 'BLOCKED', 'CANCELLED'],
      SUBMITTED: ['IN_REVIEW', 'BLOCKED', 'CANCELLED'],
      IN_REVIEW: ['APPROVED', 'REVISION_REQUESTED', 'BLOCKED', 'CANCELLED'],
      REVISION_REQUESTED: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
      APPROVED: ['DONE', 'CANCELLED'],
      DONE: [],
      // The recorded previous status here is IN_REVIEW (see `taskInStatus`).
      BLOCKED: ['IN_REVIEW', 'CANCELLED'],
      CANCELLED: [],
    }

    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        if (legal[from].includes(to)) continue

        const taskId = await taskInStatus(from, { worker, project, actor })
        await expect(
          transitionTask(db, {
            actor,
            input: { taskId, to, reason: 'سبب' },
            qualityRating: 3,
            newDueDate: cairo('2026-04-01T17:00'),
            now: T.done,
          }),
          `${from} → ${to} must throw`,
        ).rejects.toBeInstanceOf(DomainError)

        const row = await db.task.findUniqueOrThrow({ where: { id: taskId } })
        expect(row.status, `${from} → ${to} must not change the row`).toBe(from)
      }
    }
  })

  it('لا يكتب انتقال مرفوض أي أثر في سجل المهمة', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('BACKLOG', { worker, project, actor })
    const before = await db.taskActivity.count({ where: { taskId } })

    await expect(
      transitionTask(db, {
        actor,
        input: { taskId, to: 'SUBMITTED', reason: null },
        now: T.submit,
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(await db.taskActivity.count({ where: { taskId } })).toBe(before)
  })

  it('يرفض الانتقال لمهمة غير موجودة', async () => {
    const { actor } = await fixture()

    await expect(
      transitionTask(db, {
        actor,
        input: { taskId: 'no-such-task', to: 'ASSIGNED', reason: null },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/task — ختم الأوقات مرة واحدة', () => {
  it('لا يعيد ختم startedAt عند العودة من التعديل', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('REVISION_REQUESTED', { worker, project, actor })

    const afterRevision = await db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(afterRevision.startedAt).toEqual(T.start)

    await startTask(db, {
      actor,
      input: { taskId },
      now: cairo('2026-03-10T09:00'),
    })

    const restarted = await db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(restarted.startedAt).toEqual(T.start)
  })

  it('لا يعيد ختم assignedAt بعد أول إسناد', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('IN_PROGRESS', { worker, project, actor })

    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(row.assignedAt).toEqual(T.create)
  })

  /**
   * SPEC §5.1's one deliberate exception: the column tracks the latest
   * delivery, and the original survives in the activity feed.
   */
  it('يعيد ختم submittedAt عند إعادة التسليم ويحفظ الأصلي في سجل المهمة', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('REVISION_REQUESTED', { worker, project, actor })
    const resubmit = cairo('2026-03-12T14:00')

    await startTask(db, { actor, input: { taskId }, now: cairo('2026-03-10T09:00') })
    await submitTask(db, { actor, input: { taskId }, now: resubmit })

    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(row.submittedAt).toEqual(resubmit)

    const submissions = await db.taskActivity.findMany({
      where: { taskId, type: 'STATUS_CHANGED', to: 'SUBMITTED' },
      orderBy: { createdAt: 'asc' },
    })
    expect(submissions).toHaveLength(2)
    expect(submissions[0]?.createdAt).toEqual(T.submit)
    expect(submissions[1]?.createdAt).toEqual(resubmit)
  })

  it('يحتسب الزمن الخام من الإسناد حتى التسليم', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('SUBMITTED', { worker, project, actor })

    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } })
    const expected = Math.floor((T.submit.getTime() - T.create.getTime()) / 60_000)
    expect(row.elapsedMinutesRaw).toBe(expected)
    // Working time is `lib/calendar`'s, and that is Phase 6: the job-updated
    // column stays untouched until a real calendar answers.
    expect(row.elapsedMinutesWorking).toBe(0)
  })
})

describe('modules/task — التعليق والاستئناف', () => {
  it('يستأنف المهمة إلى حالتها السابقة المسجَّلة', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('IN_PROGRESS', { worker, project, actor })

    await blockTask(db, {
      actor,
      input: { taskId, reason: 'في انتظار ملفات العميل' },
      now: T.review,
    })
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe(
      'BLOCKED',
    )

    const resumed = await unblockTask(db, { actor, input: { taskId }, now: T.approve })
    expect(resumed.task.status).toBe('IN_PROGRESS')
  })

  it('يستأنف إلى الحالة الأحدث عند التعليق أكثر من مرة', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('IN_PROGRESS', { worker, project, actor })

    await blockTask(db, {
      actor,
      input: { taskId, reason: 'أول تعليق' },
      now: cairo('2026-03-03T09:00'),
    })
    await unblockTask(db, { actor, input: { taskId }, now: cairo('2026-03-03T10:00') })
    await submitTask(db, { actor, input: { taskId }, now: cairo('2026-03-03T11:00') })
    await blockTask(db, {
      actor,
      input: { taskId, reason: 'تعليق ثانٍ' },
      now: cairo('2026-03-03T12:00'),
    })

    const resumed = await unblockTask(db, {
      actor,
      input: { taskId },
      now: cairo('2026-03-03T13:00'),
    })
    expect(resumed.task.status).toBe('SUBMITTED')
  })

  it('يرفض استئناف مهمة غير معلَّقة', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('IN_PROGRESS', { worker, project, actor })

    await expect(
      unblockTask(db, { actor, input: { taskId }, now: T.approve }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض التعليق بلا سبب', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('IN_PROGRESS', { worker, project, actor })

    await expect(
      transitionTask(db, {
        actor,
        input: { taskId, to: 'BLOCKED', reason: null },
        now: T.review,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('modules/task — الاعتماد وطلب التعديل', () => {
  it('يرفض الاعتماد بلا تقييم جودة', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('IN_REVIEW', { worker, project, actor })

    await expect(
      transitionTask(db, {
        actor,
        input: { taskId, to: 'APPROVED', reason: null },
        now: T.approve,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض تقييم جودة خارج النطاق ١–٥', async () => {
    const { worker, project, actor } = await fixture()

    for (const rating of [0, 6, -1]) {
      const taskId = await taskInStatus('IN_REVIEW', { worker, project, actor })
      await expect(
        transitionTask(db, {
          actor,
          input: { taskId, to: 'APPROVED', reason: null },
          qualityRating: rating,
          now: T.approve,
        }),
      ).rejects.toBeInstanceOf(DomainError)
    }
  })

  /** SPEC T4: a revision request sets a new due date, `originalDueDate` stays. */
  it('ينقل موعد التسليم عند طلب التعديل ويحفظ الموعد الأصلي', async () => {
    const { worker, project, actor } = await fixture()
    const originalDue = cairo('2026-03-10T17:00')
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
      dueDate: originalDue,
      originalDueDate: originalDue,
      assignedAt: T.create,
      submittedAt: T.submit,
    })
    const newDue = cairo('2026-03-20T17:00')

    await requestRevision(db, {
      actor,
      input: { taskId: task.id, reason: 'الخط غير صحيح', newDueDate: newDue },
      now: T.approve,
    })

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.status).toBe('REVISION_REQUESTED')
    expect(row.dueDate).toEqual(newDue)
    expect(row.originalDueDate).toEqual(originalDue)

    const dueChange = await db.taskActivity.findFirstOrThrow({
      where: { taskId: task.id, type: 'DUE_DATE_CHANGED' },
    })
    expect(dueChange.from).toBe(originalDue.toISOString())
    expect(dueChange.to).toBe(newDue.toISOString())
  })

  it('يسجّل سبب طلب التعديل في سجل التدقيق', async () => {
    const { worker, project, actor } = await fixture()
    const taskId = await taskInStatus('IN_REVIEW', { worker, project, actor })

    await requestRevision(db, {
      actor,
      input: {
        taskId,
        reason: 'المقاس غير مطابق للمواصفات',
        newDueDate: cairo('2026-03-25T17:00'),
      },
      now: T.approve,
    })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'task.revisionRequested', entityId: taskId },
    })
    expect(audit.reason).toBe('المقاس غير مطابق للمواصفات')
  })
})
