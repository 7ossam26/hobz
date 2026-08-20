import { afterEach, describe, expect, it } from 'vitest'

import { clearJobs, registerJob, runJob, withAdvisoryLock } from '@/lib/scheduler'
import { SETTINGS_CATALOG } from '@/lib/settings'
import { scheduleRecomputeJob } from '@/modules/calendar/job'
import {
  runScheduleRecompute,
  SCHEDULE_RECOMPUTE_JOB_NAME,
} from '@/modules/calendar/recompute'
import type { LatenessEventBus } from '@/modules/lateness/ports'
import { computeProjectHealth, taskHealthSignals } from '@/modules/project/health'

import {
  createHoliday,
  createLeave,
  createProject,
  createTask,
  createUser,
} from '../../factories/db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * The 03:00 Cairo sweep (phase brief §8) — and above all docs/TESTING.md §4
 * axis 5: running it 1×, 3× and 10× must leave the same rows, the same audit
 * trail and the same number of notifications.
 *
 * Fixture: a task due Sunday 1 March 2026 at 17:00, with the catalog's own
 * grace and escalation thresholds. Nothing here types a business number in —
 * they are read from the catalog, per docs/TESTING.md §5.
 */

const DUE = cairo('2026-03-01T17:00')
const GRACE_HOURS = SETTINGS_CATALOG['penalty.defaultGraceHours'].default
const PM_AFTER = SETTINGS_CATALOG['notifications.escalateToPmAfterDays'].default
const ADMIN_AFTER = SETTINGS_CATALOG['notifications.escalateToAdminAfterDays'].default

function recordingBus(): LatenessEventBus & { events: unknown[] } {
  const events: unknown[] = []
  return {
    events,
    emit: async (_db, event) => {
      events.push(event)
    },
  }
}

async function scenario(
  overrides: {
    status?: 'IN_PROGRESS' | 'SUBMITTED' | 'DONE' | 'CANCELLED'
    submittedAt?: Date | null
    assignedAt?: Date | null
    dueDate?: Date
  } = {},
) {
  const owner = await createUser(db)
  const worker = await createUser(db)
  const project = await createProject(db, { ownerId: owner.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: overrides.status ?? 'IN_PROGRESS',
    dueDate: overrides.dueDate ?? DUE,
    originalDueDate: overrides.dueDate ?? DUE,
    assignedAt: overrides.assignedAt ?? cairo('2026-02-25T09:00'),
    submittedAt: overrides.submittedAt ?? null,
  })
  return { owner, worker, project, task }
}

const taskRow = (id: string) =>
  db.task.findUniqueOrThrow({
    where: { id },
    select: {
      overdueWorkingDays: true,
      escalationLevel: true,
      escalatedAt: true,
      elapsedMinutesRaw: true,
      elapsedMinutesWorking: true,
    },
  })

