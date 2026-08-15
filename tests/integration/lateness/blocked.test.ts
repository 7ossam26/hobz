import { describe, expect, it } from 'vitest'

import { calendarFor } from '@/lib/calendar'
import { runScheduleRecompute } from '@/modules/calendar/job'
import { latenessForTask } from '@/modules/lateness/service'
import { blockTask, submitTask, unblockTask } from '@/modules/task/service'

import {
  createHoliday,
  createLeave,
  createProject,
  createTask,
  createUser,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * SPEC §5.3, as amended: a BLOCKED task does not accrue lateness while it is
 * blocked, and the exclusion is read from `TaskActivity`.
 *
 * The unit suite (`tests/unit/lateness/blocked.test.ts`) pins the arithmetic
 * against hand-built intervals. What *this* file proves is the part a fake
 * cannot: that the intervals the state machine actually writes — through
 * `blockTask` and `unblockTask`, with the real `from`/`to` rows — are the ones
 * lateness reads back. A rule that is correct against invented input and blind
 * to real rows would pass the unit suite completely.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
/** No grace, so the arithmetic in each case is the block and nothing else. */
const NO_GRACE = 0

async function fixture() {
  const owner = await createUser(db)
  const worker = await createUser(db)
  const project = await createProject(db, { ownerId: owner.id, gracePeriodHours: 0 })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'IN_PROGRESS',
    dueDate: DUE,
    originalDueDate: DUE,
    assignedAt: cairo('2026-02-24T09:00'),
  })
  return { project, worker, task, actor: await actorFor(db, owner.id) }
}

const lateness = (taskId: string, now: Date) =>
  latenessForTask(db, {
    taskId,
    calendar: calendarFor(db),
    defaultGraceHours: NO_GRACE,
    now,
  })

describe('التأخير لا يتراكم أثناء التعليق — عبر آلة الحالة الحقيقية', () => {
  it('التعليق قبل الموعد واستمراره بعده يعطي صفرًا', async () => {
    const { task, actor } = await fixture()

    await blockTask(db, {
      actor,
      now: cairo('2026-03-01T09:00'),
      input: { taskId: task.id, reason: 'في انتظار مواد من العميل' },
    })

    const result = await lateness(task.id, cairo('2026-03-13T12:00'))
    expect(result.lateWorkingDays).toBe(0)
    expect(result.blockedWorkingDays).toBe(9)
  })

  it('التعليق بعد التأخر يوقف التراكم ولا يمحو ما سبقه', async () => {
    const { task, actor } = await fixture()

    await blockTask(db, {
      actor,
      now: cairo('2026-03-05T09:00'),
      input: { taskId: task.id, reason: 'اعتمادية غير جاهزة' },
    })

    // Monday through Thursday were the منفّذ's; the week that follows was not.
    const result = await lateness(task.id, cairo('2026-03-13T12:00'))
    expect(result.lateWorkingDays).toBe(4)
    expect(result.blockedWorkingDays).toBe(5)
  })

  it('الاستئناف يعيد التأخير للتراكم، والفترة السابقة تبقى مخصومة', async () => {
    const { task, actor } = await fixture()

    await blockTask(db, {
      actor,
      now: cairo('2026-03-02T00:00'),
      input: { taskId: task.id, reason: 'انتظار' },
    })
    await unblockTask(db, {
      actor,
      now: cairo('2026-03-05T00:00'),
      input: { taskId: task.id },
    })

    // The task is IN_PROGRESS again — a "skip while currently blocked" rule
    // would answer 6 here — and the three blocked days are still excused.
    const resumed = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { status: true },
    })
    expect(resumed.status).toBe('IN_PROGRESS')

    const result = await lateness(task.id, cairo('2026-03-09T12:00'))
    expect(result.lateWorkingDays).toBe(3)
    expect(result.blockedWorkingDays).toBe(3)
  })

  it('عدة فترات تعليق تُخصم جميعها', async () => {
    const { task, actor } = await fixture()

    for (const [from, to] of [
      ['2026-03-02T00:00', '2026-03-04T00:00'],
      ['2026-03-05T00:00', '2026-03-09T00:00'],
    ] as const) {
      await blockTask(db, {
        actor,
        now: cairo(from),
        input: { taskId: task.id, reason: 'انتظار' },
      })
      await unblockTask(db, { actor, now: cairo(to), input: { taskId: task.id } })
    }

    const result = await lateness(task.id, cairo('2026-03-09T12:00'))
    expect(result.blockedWorkingDays).toBe(4)
    expect(result.lateWorkingDays).toBe(2)
  })

  it('عطلة رسمية وإجازة معتمدة داخل التعليق لا تُخصمان مرتين', async () => {
    const { task, worker, actor } = await fixture()
    await createHoliday(db, { date: '2026-03-03' })
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-04',
      endDate: '2026-03-04',
      status: 'APPROVED',
    })

    await blockTask(db, {
      actor,
      now: cairo('2026-03-02T00:00'),
      input: { taskId: task.id, reason: 'انتظار' },
    })
    await unblockTask(db, {
      actor,
      now: cairo('2026-03-05T00:00'),
      input: { taskId: task.id },
    })

    // Tuesday is a holiday and Wednesday is approved leave, so both are
    // already worth zero *on both sides of the subtraction*. The block excuses
    // only the Monday — and the lateness left over is identical to the same
    // scenario with no holiday and no leave at all (the case above answers 3
    // too). That equality is the property: a day cannot be excused twice.
    const result = await lateness(task.id, cairo('2026-03-09T12:00'))
    expect(result.blockedWorkingDays).toBe(1)
    expect(result.lateWorkingDays).toBe(3)
  })

  it('التسليم بعد رفع التعليق يجمّد العدّ', async () => {
    const { task, actor } = await fixture()

    await blockTask(db, {
      actor,
      now: cairo('2026-03-02T00:00'),
      input: { taskId: task.id, reason: 'انتظار' },
    })
    await unblockTask(db, {
      actor,
      now: cairo('2026-03-05T00:00'),
      input: { taskId: task.id },
    })
    await submitTask(db, {
      actor,
      now: cairo('2026-03-09T10:00'),
      input: { taskId: task.id },
    })

    const atSubmission = await lateness(task.id, cairo('2026-03-09T10:00'))
    const muchLater = await lateness(task.id, cairo('2026-04-30T12:00'))

    expect(atSubmission.frozen).toBe(true)
    expect(atSubmission.lateWorkingDays).toBe(3)
    // Review time is not the worker's, blocked or not.
    expect(muchLater.lateWorkingDays).toBe(atSubmission.lateWorkingDays)
  })

  it('مهمة عُلّقت وهي مسلَّمة تبقى مجمّدة على لحظة التسليم', async () => {
    const { task, actor } = await fixture()

    await submitTask(db, {
      actor,
      now: cairo('2026-03-02T10:00'),
      input: { taskId: task.id },
    })
    await blockTask(db, {
      actor,
      now: cairo('2026-03-04T09:00'),
      input: { taskId: task.id, reason: 'انتظار رد العميل على التسليم' },
    })

    // `status` reads BLOCKED, but the activity row says it was blocked out of
    // SUBMITTED — so the clock stopped at the delivery, not at the block.
    const result = await lateness(task.id, cairo('2026-04-30T12:00'))
    expect(result.frozen).toBe(true)
    expect(result.measuredAt).toEqual(cairo('2026-03-02T10:00'))
    expect(result.lateWorkingDays).toBe(1)
  })

  it('مهمة لم تُعلَّق قط تتراكم كالمعتاد', async () => {
    const { task } = await fixture()

    const result = await lateness(task.id, cairo('2026-03-13T12:00'))
    expect(result.blockedWorkingDays).toBe(0)
    expect(result.lateWorkingDays).toBe(9)
  })
})

