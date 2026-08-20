import { describe, expect, it } from 'vitest'

import { mul, negate, pct, toMoney, toStorageString } from '@/lib/money'
import { balanceFor } from '@/modules/ledger/service'
import { runPenaltyRecompute } from '@/modules/penalty/job'

import {
  createProject,
  createStatusActivity,
  createTask,
  createUser,
} from '../../factories/db'
import {
  activePenalties,
  netPenaltyFor,
  penaltyRows,
  PENALTY_DEFAULTS,
  recompute,
  recomputeTimes,
  recordingEvents,
  reversalRows,
} from '../../helpers/penalty'
import { advanceHours, cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * docs/TESTING.md §4 axis 5 — "run the penalty job 1×, 3×, 10× → identical
 * ledger" — past the steady state `idempotency.test.ts` already pins.
 *
 * ── What is left to prove once "nothing changed" is proven ────────────────
 *
 * That file establishes the easy half: a task whose figure has not moved is
 * left completely alone, down to the audit row. Every case below is one where
 * running again meets a *state* rather than a steady number, and each of those
 * states is a separate way for the engine to be wrong ten times over:
 *
 *  - a **sealed** round, where an entry exists that the engine may no longer
 *    touch (SPEC T4). A round filter that is off by one instant refunds a
 *    correctly computed deduction, silently, every single night.
 *  - a **cleared** deduction, where the ledger holds a penalty *and* a reversal
 *    and the right answer is to write neither again.
 *  - a **skipped** task, where the inputs are unreadable and the temptation is
 *    to treat "cannot compute" as "compute zero".
 *  - the **notification**, which is the one output that reaches a منفّذ
 *    personally. Ten deductions in a bell for one late delivery is not a
 *    rounding error to them.
 *  - a **settings change and back**, which is where idempotency stops meaning
 *    "the same run" and starts meaning what it actually is: the target is a
 *    function of the data, so the engine writes on a change of *amount* and on
 *    nothing else.
 *
 * And the case that keeps the whole property honest: idempotent does not mean
 * inert. A real change must still produce exactly one reversal and exactly one
 * replacement — never two of either.
 *
 * ── The canonical scenario, reused ────────────────────────────────────────
 *
 * 2026-03-01 is a **Sunday**; the default weekend is Friday and Saturday.
 *
 *   dueDate       Sun 2026-03-01 17:00 Cairo
 *   + 24h grace   Mon 2026-03-02 17:00   ← lateness starts counting here
 *   measured at   Thu 2026-03-05 12:00   → Tue, Wed, Thu = 3 working days
 *
 * At the organization default (`PCT_TASK_VALUE_PER_DAY`, 5%) on a task worth 1000.00
 * that is 150.00, and at Sun 2026-03-08 it is four days and 200.00.
 */

const db = testDb()

const TASK_VALUE = '1000.00'

const DUE = cairo('2026-03-01T17:00')
/** Three working days past the effective deadline. */
const DAY_3 = cairo('2026-03-05T12:00')
/** The next Sunday: Friday and Saturday contribute nothing, so the count is 4. */
const DAY_4 = cairo('2026-03-08T12:00')
const DAY_5 = cairo('2026-03-12T03:00')

/** The nightly job's hour, per SPEC §5.4. */
const NIGHT = cairo('2026-03-05T03:00')
const ON_TIME_DUE = cairo('2026-04-01T17:00')

/** The revision timeline of SPEC T4, shared with `revision.test.ts`. */
const FIRST_DELIVERY = cairo('2026-03-05T10:00')
const BEFORE_REVISION = cairo('2026-03-06T03:00')
const REVISION_AT = cairo('2026-03-06T10:00')
const NEW_DUE = cairo('2026-03-15T17:00')
const SECOND_DELIVERY = cairo('2026-03-19T10:00')

/**
 * The scenario's amount, derived rather than typed in (docs/TESTING.md §5: read
 * business numbers from Settings in the test too). The task value is a test
 * *input* and stays a literal; the rate is the organization's `penalty.defaultValue`
 * and is not, so raising the organization percentage moves these expectations with it
 * instead of silently breaking the suite's meaning. Shaped for the shipped
 * default mode, `PCT_TASK_VALUE_PER_DAY`.
 */
function charge(lateWorkingDays: number): string {
  const perDay = pct(toMoney(TASK_VALUE), PENALTY_DEFAULTS.defaultValue)
  return toStorageString(mul(perDay, lateWorkingDays))
}

/** The same figure as the ledger stores it — debits are negative. */
function debit(lateWorkingDays: number): string {
  return toStorageString(negate(charge(lateWorkingDays)))
}

async function lateTask() {
  const owner = await createUser(db)
  const worker = await createUser(db, { payType: 'PER_TASK' })
  const project = await createProject(db, { ownerId: owner.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'IN_PROGRESS',
    taskValue: TASK_VALUE,
    dueDate: DUE,
    originalDueDate: DUE,
  })
  return { worker, task }
}

/** The same task, delivered three working days late. */
async function deliveredLate() {
  const owner = await createUser(db)
  const worker = await createUser(db, { payType: 'PER_TASK' })
  const project = await createProject(db, { ownerId: owner.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'SUBMITTED',
    taskValue: TASK_VALUE,
    dueDate: DUE,
    originalDueDate: DUE,
    submittedAt: FIRST_DELIVERY,
  })
  return { worker, task }
}

/** Move a task into its next round, the way `transitionTask` would. */
async function reviseTo(taskId: string, newDue: Date, at: Date) {
  await createStatusActivity(db, {
    taskId,
    from: 'IN_REVIEW',
    to: 'REVISION_REQUESTED',
    at,
  })
  await db.task.update({
    where: { id: taskId },
    data: { status: 'REVISION_REQUESTED', dueDate: newDue },
  })
}

type PenaltyRow = Awaited<ReturnType<typeof penaltyRows>>[number]

/** The entries the engine still owns: those written in the live round (SPEC T4). */
function writtenSince(rows: readonly PenaltyRow[], boundary: Date): PenaltyRow[] {
  return rows.filter((row) => row.createdAt.getTime() >= boundary.getTime())
}

/**
 * Every ledger row in the organization, ordered. "Identical ledger" is the literal
 * claim axis 5 makes, so the comparison is the whole table and not a count.
 */
async function ledgerSnapshot() {
  const rows = await db.ledgerEntry.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      userId: true,
      type: true,
      amount: true,
      taskId: true,
      note: true,
      isAutoGenerated: true,
      reversesEntryId: true,
      createdAt: true,
    },
  })
  return rows.map((row) => ({ ...row, amount: row.amount.toFixed(2) }))
}

