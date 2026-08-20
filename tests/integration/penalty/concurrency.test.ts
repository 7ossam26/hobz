import { describe, expect, it } from 'vitest'

import { calendarFor } from '@/lib/calendar'
import { recomputeTaskPenalty } from '@/modules/penalty/service'

import { createProject, createTask, createUser } from '../../factories/db'
import {
  activePenalties,
  CYCLE_DAY,
  netPenaltyFor,
  penaltyRows,
  PENALTY_DEFAULTS,
  recompute,
} from '../../helpers/penalty'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * docs/TESTING.md §4 axis 6 — concurrency, and the case it names by hand:
 * "scheduler firing while a manual recalculation runs".
 *
 * ── Two defences, and why one is not enough ───────────────────────────────
 *
 * Phase 7's unique index on `reversesEntryId` already makes it impossible for
 * two writers to reverse the same entry: the second gets a unique violation
 * instead of writing a second offsetting row. That covers *recalculation*.
 *
 * It says nothing about the case where there is **no entry yet**, which is
 * exactly the first night a task goes overdue and exactly when a manager is
 * most likely to press "recalculate now". Two writers would find nothing, both
 * compute 150.00, and both insert — a منفّذ docked twice for one late delivery,
 * with no constraint violated and nothing in the ledger looking wrong.
 *
 * So `recomputeTaskPenalty` takes a per-task **transaction** advisory lock
 * around the read *and* the write. A caller who cannot get it is told `locked`
 * and stops, which is correct rather than an error: whoever holds it is
 * computing the same target from the same data.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NOW = cairo('2026-03-05T12:00')

async function lateTask() {
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
  return { worker, task }
}

/** One recomputation inside its own interactive transaction, as production does. */
function inTransaction(taskId: string, now: Date, holdMs = 0) {
  return db.$transaction(async (tx) => {
    const outcome = await recomputeTaskPenalty(tx, {
      taskId,
      calendar: calendarFor(tx),
      settings: PENALTY_DEFAULTS,
      cycleDay: CYCLE_DAY,
      cause: 'scheduled',
      now,
      actor: null,
    })
    // Keep the transaction — and therefore the lock — open long enough for the
    // other one to collide with it. Without this the two would simply queue.
    //
    // Slept in the *database*, not in Node: the lock is held by the Postgres
    // transaction, and a `setTimeout` here would not stop Prisma finishing it.
    // `::text` because `pg_sleep` returns `void`, which Prisma cannot decode.
    if (holdMs > 0) {
      await tx.$queryRaw`SELECT pg_sleep(${holdMs / 1000}::double precision)::text AS slept`
    }
    return outcome
  })
}

describe('إعادة حسابان متزامنان على نفس المهمة', () => {
  it('واحد يكتب والآخر يجد القفل مأخوذًا — لا خصم مزدوج', async () => {
    const { task } = await lateTask()

    const [first, second] = await Promise.all([
      inTransaction(task.id, NOW, 400),
      // A short delay so the first has taken the lock rather than the two
      // racing to take it, which is the ordering the scenario actually
      // describes: a nightly job already running when a manager clicks.
      new Promise<void>((resolve) => setTimeout(resolve, 80)).then(() =>
        inTransaction(task.id, NOW),
      ),
    ])

    const outcomes = [first.outcome, second.outcome].sort()
    expect(outcomes).toEqual(['applied', 'locked'])

    expect(await penaltyRows(db, task.id)).toHaveLength(1)
    expect(await activePenalties(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')
  })

  it('المهمّتان المختلفتان لا تتزاحمان', async () => {
    const a = await lateTask()
    const b = await lateTask()

    const [first, second] = await Promise.all([
      inTransaction(a.task.id, NOW, 300),
      new Promise<void>((resolve) => setTimeout(resolve, 60)).then(() =>
        inTransaction(b.task.id, NOW),
      ),
    ])

    // A lock per task, not per engine: an organization-wide sweep must not serialise
    // behind one manager looking at one task.
    expect(first.outcome).toBe('applied')
    expect(second.outcome).toBe('applied')
    expect(await netPenaltyFor(db, a.task.id)).toBe('-150.00')
    expect(await netPenaltyFor(db, b.task.id)).toBe('-150.00')
  })

  it('القفل يُفكّ بانتهاء المعاملة، فالمحاولة التالية تنجح', async () => {
    const { task } = await lateTask()
    await inTransaction(task.id, NOW)

    // Transaction-scoped, so nothing has to remember to release it — a crashed
    // process cannot leave a task permanently un-deductible.
    const later = await recompute(db, task.id, { now: cairo('2026-03-08T12:00') })

    expect(later.outcome).toBe('recalculated')
    expect(await netPenaltyFor(db, task.id)).toBe('-200.00')
  })

  it('المحاولة المحجوبة لا تكتب شيئًا إطلاقًا', async () => {
    const { task } = await lateTask()
    await recompute(db, task.id, { now: NOW })
    const before = await db.ledgerEntry.count()

    const [, blocked] = await Promise.all([
      inTransaction(task.id, cairo('2026-03-08T12:00'), 400),
      new Promise<void>((resolve) => setTimeout(resolve, 80)).then(() =>
        inTransaction(task.id, cairo('2026-03-12T12:00')),
      ),
    ])

    expect(blocked.outcome).toBe('locked')
    // One recomputation's worth of rows — a reversal and a replacement — and
    // nothing from the blocked attempt.
    expect(await db.ledgerEntry.count()).toBe(before + 2)
    expect(await activePenalties(db, task.id)).toHaveLength(1)
  })
})