describe('الوظيفة الليلية تحترم فترات التعليق', () => {
  it('لا تصعّد مهمة كان تأخيرها كله داخل فترة تعليق', async () => {
    const { task, actor } = await fixture()
    await blockTask(db, {
      actor,
      now: cairo('2026-03-01T09:00'),
      input: { taskId: task.id, reason: 'انتظار' },
    })

    await runScheduleRecompute(db, { now: cairo('2026-03-13T03:00') })

    expect(
      await db.task.findUniqueOrThrow({
        where: { id: task.id },
        select: { overdueWorkingDays: true, escalationLevel: true },
      }),
    ).toMatchObject({ overdueWorkingDays: 0, escalationLevel: 'NONE' })
  })

  it('تصعّد على ما تراكم قبل التعليق وحده', async () => {
    const { task, actor } = await fixture()
    await blockTask(db, {
      actor,
      now: cairo('2026-03-05T09:00'),
      input: { taskId: task.id, reason: 'انتظار' },
    })

    await runScheduleRecompute(db, { now: cairo('2026-03-13T03:00') })

    const row = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { overdueWorkingDays: true, escalationLevel: true },
    })
    // Four working days stood before the block — past the PM threshold, short
    // of the admin one, where nine days would have reached it.
    expect(row.overdueWorkingDays).toBe(4)
    expect(row.escalationLevel).toBe('PM')
  })

  it('رفع التعليق يعيد التصعيد للحركة في التشغيل التالي', async () => {
    const { task, actor } = await fixture()
    await blockTask(db, {
      actor,
      now: cairo('2026-03-01T09:00'),
      input: { taskId: task.id, reason: 'انتظار' },
    })
    await runScheduleRecompute(db, { now: cairo('2026-03-09T03:00') })
    expect(
      (
        await db.task.findUniqueOrThrow({
          where: { id: task.id },
          select: { escalationLevel: true },
        })
      ).escalationLevel,
    ).toBe('NONE')

    await unblockTask(db, {
      actor,
      now: cairo('2026-03-09T09:00'),
      input: { taskId: task.id },
    })
    await runScheduleRecompute(db, { now: cairo('2026-03-20T03:00') })

    const row = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { overdueWorkingDays: true, escalationLevel: true },
    })
    expect(row.overdueWorkingDays).toBeGreaterThan(0)
    expect(row.escalationLevel).toBe('ADMIN')
  })
})