function auditCount(action: string): Promise<number> {
  return db.auditLog.count({ where: { action } })
}

describe('التكرار عبر حدّ المراجعة', () => {
  /**
   * The recomputation that runs in round 1 must never reach back into round 0.
   * If it did, the ordinary nightly job would reverse a deduction SPEC T4 says
   * is frozen — the منفّذ would be refunded by a scheduler rather than by a
   * decision, and nothing in the ledger would look wrong.
   */
  it('عشر تشغيلات في جولة المراجعة تكتب قيدًا واحدًا ولا تمسّ القيد المجمَّد', async () => {
    const { task } = await deliveredLate()
    await recompute(db, task.id, { now: BEFORE_REVISION })
    const [sealed] = await penaltyRows(db, task.id)

    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: SECOND_DELIVERY },
    })

    const outcomes = await recomputeTimes(db, task.id, 10, {
      now: cairo('2026-03-20T03:00'),
    })

    expect(outcomes[0]?.outcome).toBe('applied')
    expect(outcomes.slice(1).map((o) => o.outcome)).toEqual(Array(9).fill('unchanged'))

    const rows = await penaltyRows(db, task.id)
    expect(rows).toHaveLength(2)
    // Byte for byte what it was before the revision existed.
    expect(rows[0]).toEqual(sealed)
    expect(writtenSince(rows, REVISION_AT)).toHaveLength(1)
    expect(await reversalRows(db, task.id)).toHaveLength(0)
    // Three late working days in the original delivery, three in the revision.
    expect(await netPenaltyFor(db, task.id)).toBe(debit(3 + 3))
  })

  /**
   * The state that catches an off-by-one round boundary: nothing is owed *and*
   * an entry exists. Read carelessly that is "an active penalty for a task with
   * zero lateness", i.e. exactly the shape the engine reverses.
   */
  it('جولة مراجعة لا تستحقّ شيئًا: عشر تشغيلات لا تعكس خصم الجولة السابقة', async () => {
    const { task } = await deliveredLate()
    await recompute(db, task.id, { now: BEFORE_REVISION })
    await reviseTo(task.id, NEW_DUE, REVISION_AT)

    const outcomes = await recomputeTimes(db, task.id, 10, { now: REVISION_AT })

    expect(outcomes.map((o) => o.outcome)).toEqual(Array(10).fill('none'))
    expect(await penaltyRows(db, task.id)).toHaveLength(1)
    expect(await reversalRows(db, task.id)).toHaveLength(0)
    expect(await netPenaltyFor(db, task.id)).toBe(debit(3))
  })

  it('إعادة حساب داخل المراجعة: عكس واحد وبديل واحد مهما تكرّر التشغيل', async () => {
    const { task } = await deliveredLate()
    await recompute(db, task.id, { now: BEFORE_REVISION })
    const [sealed] = await penaltyRows(db, task.id)

    // Undelivered again, so the revision's own clock is running: grace to Mon
    // 03-16 17:00, then Tue/Wed/Thu, then the following Sunday makes four.
    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await recomputeTimes(db, task.id, 10, { now: cairo('2026-03-19T03:00') })
    const later = await recomputeTimes(db, task.id, 10, {
      now: cairo('2026-03-22T03:00'),
    })

    expect(later[0]?.outcome).toBe('recalculated')
    expect(later[0]?.amount).toBe(charge(4))
    expect(later.slice(1).map((o) => o.outcome)).toEqual(Array(9).fill('unchanged'))

    const rows = await penaltyRows(db, task.id)
    expect(rows.find((row) => row.id === sealed?.id)?.reversed).toBe(false)
    // The correction happened entirely inside the live round.
    expect(writtenSince(rows, REVISION_AT)).toHaveLength(2)
    expect(await reversalRows(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe(debit(3 + 4))
  })
})