describe('calendar.recomputeSchedule — الحساب', () => {
  it('يكتب أيام التأخير ولا يصعّد قبل بلوغ الحد', async () => {
    const { task } = await scenario()
    // One working day past `dueDate + grace` — below the PM threshold.
    const now = cairo('2026-03-03T03:00')

    const outcome = await runScheduleRecompute(db, { now })

    expect(outcome).toMatchObject({ scanned: 1, failed: 0, truncated: false })
    expect(await taskRow(task.id)).toMatchObject({
      overdueWorkingDays: 1,
      escalationLevel: 'NONE',
      escalatedAt: null,
    })
  })

  it('يصعّد لمدير المشروع عند بلوغ حده', async () => {
    const { task } = await scenario()
    const bus = recordingBus()
    // `PM_AFTER` working days past the effective deadline.
    const now = cairo('2026-03-04T03:00')

    await runScheduleRecompute(db, { now, events: bus })

    const row = await taskRow(task.id)
    expect(row.overdueWorkingDays).toBe(PM_AFTER)
    expect(row.escalationLevel).toBe('PM')
    expect(row.escalatedAt).toEqual(now)
    // This task's first-ever recompute crosses two thresholds in the same
    // sweep: it goes overdue (0 → PM_AFTER working days) *and* that figure is
    // already past the PM threshold, so both a `TaskOverdue` and a
    // `TaskEscalated` fire together — the same "unrelated tests never share a
    // fixture that hides one of them" reasoning as every other axis-5 case
    // here, just with two events landing on the one run instead of one.
    expect(bus.events).toEqual([
      expect.objectContaining({
        type: 'TaskEscalated',
        taskId: task.id,
        from: 'NONE',
        to: 'PM',
        lateWorkingDays: PM_AFTER,
      }),
      expect.objectContaining({
        type: 'TaskOverdue',
        taskId: task.id,
        lateWorkingDays: PM_AFTER,
      }),
    ])
  })

  it('يصعّد للإدارة عند تجاوز حدها', async () => {
    const { task } = await scenario()
    // Six working days past the effective deadline, above `ADMIN_AFTER` (5).
    const now = cairo('2026-03-10T03:00')

    await runScheduleRecompute(db, { now })

    const row = await taskRow(task.id)
    expect(row.overdueWorkingDays).toBeGreaterThanOrEqual(ADMIN_AFTER)
    expect(row.escalationLevel).toBe('ADMIN')
  })

  it('المهلة تُطبَّق قبل احتساب أي يوم', async () => {
    const { task } = await scenario()
    // Inside `dueDate + grace`: nothing has slipped yet.
    const now = new Date(DUE.getTime() + (GRACE_HOURS - 1) * 3_600_000)

    await runScheduleRecompute(db, { now })

    expect(await taskRow(task.id)).toMatchObject({
      overdueWorkingDays: 0,
      escalationLevel: 'NONE',
    })
  })

  it('العطلة الرسمية لا تُحتسب يوم تأخير', async () => {
    const { task } = await scenario()
    await createHoliday(db, { date: '2026-03-03' })

    await runScheduleRecompute(db, { now: cairo('2026-03-04T03:00') })

    expect((await taskRow(task.id)).overdueWorkingDays).toBe(PM_AFTER - 1)
  })

  it('الإجازة المعتمدة تمنع التصعيد', async () => {
    const { task, worker } = await scenario()
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-03',
      endDate: '2026-03-10',
      status: 'APPROVED',
    })

    await runScheduleRecompute(db, { now: cairo('2026-03-10T03:00') })

    expect(await taskRow(task.id)).toMatchObject({
      overdueWorkingDays: 0,
      escalationLevel: 'NONE',
    })
  })

  it('يحسب وقت العمل المنقضي للمهام المسلَّمة', async () => {
    // Assigned Wednesday 09:00, submitted Thursday 12:00: one full workday
    // (08:00 of window) plus three hours, with nothing accruing overnight.
    const { task } = await scenario({
      status: 'SUBMITTED',
      assignedAt: cairo('2026-02-25T09:00'),
      submittedAt: cairo('2026-02-26T12:00'),
    })

    await runScheduleRecompute(db, { now: cairo('2026-03-04T03:00') })

    const row = await taskRow(task.id)
    expect(row.elapsedMinutesWorking).toBe(8 * 60 + 3 * 60)
    expect(row.elapsedMinutesRaw).toBe(27 * 60)
  })

  it('المهمة المسلَّمة تتجمّد — وقت المراجعة لا يزيد التأخير', async () => {
    const { task } = await scenario({
      status: 'SUBMITTED',
      submittedAt: cairo('2026-03-03T09:00'),
    })

    await runScheduleRecompute(db, { now: cairo('2026-03-04T03:00') })
    const early = await taskRow(task.id)

    await runScheduleRecompute(db, { now: cairo('2026-04-30T03:00') })
    const late = await taskRow(task.id)

    expect(late.overdueWorkingDays).toBe(early.overdueWorkingDays)
    expect(late.escalationLevel).toBe(early.escalationLevel)
  })
})

