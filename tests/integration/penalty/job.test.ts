import { describe, expect, it } from 'vitest'

import { advisoryLockKey, registeredJobs, clearJobs } from '@/lib/scheduler'
import { SCHEDULE_RECOMPUTE_JOB_NAME } from '@/modules/calendar/recompute'
import { PENALTY_RECOMPUTE_JOB_NAME, runPenaltyRecompute } from '@/modules/penalty/job'
import { registerPenaltyJobs, penaltyRecomputeJob } from '@/modules/penalty/job'

import { createProject, createTask, createUser } from '../../factories/db'
import { netPenaltyFor, penaltyRows, reversalRows } from '../../helpers/penalty'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * SPEC §5.4's "Runs daily (03:00 Cairo)", as a sweep rather than as one task.
 *
 * The engine's own idempotency is proven in `idempotency.test.ts`; what this
 * file adds is that the *job* inherits it, that one unreadable task does not
 * take the night down with it, and that a run over a hundred tasks writes only
 * for the ones whose figure actually moved.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NIGHT_1 = cairo('2026-03-05T03:00')
const NIGHT_2 = cairo('2026-03-08T03:00')

async function agency(lateTasks: number, options: { onTime?: number } = {}) {
  const owner = await createUser(db)
  const project = await createProject(db, { ownerId: owner.id })
  const tasks: string[] = []

  for (let i = 0; i < lateTasks; i += 1) {
    const worker = await createUser(db, { payType: 'PER_TASK' })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      taskValue: '1000.00',
      dueDate: DUE,
      originalDueDate: DUE,
    })
    tasks.push(task.id)
  }

  for (let i = 0; i < (options.onTime ?? 0); i += 1) {
    const worker = await createUser(db, { payType: 'PER_TASK' })
    await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      taskValue: '1000.00',
      dueDate: cairo('2026-04-01T17:00'),
      originalDueDate: cairo('2026-04-01T17:00'),
    })
  }

  return { project, tasks }
}

describe('وظيفة الخصم اليومية', () => {
  it('تخصم من كل مهمة متأخرة وتترك السليمة وشأنها', async () => {
    const { tasks } = await agency(3, { onTime: 2 })

    const result = await runPenaltyRecompute(db, { now: NIGHT_1 })

    expect(result.scanned).toBe(5)
    expect(result.applied).toBe(3)
    expect(result.failed).toBe(0)

    for (const taskId of tasks) {
      expect(await netPenaltyFor(db, taskId)).toBe('-150.00')
    }
  })

  it('ليلة ثانية بلا تغيير لا تكتب شيئًا', async () => {
    await agency(3)
    await runPenaltyRecompute(db, { now: NIGHT_1 })
    const entriesAfterFirst = await db.ledgerEntry.count()

    const second = await runPenaltyRecompute(db, { now: NIGHT_1 })

    expect(second.unchanged).toBe(3)
    expect(second.applied).toBe(0)
    expect(await db.ledgerEntry.count()).toBe(entriesAfterFirst)
  })

  it('عشر ليالٍ متطابقة تُنتج قيدًا واحدًا لكل مهمة', async () => {
    const { tasks } = await agency(2)

    for (let i = 0; i < 10; i += 1) {
      await runPenaltyRecompute(db, { now: NIGHT_1 })
    }

    for (const taskId of tasks) {
      expect(await penaltyRows(db, taskId)).toHaveLength(1)
      expect(await reversalRows(db, taskId)).toHaveLength(0)
    }
  })

  it('ليلة تالية بتأخير أكبر تعيد الحساب مرة واحدة لكل مهمة', async () => {
    const { tasks } = await agency(2)
    await runPenaltyRecompute(db, { now: NIGHT_1 })

    const second = await runPenaltyRecompute(db, { now: NIGHT_2 })

    expect(second.recalculated).toBe(2)
    for (const taskId of tasks) {
      expect(await penaltyRows(db, taskId)).toHaveLength(2)
      expect(await netPenaltyFor(db, taskId)).toBe('-200.00')
    }
  })

  it('الدفعات لا تفوّت مهمة: 25 مهمة على دفعات من 4', async () => {
    const { tasks } = await agency(25)

    const result = await runPenaltyRecompute(db, { now: NIGHT_1, batchSize: 4 })

    expect(result.scanned).toBe(25)
    expect(result.applied).toBe(25)
    const charged = await Promise.all(tasks.map((id) => netPenaltyFor(db, id)))
    expect(charged.every((amount) => amount === '-150.00')).toBe(true)
  })

  it('مهمة بلا منفّذ تُعدّ متخطّاة ولا تُسقط الليلة', async () => {
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    await createTask(db, {
      projectId: project.id,
      assigneeId: null,
      status: 'BACKLOG',
      dueDate: DUE,
      originalDueDate: DUE,
    })
    const { tasks } = await agency(2)

    const result = await runPenaltyRecompute(db, { now: NIGHT_1 })

    expect(result.skipped).toBe(1)
    expect(result.applied).toBe(2)
    expect(result.failed).toBe(0)
    expect(await netPenaltyFor(db, tasks[0] as string)).toBe('-150.00')
  })

  it('المهام المحذوفة ومهام المشاريع المحذوفة خارج المسح', async () => {
    const { tasks } = await agency(2)
    await db.task.update({
      where: { id: tasks[0] as string },
      data: { deletedAt: cairo('2026-03-02T09:00') },
    })

    const result = await runPenaltyRecompute(db, { now: NIGHT_1 })

    expect(result.scanned).toBe(1)
    expect(await penaltyRows(db, tasks[0] as string)).toHaveLength(0)
  })

  it('المهام المنتهية (DONE / CANCELLED) خارج المسح الليلي', async () => {
    const { tasks } = await agency(2)
    await db.task.update({
      where: { id: tasks[0] as string },
      data: { status: 'DONE' },
    })
    await db.task.update({
      where: { id: tasks[1] as string },
      data: { status: 'CANCELLED' },
    })

    const result = await runPenaltyRecompute(db, { now: NIGHT_1 })

    // Both are settled by the transition that put them there — SPEC §5.4's "on
    // every task status change" — so re-deriving the same answer every night
    // for tasks that can no longer move is work with no possible outcome.
    expect(result.scanned).toBe(0)
  })
})

describe('تسجيل الوظيفة في المجدول', () => {
  it('تعمل الساعة 03:00 بتوقيت القاهرة', () => {
    expect(penaltyRecomputeJob.schedule).toBe('0 3 * * *')
    expect(penaltyRecomputeJob.name).toBe(PENALTY_RECOMPUTE_JOB_NAME)
  })

  it('تأخذ قفلًا مختلفًا عن وظيفة إعادة حساب الجدول', () => {
    // Both run at 03:00. Sharing a key would make one wait for the other, so a
    // slow whole-table scan would delay every deduction in the organization.
    expect(advisoryLockKey(PENALTY_RECOMPUTE_JOB_NAME)).not.toBe(
      advisoryLockKey(SCHEDULE_RECOMPUTE_JOB_NAME),
    )
  })

  it('تُسجَّل مرة واحدة', () => {
    clearJobs()
    registerPenaltyJobs()

    expect(registeredJobs().map((job) => job.name)).toEqual([PENALTY_RECOMPUTE_JOB_NAME])
    expect(() => registerPenaltyJobs()).toThrow()
    clearJobs()
  })
})
