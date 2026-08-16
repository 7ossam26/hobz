import { describe, expect, it } from 'vitest'

import { createProject, createTask, createUser } from '../../factories/db'
import {
  activePenalties,
  netPenaltyFor,
  penaltyRows,
  recompute,
  recomputeTimes,
} from '../../helpers/penalty'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * Phase brief: "Accrual freezes the moment the task reaches `SUBMITTED`", and
 * SPEC §5.3: "Time sitting in review **never** counts against the worker."
 *
 * ── Where the freeze actually lives ───────────────────────────────────────
 *
 * Nowhere in `modules/penalty`. `modules/lateness` stops the clock at
 * `submittedAt` for every delivered status, so the engine's target simply stops
 * moving and every later run is the no-op `idempotency.test.ts` pins. Which is
 * the point of testing it from this side too: the freeze is a *consequence* of
 * two rules that were written separately, and a change to either would break it
 * silently. These tests fail if it ever stops being one.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
/** Thursday, three working days past the effective deadline. */
const SUBMITTED = cairo('2026-03-05T10:00')

async function submittedLate(
  status: 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' = 'SUBMITTED',
) {
  const owner = await createUser(db)
  const worker = await createUser(db, { payType: 'PER_TASK' })
  const project = await createProject(db, { ownerId: owner.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status,
    taskValue: '1000.00',
    dueDate: DUE,
    originalDueDate: DUE,
    submittedAt: SUBMITTED,
  })
  return { worker, task }
}

describe('التجميد عند التسليم', () => {
  it('يحتسب حتى لحظة التسليم لا حتى الآن', async () => {
    const { task } = await submittedLate()

    // Three weeks after the delivery. If the clock were still running this
    // would be fifteen working days, not three.
    const outcome = await recompute(db, task.id, { now: cairo('2026-03-26T12:00') })

    expect(outcome.breakdown?.lateWorkingDays).toBe(3)
    expect(outcome.breakdown?.frozen).toBe(true)
    expect(outcome.amount).toBe('150.00')
  })

  it('لا يزيد الخصم مهما طال بقاء المهمة في المراجعة', async () => {
    const { task } = await submittedLate()
    const first = await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })

    await db.task.update({ where: { id: task.id }, data: { status: 'IN_REVIEW' } })
    const later = await recomputeTimes(db, task.id, 5, {
      now: cairo('2026-04-15T03:00'),
    })

    expect(first.amount).toBe('150.00')
    expect(later.every((o) => o.outcome === 'unchanged')).toBe(true)
    expect(await penaltyRows(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')
  })

  it('الاعتماد بعد شهر لا يغيّر الرقم', async () => {
    const { task } = await submittedLate()
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })

    await db.task.update({
      where: { id: task.id },
      data: { status: 'APPROVED', approvedAt: cairo('2026-04-10T10:00') },
    })
    const outcome = await recompute(db, task.id, { now: cairo('2026-04-11T03:00') })

    expect(outcome.outcome).toBe('unchanged')
    expect(await activePenalties(db, task.id)).toHaveLength(1)
  })

  /**
   * The half that the naive "freeze on submit" reading gets wrong: a task
   * delivered *before* the engine ever ran must still be charged for the days
   * it was late. Freezing means the number stops growing, not that it is zero.
   */
  it('التسليم قبل أول تشغيل للوظيفة لا يعفي من التأخير', async () => {
    const { task } = await submittedLate()

    const outcome = await recompute(db, task.id, { now: cairo('2026-05-01T03:00') })

    expect(outcome.outcome).toBe('applied')
    expect(outcome.amount).toBe('150.00')
  })

  it('المهمة غير المسلَّمة يستمر احتسابها', async () => {
    const owner = await createUser(db)
    const worker = await createUser(db, { payType: 'PER_TASK' })
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      taskValue: '1000.00',
      dueDate: DUE,
      originalDueDate: DUE,
    })

    const day3 = await recompute(db, task.id, { now: cairo('2026-03-05T12:00') })
    const day4 = await recompute(db, task.id, { now: cairo('2026-03-08T12:00') })

    expect(day3.breakdown?.frozen).toBe(false)
    expect(day3.amount).toBe('150.00')
    expect(day4.amount).toBe('200.00')
  })
})