describe('calendar.recomputeSchedule — ما لا يمسّه', () => {
  it('يتجاهل المهام المنتهية والملغاة', async () => {
    const done = await scenario({ status: 'DONE' })
    const cancelled = await scenario({ status: 'CANCELLED' })

    const outcome = await runScheduleRecompute(db, { now: cairo('2026-04-01T03:00') })

    expect(outcome.scanned).toBe(0)
    for (const { task } of [done, cancelled]) {
      expect(await taskRow(task.id)).toMatchObject({
        overdueWorkingDays: 0,
        escalationLevel: 'NONE',
      })
    }
  })

  it('يتجاهل المهمة المحذوفة ناعمًا ومهام المشروع المحذوف', async () => {
    const { project, worker } = await scenario()
    const softDeleted = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      dueDate: DUE,
      deletedAt: new Date('2026-02-01T00:00:00Z'),
    })
    const deadProject = await createProject(db, {
      ownerId: worker.id,
      deletedAt: new Date('2026-02-01T00:00:00Z'),
    })
    const orphan = await createTask(db, {
      projectId: deadProject.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      dueDate: DUE,
    })

    const outcome = await runScheduleRecompute(db, { now: cairo('2026-04-01T03:00') })

    expect(outcome.scanned).toBe(1)
    for (const id of [softDeleted.id, orphan.id]) {
      expect((await taskRow(id)).overdueWorkingDays).toBe(0)
    }
  })

  it('مهمة بلا منفّذ تُحسب بتقويم المؤسسة ولا تفشل', async () => {
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: null,
      status: 'BACKLOG',
      dueDate: DUE,
    })

    const outcome = await runScheduleRecompute(db, { now: cairo('2026-03-04T03:00') })

    expect(outcome.failed).toBe(0)
    expect((await taskRow(task.id)).overdueWorkingDays).toBe(PM_AFTER)
  })
})

describe('calendar.recomputeSchedule — عدم التأثر بالتكرار (axis 5)', () => {
  it('التشغيل 1× و3× و10× يعطي نفس الصفوف ونفس السجل', async () => {
    const { task } = await scenario()
    const bus = recordingBus()
    const now = cairo('2026-03-04T03:00')

    await runScheduleRecompute(db, { now, events: bus })
    const afterFirst = await taskRow(task.id)

    for (let run = 0; run < 2; run += 1) {
      await runScheduleRecompute(db, { now, events: bus })
    }
    expect(await taskRow(task.id)).toEqual(afterFirst)

    for (let run = 0; run < 7; run += 1) {
      await runScheduleRecompute(db, { now, events: bus })
    }
    expect(await taskRow(task.id)).toEqual(afterFirst)

    // One level change, so one audit row — not ten. Two notifications, not
    // twenty: the first run's `TaskEscalated` *and* the `TaskOverdue` that
    // fires alongside it on the same 0 → PM_AFTER transition (see the
    // "يصعّد لمدير المشروع" case above); the nine repeats after it write
    // nothing further, which is the axis-5 guarantee this test is for.
    expect(await db.auditLog.count({ where: { action: 'task.escalated' } })).toBe(1)
    expect(bus.events).toHaveLength(2)
  })

  it('التشغيل المتكرر لا يضيف سطور نشاط لوقت لم يتغيّر', async () => {
    const { task } = await scenario({
      status: 'SUBMITTED',
      submittedAt: cairo('2026-03-03T09:00'),
    })
    const now = cairo('2026-03-04T03:00')

    for (let run = 0; run < 5; run += 1) {
      await runScheduleRecompute(db, { now })
    }

    expect(
      await db.taskActivity.count({
        where: { taskId: task.id, type: 'ELAPSED_RECOMPUTED' },
      }),
    ).toBe(1)
  })

  it('يعود التصعيد إلى لا شيء عندما يزول التأخير', async () => {
    const { task } = await scenario()
    const bus = recordingBus()
    const now = cairo('2026-03-04T03:00')

    await runScheduleRecompute(db, { now, events: bus })
    expect((await taskRow(task.id)).escalationLevel).toBe('PM')

    // An approved extension moves the deadline past `now`.
    await db.task.update({
      where: { id: task.id },
      data: { dueDate: cairo('2026-03-20T17:00') },
    })
    await runScheduleRecompute(db, { now, events: bus })

    expect(await taskRow(task.id)).toMatchObject({
      overdueWorkingDays: 0,
      escalationLevel: 'NONE',
      // Cleared with the flag: "escalated since" must not outlive it.
      escalatedAt: null,
    })
    // Run 1: `TaskEscalated` (NONE → PM) and `TaskOverdue` (0 → PM_AFTER),
    // the same paired transition as the two cases above. Run 2: the extension
    // clears the lateness, so only `TaskEscalated` (PM → NONE) fires — a
    // de-escalation is not a second "overdue" event, there is nothing new to
    // report about a deadline that no longer applies.
    expect(bus.events).toHaveLength(3)
  })
})

