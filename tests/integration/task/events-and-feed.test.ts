import { describe, expect, it } from 'vitest'

import type { Db } from '@/lib/db'
import type { TaskDomainEvent, TaskEventBus } from '@/modules/task/ports'
import {
  addComment,
  approveTask,
  cancelTask,
  listActivity,
  listComments,
  recomputeElapsed,
} from '@/modules/task/service'

import {
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { businessDayCalendar } from '../../helpers/calendar'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const NOW = cairo('2026-03-05T11:00')

/** Captures exactly what Phase 7 will subscribe to. */
function recordingBus(): TaskEventBus & { events: TaskDomainEvent[] } {
  const events: TaskDomainEvent[] = []
  return {
    events,
    emit: async (_db: Db, event: TaskDomainEvent) => {
      events.push(event)
    },
  }
}

async function fixture() {
  await seedPermissionCatalog(db)
  const manager = await createUserWithPermissions(db, ['task.approve', 'task.cancel'])
  const worker = await createUserWithPermissions(db, ['task.comment'], {
    username: 'ahmed',
  })
  const project = await createProject(db, { ownerId: manager.id })
  const actor = await actorFor(db, manager.id)
  return { manager, worker, project, actor }
}

describe('modules/task — حدث اعتماد المهمة (SPEC §5.1)', () => {
  it('يطلق TaskApproved بقيمة المهمة والتقييم عند الاعتماد', async () => {
    const { worker, project, actor } = await fixture()
    const events = recordingBus()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
      taskValue: '650.00',
    })

    await approveTask(db, {
      actor,
      events,
      input: { taskId: task.id, qualityRating: 4 },
      now: NOW,
    })

    expect(events.events).toEqual([
      {
        type: 'TaskApproved',
        taskId: task.id,
        projectId: project.id,
        assigneeId: worker.id,
        taskValue: '650.00',
        qualityRating: 4,
        approvedAt: NOW,
        approvedById: actor.id,
      },
    ])
  })

  it('لا يطلق حدثًا حين يفشل الاعتماد', async () => {
    const { worker, project, actor } = await fixture()
    const events = recordingBus()
    // ASSIGNED → APPROVED is not a legal edge.
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'ASSIGNED',
    })

    await expect(
      approveTask(db, {
        actor,
        events,
        input: { taskId: task.id, qualityRating: 4 },
        now: NOW,
      }),
    ).rejects.toThrow()

    expect(events.events).toEqual([])
  })

  /**
   * SPEC §5.1 makes APPROVED → CANCELLED legal (APPROVED is not final), so a
   * cancellation can land after the money did. `wasApproved` is how Phase 7
   * learns it owes a REVERSAL rather than nothing.
   */
  it('يطلق TaskCancelled ويخبر بأن المهمة كانت معتمدة', async () => {
    const { worker, project, actor } = await fixture()
    const events = recordingBus()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'APPROVED',
      approvedAt: cairo('2026-03-04T10:00'),
      taskValue: '650.00',
    })

    await cancelTask(db, {
      actor,
      events,
      input: { taskId: task.id, reason: 'العميل ألغى النطاق' },
      now: NOW,
    })

    expect(events.events[0]).toMatchObject({
      type: 'TaskCancelled',
      taskId: task.id,
      assigneeId: worker.id,
      wasApproved: true,
      reason: 'العميل ألغى النطاق',
      cancelledById: actor.id,
    })
  })

  it('يطلق TaskCancelled بلا اعتماد سابق للمهام غير المعتمدة', async () => {
    const { worker, project, actor } = await fixture()
    const events = recordingBus()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
    })

    await cancelTask(db, {
      actor,
      events,
      input: { taskId: task.id, reason: 'لم تعد مطلوبة' },
      now: NOW,
    })

    expect(events.events[0]).toMatchObject({ wasApproved: false })
  })
})

