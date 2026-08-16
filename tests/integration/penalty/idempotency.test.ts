import { describe, expect, it } from 'vitest'

import { balanceFor } from '@/modules/ledger/service'

import { createProject, createTask, createUser } from '../../factories/db'
import {
  activePenalties,
  netPenaltyFor,
  penaltyRows,
  recompute,
  recomputeTimes,
  reversalRows,
} from '../../helpers/penalty'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * CLAUDE.md invariant 6 and docs/TESTING.md §4 axis 5, in the one place they
 * cost real money:
 *
 *   > **Idempotency** — run the penalty job 1×, 3×, 10× → identical ledger.
 *
 * ── What "identical" is taken to mean here, and why it is the strict reading ──
 *
 * The phase brief asks for "one net penalty". That would be satisfied by an
 * engine that reversed and re-inserted on every run: ten runs, ten penalties,
 * nine reversals, and a net of exactly one deduction. The arithmetic would be
 * right and the منفّذ's statement would be unreadable — twenty rows about one
 * late delivery, and no way to tell a real recalculation from the nightly job
 * breathing.
 *
 * So these tests assert the stronger thing: **a run that changes nothing writes
 * nothing at all.** Not a reversal, not a replacement, not an audit row. That
 * is what makes the ledger identical rather than merely equivalent, and it
 * falls out of the engine comparing its target against what is already there
 * before it writes.
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

describe('تشغيل الوظيفة مرة وثلاثًا وعشرًا', () => {
  it.each([1, 3, 10])('%i تشغيلة تنتج قيد خصم واحدًا بالضبط', async (times) => {
    const { worker, task } = await lateTask()

    await recomputeTimes(db, task.id, times, { now: NOW })

    expect(await penaltyRows(db, task.id)).toHaveLength(1)
    expect(await reversalRows(db, task.id)).toHaveLength(0)
    expect(await activePenalties(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-150.00')
  })

  it('التشغيلة الأولى تكتب، والتاسعة بعدها لا تكتب شيئًا', async () => {
    const { task } = await lateTask()

    const outcomes = await recomputeTimes(db, task.id, 10, { now: NOW })

    expect(outcomes[0]?.outcome).toBe('applied')
    expect(outcomes.slice(1).map((o) => o.outcome)).toEqual(Array(9).fill('unchanged'))
  })

  it('لا تكتب حتى صفّ تدقيق حين لا يتغيّر شيء', async () => {
    const { task } = await lateTask()
    await recompute(db, task.id, { now: NOW })
    const after = await db.auditLog.count()

    await recomputeTimes(db, task.id, 9, { now: NOW })

    // A quiet night leaves no trace at all. Anything else turns the audit log
    // into a log of the scheduler rather than of decisions.
    expect(await db.auditLog.count()).toBe(after)
  })

  it('الجدول نفسه بايتًا ببايت بعد عشر تشغيلات', async () => {
    const { task } = await lateTask()
    await recompute(db, task.id, { now: NOW })
    const before = await penaltyRows(db, task.id)

    await recomputeTimes(db, task.id, 9, { now: NOW })

    expect(await penaltyRows(db, task.id)).toEqual(before)
  })
})

describe('الوقت يتقدّم: كل قيمة جديدة مرة واحدة', () => {
  it('عشر تشغيلات على ثلاث لحظات تنتج ثلاثة قيود لا ثلاثين', async () => {
    const { task } = await lateTask()

    await recomputeTimes(db, task.id, 4, { now: NOW })
    await recomputeTimes(db, task.id, 4, { now: cairo('2026-03-08T12:00') })
    await recomputeTimes(db, task.id, 4, { now: cairo('2026-03-12T12:00') })

    expect(await penaltyRows(db, task.id)).toHaveLength(3)
    expect(await reversalRows(db, task.id)).toHaveLength(2)
    expect(await activePenalties(db, task.id)).toHaveLength(1)
  })

  it('العودة بالزمن لا تُنشئ قيدًا رابعًا حين تعود القيمة لما كانت عليه', async () => {
    // Not a realistic clock, but a realistic *outcome*: an extension shortened
    // the lateness and was then rescinded. What matters is that the engine
    // writes on a change of value, not on a change of instant.
    const { task } = await lateTask()
    await recompute(db, task.id, { now: NOW })
    await recompute(db, task.id, { now: cairo('2026-03-08T12:00') })
    await recompute(db, task.id, { now: cairo('2026-03-08T18:00') })

    expect(await penaltyRows(db, task.id)).toHaveLength(2)
    expect(await activePenalties(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe('-200.00')
  })
})