describe('حالة التصفير ثابتة بدورها', () => {
  it('إلغاء المهمة يعكس مرة واحدة، وعشر تشغيلات بعده لا تكتب شيئًا', async () => {
    const { worker, task } = await lateTask()
    await recompute(db, task.id, { now: DAY_3 })
    await db.task.update({ where: { id: task.id }, data: { status: 'CANCELLED' } })

    const cleared = await recompute(db, task.id, { now: DAY_4 })
    const afterClear = await ledgerSnapshot()
    const outcomes = await recomputeTimes(db, task.id, 10, { now: DAY_5 })

    expect(cleared.outcome).toBe('cleared')
    expect(outcomes.map((o) => o.outcome)).toEqual(Array(10).fill('none'))
    // A second reversal would credit the منفّذ twice for one cancelled task,
    // and the balance is a sum, so nothing downstream would catch it.
    expect(await ledgerSnapshot()).toEqual(afterClear)
    expect(await reversalRows(db, task.id)).toHaveLength(1)
    expect(await penaltyRows(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('التصفير يكتب صفّ تدقيق واحدًا، وما بعده صامت تمامًا', async () => {
    const { task } = await lateTask()
    await recompute(db, task.id, { now: DAY_3 })
    await db.task.update({ where: { id: task.id }, data: { status: 'CANCELLED' } })
    await recompute(db, task.id, { now: DAY_4 })
    const auditsAfterClear = await db.auditLog.count()

    await recomputeTimes(db, task.id, 10, { now: DAY_5 })

    // Once cleared, the task is settled: the audit log is a log of decisions,
    // not a log of the scheduler breathing over a task that can no longer move.
    expect(await auditCount('penalty.cleared')).toBe(1)
    expect(await db.auditLog.count()).toBe(auditsAfterClear)
  })

  it('نقل الموعد يمحو الخصم مرة واحدة ولا يُعيد تطبيقه', async () => {
    const { worker, task } = await lateTask()
    await recompute(db, task.id, { now: DAY_3 })

    // What an approved تمديد leaves on the row — the decision path itself is
    // proven in `extension.test.ts`; what is under test here is the repetition.
    await db.task.update({
      where: { id: task.id },
      data: { dueDate: cairo('2026-03-20T17:00') },
    })
    const cleared = await recompute(db, task.id, { now: DAY_3 })
    const outcomes = await recomputeTimes(db, task.id, 10, { now: DAY_4 })

    expect(cleared.outcome).toBe('cleared')
    expect(outcomes.map((o) => o.outcome)).toEqual(Array(10).fill('none'))
    expect(await reversalRows(db, task.id)).toHaveLength(1)
    expect(await activePenalties(db, task.id)).toHaveLength(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})

describe('المهام المتخطّاة: تدقيق يتكرّر، وسجل مالي لا يُمسّ', () => {
  it('مهمة بلا منفّذ: عشر تشغيلات تسجّل السبب عشر مرات ولا تكتب قيدًا', async () => {
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: null,
      status: 'BACKLOG',
      taskValue: TASK_VALUE,
      dueDate: DUE,
      originalDueDate: DUE,
    })

    const outcomes = await recomputeTimes(db, task.id, 10, { now: DAY_3 })

    expect(outcomes.map((o) => o.outcome)).toEqual(Array(10).fill('skipped'))
    expect(outcomes.map((o) => o.skipReason)).toEqual(Array(10).fill('no-assignee'))
    // The audit row repeats on purpose: "why did nobody get charged for this"
    // has to be answerable for *every* night, not only the first. It is the
    // ledger that must stay untouched, and it is empty rather than zeroed.
    expect(await auditCount('penalty.skipped')).toBe(10)
    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('منفّذ بلا أساس للحساب: عشر تشغيلات لا تُنتج خصمًا', async () => {
    const owner = await createUser(db)
    const worker = await createUser(db, {
      payType: 'PER_TASK',
      defaultTaskRate: null,
      monthlySalary: null,
    })
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      taskValue: '0.00',
      dueDate: DUE,
      originalDueDate: DUE,
    })

    const outcomes = await recomputeTimes(db, task.id, 10, { now: DAY_3 })

    // A percentage of nothing is not a deduction of zero — repeating the run
    // must not eventually render it as one.
    expect(outcomes.map((o) => o.skipReason)).toEqual(Array(10).fill('no-basis'))
    expect(await db.ledgerEntry.count()).toBe(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  /**
   * A skip is not a clear. The deduction was arithmetic somebody could
   * reproduce on the day it was computed; a column going null afterwards is not
   * a decision to refund it, and a nightly job must not make that decision
   * ten times in ten nights either.
   */
  it('حذف المنفّذ بعد الخصم: عشر تشغيلات لا تعكس ما احتُسب', async () => {
    const { worker, task } = await lateTask()
    await recompute(db, task.id, { now: DAY_3 })
    const afterCharge = await ledgerSnapshot()

    await db.user.update({
      where: { id: worker.id },
      data: { deletedAt: cairo('2026-03-06T09:00') },
    })
    const outcomes = await recomputeTimes(db, task.id, 10, { now: DAY_4 })

    expect(outcomes.map((o) => o.skipReason)).toEqual(Array(10).fill('assignee-deleted'))
    // Every run reports the figure that still stands, and none of them moves it.
    expect(outcomes.map((o) => o.amount)).toEqual(Array(10).fill(charge(3)))
    expect(await ledgerSnapshot()).toEqual(afterCharge)
    expect(await reversalRows(db, task.id)).toHaveLength(0)
  })
})

describe('إشعار واحد لكل خصم واحد', () => {
  /**
   * The output that reaches a person. Ten notifications for one late delivery
   * would make the bell useless and the deduction look like ten deductions —
   * and unlike a stray ledger row, nobody can un-send it.
   */
  it('عشر تشغيلات متطابقة تُصدر حدث خصم واحدًا', async () => {
    const { worker, task } = await lateTask()
    const events = recordingEvents()

    await recomputeTimes(db, task.id, 10, { now: DAY_3, events })

    expect(events.events.map((event) => event.type)).toEqual(['PenaltyApplied'])
    expect(events.events[0]?.userId).toBe(worker.id)
    expect(events.events[0]?.amount).toBe(charge(3))
  })

  it('إعادة حساب حقيقية تُصدر عكسًا واحدًا وخصمًا جديدًا واحدًا', async () => {
    const { task } = await lateTask()
    const events = recordingEvents()

    await recomputeTimes(db, task.id, 10, { now: DAY_3, events })
    await recomputeTimes(db, task.id, 10, { now: DAY_4, events })

    // Reversed first, then replaced — the منفّذ hears the correction as one
    // credit and one new charge, in that order, once.
    expect(events.events.map((event) => event.type)).toEqual([
      'PenaltyApplied',
      'MoneyReversed',
      'PenaltyApplied',
    ])
    expect(events.events.map((event) => event.amount)).toEqual([
      charge(3),
      charge(3),
      charge(4),
    ])
  })

  it('التصفير يُصدر حدث عكس واحدًا مهما تكرّر التشغيل', async () => {
    const { task } = await lateTask()
    const events = recordingEvents()
    await recompute(db, task.id, { now: DAY_3, events })
    await db.task.update({ where: { id: task.id }, data: { status: 'CANCELLED' } })

    await recomputeTimes(db, task.id, 10, { now: DAY_4, events })

    expect(events.events.map((event) => event.type)).toEqual([
      'PenaltyApplied',
      'MoneyReversed',
    ])
  })
})

describe('تغيير الإعدادات ثم التراجع عنه', () => {
  /**
   * Idempotency is over the *amount*, not over the run. An operator who raises
   * the organization percentage and changes their mind an hour later must leave three
   * entries on the statement — one per real figure — and not six, and not one
   * per nightly sweep in between.
   */
  it('مضاعفة النسبة ثم إعادتها: قيد واحد لكل تغيير حقيقي في المبلغ', async () => {
    const doubledRate = PENALTY_DEFAULTS.defaultValue * 2
    const doubledCharge = toStorageString(mul(pct(toMoney(TASK_VALUE), doubledRate), 3))
    const { worker, task } = await lateTask()

    // Three runs per step, all inside the same working day: the setting moves
    // and the day count deliberately does not.
    const before = await recomputeTimes(db, task.id, 3, { now: DAY_3 })
    const raised = await recomputeTimes(db, task.id, 3, {
      now: advanceHours(DAY_3, 2),
      settings: { defaultValue: doubledRate },
    })
    const restored = await recomputeTimes(db, task.id, 3, {
      now: advanceHours(DAY_3, 4),
    })

    expect(before[0]?.outcome).toBe('applied')
    expect(raised[0]?.outcome).toBe('recalculated')
    expect(raised[0]?.amount).toBe(doubledCharge)
    expect(restored[0]?.outcome).toBe('recalculated')
    expect(
      [...before.slice(1), ...raised.slice(1), ...restored.slice(1)].map(
        (o) => o.outcome,
      ),
    ).toEqual(Array(6).fill('unchanged'))

    expect(await penaltyRows(db, task.id)).toHaveLength(3)
    expect(await reversalRows(db, task.id)).toHaveLength(2)
    expect(await activePenalties(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe(debit(3))
    expect(await balanceFor(db, { userId: worker.id })).toBe(debit(3))
  })

  it('صيغة مختلفة بالمبلغ نفسه لا تكتب شيئًا', async () => {
    // A fixed daily charge that reproduces the organization percentage exactly:
    // 1000.00 × 5% per day is the same 150.00 over three days.
    const equivalentPerDay = Number(
      toStorageString(pct(toMoney(TASK_VALUE), PENALTY_DEFAULTS.defaultValue)),
    )
    const { task } = await lateTask()
    await recompute(db, task.id, { now: DAY_3 })
    const snapshot = await ledgerSnapshot()

    const outcomes = await recomputeTimes(db, task.id, 10, {
      now: DAY_3,
      settings: { defaultMode: 'FIXED_PER_DAY', defaultValue: equivalentPerDay },
    })

    // The engine compares figures, not configurations. Re-expressing the same
    // deduction is not a correction, and must not churn a منفّذ's statement.
    expect(outcomes.map((o) => o.outcome)).toEqual(Array(10).fill('unchanged'))
    expect(await ledgerSnapshot()).toEqual(snapshot)
  })
})

describe('الوظيفة الليلية على وكالة مختلطة', () => {
  const LATE_TASKS = 3

  /** Three late, two on time, one with nobody to charge, one with no basis. */
  async function mixedOrg() {
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    const late: string[] = []

    for (let i = 0; i < LATE_TASKS; i += 1) {
      const worker = await createUser(db, { payType: 'PER_TASK' })
      const task = await createTask(db, {
        projectId: project.id,
        assigneeId: worker.id,
        status: 'IN_PROGRESS',
        taskValue: TASK_VALUE,
        dueDate: DUE,
        originalDueDate: DUE,
      })
      late.push(task.id)
    }

    for (let i = 0; i < 2; i += 1) {
      const worker = await createUser(db, { payType: 'PER_TASK' })
      await createTask(db, {
        projectId: project.id,
        assigneeId: worker.id,
        status: 'IN_PROGRESS',
        taskValue: TASK_VALUE,
        dueDate: ON_TIME_DUE,
        originalDueDate: ON_TIME_DUE,
      })
    }

    await createTask(db, {
      projectId: project.id,
      assigneeId: null,
      status: 'BACKLOG',
      taskValue: TASK_VALUE,
      dueDate: DUE,
      originalDueDate: DUE,
    })

    const unpaid = await createUser(db, {
      payType: 'PER_TASK',
      defaultTaskRate: null,
      monthlySalary: null,
    })
    await createTask(db, {
      projectId: project.id,
      assigneeId: unpaid.id,
      status: 'IN_PROGRESS',
      taskValue: '0.00',
      dueDate: DUE,
      originalDueDate: DUE,
    })

    return { late }
  }

  it('الليلة الأولى: عدّادات دقيقة بين متأخر وملتزم ومتخطّى', async () => {
    const { late } = await mixedOrg()

    const first = await runPenaltyRecompute(db, { now: NIGHT })

    // Exact, not "at least": a counter that over-reports is how a night that
    // silently skipped somebody's deduction still reads as a healthy run.
    expect(first).toEqual({
      scanned: 7,
      applied: 3,
      recalculated: 0,
      cleared: 0,
      unchanged: 0,
      skipped: 2,
      locked: 0,
      failed: 0,
      truncated: false,
    })
    for (const taskId of late) {
      expect(await netPenaltyFor(db, taskId)).toBe(debit(3))
    }
  })

  it('عشر ليالٍ متطابقة: السجل نفسه والعدّادات نفسها', async () => {
    const { late } = await mixedOrg()
    await runPenaltyRecompute(db, { now: NIGHT })
    const afterFirst = await ledgerSnapshot()

    const nights = []
    for (let i = 0; i < 10; i += 1) {
      nights.push(await runPenaltyRecompute(db, { now: NIGHT }))
    }

    expect(nights).toEqual(
      Array(10).fill({
        scanned: 7,
        applied: 0,
        recalculated: 0,
        cleared: 0,
        unchanged: 3,
        skipped: 2,
        locked: 0,
        failed: 0,
        truncated: false,
      }),
    )
    expect(await ledgerSnapshot()).toEqual(afterFirst)
    expect(await auditCount('penalty.applied')).toBe(LATE_TASKS)
    expect(await auditCount('penalty.recalculated')).toBe(0)
    expect(await auditCount('ledger.reversed')).toBe(0)
    for (const taskId of late) {
      expect(await penaltyRows(db, taskId)).toHaveLength(1)
    }
  })

  it('عشر ليالٍ لا تُصدر إلا إشعارًا واحدًا لكل منفّذ متأخر', async () => {
    await mixedOrg()
    const events = recordingEvents()

    for (let i = 0; i < 10; i += 1) {
      await runPenaltyRecompute(db, { now: NIGHT, events })
    }

    expect(events.events).toHaveLength(LATE_TASKS)
    expect(events.events.every((event) => event.type === 'PenaltyApplied')).toBe(true)
    // One per person, not ten for one unlucky منفّذ.
    expect(new Set(events.events.map((event) => event.userId)).size).toBe(LATE_TASKS)
  })
})

describe('التكرار لا يعني الامتناع عن الكتابة', () => {
  it('تغيّر حقيقي واحد يُنتج عكسًا واحدًا وبديلًا واحدًا لا اثنين', async () => {
    const { worker, task } = await lateTask()
    await recomputeTimes(db, task.id, 10, { now: DAY_3 })
    const [original] = await penaltyRows(db, task.id)

    const outcomes = await recomputeTimes(db, task.id, 10, { now: DAY_4 })

    expect(outcomes[0]?.outcome).toBe('recalculated')
    expect(outcomes.slice(1).map((o) => o.outcome)).toEqual(Array(9).fill('unchanged'))

    const reversals = await reversalRows(db, task.id)
    expect(reversals).toHaveLength(1)
    expect(reversals[0]?.reversesEntryId).toBe(original?.id)
    expect(reversals[0]?.amount).toBe(charge(3))

    const rows = await penaltyRows(db, task.id)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.id).toBe(original?.id)
    expect(rows[0]?.reversed).toBe(true)
    expect(rows[1]?.amount).toBe(debit(4))
    expect(await activePenalties(db, task.id)).toHaveLength(1)
    expect(await balanceFor(db, { userId: worker.id })).toBe(debit(4))
  })

  it('سجل التدقيق يحكي التغيير مرة واحدة لا عشرًا', async () => {
    const { task } = await lateTask()

    await recomputeTimes(db, task.id, 10, { now: DAY_3 })
    await recomputeTimes(db, task.id, 10, { now: DAY_4 })

    // Twenty runs, two decisions. Anything more and the audit trail a منفّذ is
    // shown stops being readable as the history of their deduction.
    expect(await auditCount('penalty.applied')).toBe(1)
    expect(await auditCount('penalty.recalculated')).toBe(1)
    expect(await auditCount('ledger.reversed')).toBe(1)
  })
})