describe('modules/task — التعليقات والإشارات', () => {
  it('يحفظ التعليق ويحوّل الإشارات إلى معرّفات مستخدمين', async () => {
    const { worker, project, actor } = await fixture()
    const task = await createTask(db, { projectId: project.id })

    const comment = await addComment(db, {
      actor,
      input: { taskId: task.id, body: 'من فضلك راجع هذا @ahmed قبل الغد' },
      now: NOW,
    })

    expect(comment.mentions).toEqual([worker.id])
    expect(comment.author.id).toBe(actor.id)
    expect(comment.createdAt).toEqual(NOW)
  })

  it('يتجاهل إشارة لاسم مستخدم غير موجود', async () => {
    const { project, actor } = await fixture()
    const task = await createTask(db, { projectId: project.id })

    const comment = await addComment(db, {
      actor,
      input: { taskId: task.id, body: '@nobody و @ahmed' },
      now: NOW,
    })

    expect(comment.mentions).toHaveLength(1)
  })

  it('يتجاهل إشارة لمستخدم محذوف ناعمًا', async () => {
    const { worker, project, actor } = await fixture()
    const task = await createTask(db, { projectId: project.id })
    await db.user.update({
      where: { id: worker.id },
      data: { deletedAt: new Date() },
    })

    const comment = await addComment(db, {
      actor,
      input: { taskId: task.id, body: 'مرحبًا @ahmed' },
      now: NOW,
    })

    expect(comment.mentions).toEqual([])
  })

  it('يحفظ التعليق بلا إشارات كما هو', async () => {
    const { project, actor } = await fixture()
    const task = await createTask(db, { projectId: project.id })

    const comment = await addComment(db, {
      actor,
      input: { taskId: task.id, body: 'تعليق بلا إشارات' },
      now: NOW,
    })

    expect(comment.mentions).toEqual([])
    expect(comment.body).toBe('تعليق بلا إشارات')
  })

  it('يعيد التعليقات بترتيب زمني', async () => {
    const { project, actor } = await fixture()
    const task = await createTask(db, { projectId: project.id })

    await addComment(db, {
      actor,
      input: { taskId: task.id, body: 'الأول' },
      now: cairo('2026-03-05T09:00'),
    })
    await addComment(db, {
      actor,
      input: { taskId: task.id, body: 'الثاني' },
      now: cairo('2026-03-05T10:00'),
    })

    const comments = await listComments(db, task.id)
    expect(comments.map((c) => c.body)).toEqual(['الأول', 'الثاني'])
  })

  it('يسجّل التعليق في سجل المهمة وسجل التدقيق', async () => {
    const { project, actor } = await fixture()
    const task = await createTask(db, { projectId: project.id })

    const comment = await addComment(db, {
      actor,
      input: { taskId: task.id, body: 'مرحبًا @ahmed' },
      now: NOW,
    })

    const activity = await db.taskActivity.findFirstOrThrow({
      where: { taskId: task.id, type: 'COMMENTED' },
    })
    expect(activity.to).toBe(comment.id)

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'task.commented', entityId: task.id },
    })
    expect(audit.after).toMatchObject({ commentId: comment.id })
  })
})

describe('modules/task — سجل المهمة الكامل', () => {
  it('يعيد الحركات بترتيب زمني مع منفّذها', async () => {
    const { worker, project, actor } = await fixture()
    const events = recordingBus()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
    })

    await addComment(db, {
      actor,
      input: { taskId: task.id, body: 'تعليق' },
      now: cairo('2026-03-05T10:00'),
    })
    await approveTask(db, {
      actor,
      events,
      input: { taskId: task.id, qualityRating: 3 },
      now: NOW,
    })

    const feed = await listActivity(db, task.id)
    expect(feed.map((a) => a.type)).toEqual(['COMMENTED', 'STATUS_CHANGED'])
    expect(feed[1]).toMatchObject({ from: 'IN_REVIEW', to: 'APPROVED' })
    expect(feed[0]?.actor?.id).toBe(actor.id)
  })
})

describe('modules/task — إعادة احتساب زمن العمل', () => {
  it('يكتب الزمنين من التقويم', async () => {
    const { worker, project, actor } = await fixture()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'SUBMITTED',
      // Thursday 09:00 → Sunday 17:00, with Friday and Saturday off.
      assignedAt: cairo('2026-03-05T09:00'),
      submittedAt: cairo('2026-03-08T17:00'),
    })

    const result = await recomputeElapsed(db, {
      taskId: task.id,
      calendar: businessDayCalendar(),
      actor,
      now: NOW,
    })

    expect(result.working).toBe(2 * 8 * 60)

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.elapsedMinutesWorking).toBe(2 * 8 * 60)
    expect(row.elapsedMinutesRaw).toBe(result.raw)
  })

  /** docs/TESTING.md §4 axis 5 — the job must be safe to run repeatedly. */
  it('تشغيله عشر مرات يعطي نفس النتيجة وسطرًا واحدًا في السجل', async () => {
    const { worker, project, actor } = await fixture()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'SUBMITTED',
      assignedAt: cairo('2026-03-05T09:00'),
      submittedAt: cairo('2026-03-05T17:00'),
    })
    const calendar = businessDayCalendar()

    for (let i = 0; i < 10; i += 1) {
      await recomputeElapsed(db, { taskId: task.id, calendar, actor, now: NOW })
    }

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.elapsedMinutesWorking).toBe(8 * 60)

    const recomputes = await db.taskActivity.count({
      where: { taskId: task.id, type: 'ELAPSED_RECOMPUTED' },
    })
    expect(recomputes).toBe(1)
  })

  it('يعطي صفرًا لمهمة لم تُسلَّم بعد', async () => {
    const { worker, project, actor } = await fixture()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      assignedAt: cairo('2026-03-05T09:00'),
    })

    const result = await recomputeElapsed(db, {
      taskId: task.id,
      calendar: businessDayCalendar(),
      actor,
      now: NOW,
    })

    expect(result).toEqual({ raw: 0, working: 0 })
  })
})