describe('calendar.recomputeSchedule — التجميع والقفل', () => {
  afterEach(() => {
    clearJobs()
  })

  it('يعالج كل المهام عبر عدة دفعات', async () => {
    const owner = await createUser(db)
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    for (let i = 0; i < 7; i += 1) {
      await createTask(db, {
        projectId: project.id,
        assigneeId: worker.id,
        status: 'IN_PROGRESS',
        dueDate: DUE,
      })
    }

    const outcome = await runScheduleRecompute(db, {
      now: cairo('2026-03-04T03:00'),
      batchSize: 2,
    })

    expect(outcome.scanned).toBe(7)
    expect(await db.task.count({ where: { escalationLevel: 'PM' } })).toBe(7)
  })

  it('يعمل تحت القفل الاستشاري', async () => {
    await scenario()
    registerJob(scheduleRecomputeJob)

    await expect(
      runJob(SCHEDULE_RECOMPUTE_JOB_NAME, 'manual', db),
    ).resolves.toMatchObject({ status: 'completed' })
  })

  it('يُتخطّى بينما نسخة أخرى تحمل القفل', async () => {
    await scenario()
    registerJob(scheduleRecomputeJob)

    // Held explicitly rather than raced: two `Promise.all` runs can simply not
    // overlap, and a test that passes because of pool timing proves nothing
    // about the lock.
    let acquired!: () => void
    let release!: () => void
    const isAcquired = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const isReleased = new Promise<void>((resolve) => {
      release = resolve
    })

    const holder = withAdvisoryLock(db, SCHEDULE_RECOMPUTE_JOB_NAME, async () => {
      acquired()
      await isReleased
    })

    await isAcquired
    const blocked = await runJob(SCHEDULE_RECOMPUTE_JOB_NAME, 'manual', db)
    release()
    await holder

    expect(blocked.status).toBe('skipped-locked')
  })

  it('مسجَّل على الساعة الثالثة صباحًا بتوقيت القاهرة', () => {
    expect(scheduleRecomputeJob.schedule).toBe('0 3 * * *')
    expect(scheduleRecomputeJob.name).toBe(SCHEDULE_RECOMPUTE_JOB_NAME)
  })

  it('مهمة واحدة تفشل لا توقف الليلة كلها', async () => {
    await scenario()
    await scenario()

    // Failure injected through the event bus rather than by spying on Prisma:
    // the delegates are proxies, and a spy left on one leaks into the next
    // test. The bus is a port, which is exactly what ports are for.
    let first = true
    const flaky: LatenessEventBus = {
      emit: async () => {
        if (first) {
          first = false
          throw new Error('boom')
        }
      },
    }

    const outcome = await runScheduleRecompute(db, {
      now: cairo('2026-03-04T03:00'),
      events: flaky,
    })

    expect(outcome).toMatchObject({ scanned: 2, failed: 1 })
    // The second task still got its columns, which is the point.
    expect(await db.task.count({ where: { escalationLevel: 'PM' } })).toBe(2)
  })
})

describe('صحة المشروع — التصعيد للإدارة يفرض الأحمر', () => {
  it('مهمة مُصعَّدة للإدارة تجعل المشروع أحمر', async () => {
    const { project } = await scenario()
    const now = cairo('2026-03-10T03:00')

    await runScheduleRecompute(db, { now })

    const signals = await taskHealthSignals(now)(db, project.id)
    expect(signals.adminEscalationCount).toBe(1)

    const health = computeProjectHealth({
      status: 'ACTIVE',
      // Far future, so nothing but the escalation can make it red.
      dueDate: cairo('2027-01-01T00:00'),
      now,
      signals,
      thresholds: {
        overdueTasksThreshold: 99,
        blockedDaysThreshold: 99,
        amberDaysBeforeDue: 1,
      },
    })
    expect(health).toBe('RED')
  })
})
