import { describe, expect, it } from 'vitest'

import { AppError, ConflictError } from '@/lib/errors'
import { add, clampAtZero, sub, toStorageString } from '@/lib/money'
import { advisoryLockKey } from '@/lib/scheduler'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { createLedgerTaskEvents } from '@/modules/ledger/earnings'
import { appendEntry, balanceFor, recordAdvance } from '@/modules/ledger/service'
import { CLOSE_CYCLE_JOB_NAME, closeCycleUnderLock } from '@/modules/payout/job'
import { approvePayout, closeCycle, markPayoutPaid } from '@/modules/payout/service'
import { approveTask } from '@/modules/task/service'

import {
  createLedgerEntry,
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const CYCLE_DAY = SETTINGS_CATALOG['payout.cycleDay'].default
const METHODS = SETTINGS_CATALOG['payout.paymentMethods'].default

const events = createLedgerTaskEvents({ cycleDay: CYCLE_DAY })

/**
 * See the note in close.test.ts: every entry carries an explicit Cairo instant
 * inside the cycle under test, because the factory attaches it to whichever
 * cycle its `createdAt` falls in — exactly as `appendEntry` does in production.
 */
const IN_AUGUST = cairo('2026-08-10T09:00')
const APPROVED_AT = cairo('2026-08-15T10:00')
/** One minute before the nightly close job fires — the collision hour. */
const DURING_CLOSE = cairo('2026-08-28T23:58')
const CLOSE_AT = cairo('2026-08-28T23:59')
const PAY_AT = cairo('2026-08-29T11:00')

/**
 * docs/TESTING.md §4 axis 6 — concurrency.
 *
 * Everything in this file is about the same failure: two callers read the same
 * state, both decide they may act, and both act. In every other module that
 * costs a duplicated row; here it costs somebody's month. So each test asserts
 * on the **outcome** — row counts and sums after the dust settles — and never on
 * which caller won, because which one wins is a property of the connection pool
 * and would make the suite lie about the thing it is supposed to protect.
 *
 * The three guarantees under test, in the order the money flows:
 *
 *  1. An approval pays once, however many times it arrives.
 *  2. A ledger write racing a cycle close is never lost — the balance is
 *     `SUM(amount)` and is right whichever cycle claimed the entry.
 *  3. A payout is approved once and disburses at most its `net`.
 */

async function manager() {
  await seedPermissionCatalog(db)
  const user = await createUserWithPermissions(db, [
    'payout.generate',
    'payout.approve',
    'payout.markPaid',
    'task.approve',
  ])
  return actorFor(db, user.id)
}

/** A منفّذ with one August earning, and the OPEN cycle that earning opened. */
async function withEarning(amount: string) {
  const actor = await manager()
  const worker = await createUser(db)
  await createLedgerEntry(db, {
    createdAt: IN_AUGUST,
    userId: worker.id,
    type: 'EARNING',
    amount,
  })
  return { actor, worker }
}

/** A DRAFT payout of `net`, produced by a real close rather than hand-built. */
async function draftedPayout(net: string) {
  const { actor, worker } = await withEarning(net)
  const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
  const payout = await db.payout.findFirstOrThrow({ where: { userId: worker.id } })
  return { actor, worker, payout, cycleId: result.cycleId! }
}

/**
 * Hold `payout.closeCycle`'s advisory lock for the duration of `body`, the way a
 * manual recomputation or an early close does.
 *
 * No sleeps and no polling: the lock is provably held before `body` starts and
 * released only after it settles, so the test asserts a real contention rather
 * than a timing coincidence that passes on a fast machine and hangs on a slow one.
 */
async function whileCloseLockHeld<T>(body: () => Promise<T>): Promise<T> {
  let signalHeld!: () => void
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    signalHeld = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  let locked = false
  const holder = db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${advisoryLockKey(CLOSE_CYCLE_JOB_NAME)}::bigint) AS locked
      `
      locked = rows[0]?.locked === true
      signalHeld()
      await gate
    },
    { timeout: 20_000, maxWait: 10_000 },
  )

  await held
  try {
    if (!locked) throw new Error('advisory lock was already held before the test began')
    return await body()
  } finally {
    release()
    await holder
  }
}

describe('modules/task — اعتمادان متزامنان لنفس المهمة', () => {
  async function reviewable(taskValue: string) {
    const actor = await manager()
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: actor.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
      taskValue,
    })
    return { actor, worker, task }
  }

  it('يكتبان قيد استحقاق واحدًا ورصيدًا صحيحًا', async () => {
    // Two managers hitting "اعتماد" on the same مهمة at the same second is the
    // cheapest way to pay for one task twice, and the state machine cannot see
    // it: both callers read IN_REVIEW before either wrote APPROVED.
    const { actor, worker, task } = await reviewable('1500.00')

    const settled = await Promise.allSettled([
      approveTask(db, {
        actor,
        now: APPROVED_AT,
        events,
        input: { taskId: task.id, qualityRating: 5 },
      }),
      approveTask(db, {
        actor,
        now: APPROVED_AT,
        events,
        input: { taskId: task.id, qualityRating: 5 },
      }),
    ])

    expect(settled.some((outcome) => outcome.status === 'fulfilled')).toBe(true)
    expect(
      await db.ledgerEntry.count({ where: { taskId: task.id, type: 'EARNING' } }),
    ).toBe(1)
    expect(await balanceFor(db, { userId: worker.id })).toBe('1500.00')

    // Whichever call lost must lose as a typed domain error. A raw P2002
    // escaping to the action layer would surface an index name to a manager and
    // would not be mappable to an Arabic message.
    const failures: unknown[] = settled.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : [],
    )
    expect(failures.every((error) => error instanceof AppError)).toBe(true)
  })

  it('لا يسجّل الاعتماد المتزامن حركتين ماليتين في سجل التدقيق', async () => {
    // CLAUDE.md invariant 7. If the ledger holds one row but the audit log holds
    // two "money moved" entries, the reconciliation that this product exists to
    // make possible stops being possible.
    const { actor, task } = await reviewable('1500.00')

    await Promise.allSettled([
      approveTask(db, {
        actor,
        now: APPROVED_AT,
        events,
        input: { taskId: task.id, qualityRating: 5 },
      }),
      approveTask(db, {
        actor,
        now: APPROVED_AT,
        events,
        input: { taskId: task.id, qualityRating: 5 },
      }),
    ])

    expect(
      await db.auditLog.count({
        where: { entity: 'LedgerEntry', action: 'ledger.entryCreated' },
      }),
    ).toBe(1)
  })

  it('اعتماد مهمتين مختلفتين في اللحظة نفسها يدفع أجر الاثنتين', async () => {
    // The mirror of the test above, and the reason it is here: an index widened
    // from `(taskId) WHERE type = 'EARNING'` to `(userId)` would make every test
    // above pass while quietly swallowing a منفّذ's second approval of the day.
    const actor = await manager()
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: actor.id })
    const first = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
      taskValue: '1500.00',
    })
    const second = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
      taskValue: '2500.00',
    })

    await Promise.all([
      approveTask(db, {
        actor,
        now: APPROVED_AT,
        events,
        input: { taskId: first.id, qualityRating: 5 },
      }),
      approveTask(db, {
        actor,
        now: APPROVED_AT,
        events,
        input: { taskId: second.id, qualityRating: 4 },
      }),
    ])

    expect(await db.ledgerEntry.count({ where: { type: 'EARNING' } })).toBe(2)
    expect(await balanceFor(db, { userId: worker.id })).toBe('4000.00')
  })
})

describe('modules/payout — الإغلاق بينما تُكتب حركة مالية', () => {
  it('سلفة تُسجَّل أثناء الإغلاق لا تضيع ولا تُحتسب مرتين', async () => {
    // 23:58 on the 28th: a manager records a سلفة one minute before the nightly
    // close job fires. The entry is either inside the closing cycle or inside
    // the one that opens a moment later, and the منفّذ's balance must be the
    // same number either way — it is `SUM(amount)`, so it cannot be otherwise
    // unless the write itself was lost.
    const { actor, worker } = await withEarning('5000.00')

    const [close, advance] = await Promise.allSettled([
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
      recordAdvance(db, {
        userId: worker.id,
        amount: '1200.00',
        note: 'سلفة نقدية قبل الإغلاق',
        actor,
        cycleDay: CYCLE_DAY,
        at: DURING_CLOSE,
      }),
    ])

    expect(close.status).toBe('fulfilled')
    // A ledger write that loses a race is money that vanished from somebody's
    // statement with no row to explain it.
    expect(advance.status).toBe('fulfilled')

    expect(await balanceFor(db, { userId: worker.id })).toBe('3800.00')
    expect(
      await db.ledgerEntry.count({ where: { userId: worker.id, type: 'ADVANCE' } }),
    ).toBe(1)
  })

  it('الحركة المتزامنة تُنسب لإحدى الدورتين ولا تبقى بلا دورة', async () => {
    // Cycles are contiguous precisely so that no entry can fall between two of
    // them. An entry written across a close boundary is the one case where that
    // could break, and an orphaned entry never appears on any statement.
    const { actor, worker } = await withEarning('5000.00')

    await Promise.allSettled([
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
      recordAdvance(db, {
        userId: worker.id,
        amount: '1200.00',
        note: 'سلفة نقدية قبل الإغلاق',
        actor,
        cycleDay: CYCLE_DAY,
        at: DURING_CLOSE,
      }),
    ])

    const cycleIds = (await db.payoutCycle.findMany({ select: { id: true } })).map(
      (cycle) => cycle.id,
    )
    const advance = await db.ledgerEntry.findFirstOrThrow({ where: { type: 'ADVANCE' } })

    expect(cycleIds).toContain(advance.cycleId)
    expect(await db.payoutCycle.count({ where: { status: 'OPEN' } })).toBe(1)
    expect(await db.payoutCycle.count({ where: { status: 'CLOSED' } })).toBe(1)
  })

  it('كشف المستحق يتصالح مع بنوده مهما وقعت الحركة المتزامنة', async () => {
    // The statement's own arithmetic, from the service docblock:
    //   net = max(0, carriedForward + gross − penalties + bonuses − advances + adjustments)
    // A concurrent write that landed in the balance query but not in the
    // movement query (or the reverse) must still produce a payout whose columns
    // add up to its net — otherwise the منفّذ is handed a number that his own
    // statement contradicts, which is the exact failure this product exists to
    // abolish.
    const { actor, worker } = await withEarning('5000.00')

    await Promise.all([
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
      appendEntry(db, {
        userId: worker.id,
        type: 'EARNING',
        amount: '900.00',
        note: 'أجر مهمة اعتُمدت لحظة الإغلاق',
        actor,
        cycleDay: CYCLE_DAY,
        at: DURING_CLOSE,
      }),
    ])

    expect(await balanceFor(db, { userId: worker.id })).toBe('5900.00')

    const payout = await db.payout.findFirstOrThrow({ where: { userId: worker.id } })
    const credits = add(
      add(payout.carriedForward.toFixed(2), payout.gross.toFixed(2)),
      add(payout.bonuses.toFixed(2), payout.adjustments.toFixed(2)),
    )
    const debits = add(payout.penalties.toFixed(2), payout.advances.toFixed(2))

    expect(payout.net.toFixed(2)).toBe(toStorageString(clampAtZero(sub(credits, debits))))
  })
})

describe('modules/payout — اعتمادان متزامنان لمستحق واحد', () => {
  it('واحد يعتمد والآخر يُرفض بتعارض', async () => {
    // Two people on the payouts screen, one payout, both clicking "اعتماد".
    // `approvePayout` reads the status and then writes it in two separate
    // statements, so nothing but a guard on the write itself stops both from
    // passing the DRAFT check.
    const { actor, payout } = await draftedPayout('800.00')

    const settled = await Promise.allSettled([
      approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT }),
      approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT }),
    ])

    const failures: unknown[] = settled.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : [],
    )

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(ConflictError)
  })

  it('لا يكتب سطري تدقيق لاعتماد واحد', async () => {
    // Who approved this payout, and when, is the question the audit log exists
    // to answer. Two rows for one approval make the answer "one of these two",
    // and the second silently overwrites `approvedById` on the row itself.
    const { actor, payout } = await draftedPayout('800.00')

    await Promise.allSettled([
      approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT }),
      approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT }),
    ])

    expect(
      await db.auditLog.count({ where: { entity: 'Payout', action: 'payout.approved' } }),
    ).toBe(1)
    const row = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })
    expect(row.status).toBe('APPROVED')
  })
})

describe('modules/payout — صرفان متزامنان لمستحق واحد', () => {
  it('لا يصرفان معًا أكثر من صافي المستحق', async () => {
    // Each payment is legal on its own (500 ≤ 800) and illegal together
    // (1000 > 800). `markPayoutPaid` reads `paidAmount`, appends the negative
    // PAYOUT entry and then writes the running total back — three statements,
    // no lock — so two callers can both read 0.00 and both disburse.
    const { actor, worker, payout } = await draftedPayout('800.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

    await Promise.allSettled([
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '500.00',
        method: METHODS[0]!,
        reference: 'INS-A',
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '500.00',
        method: METHODS[0]!,
        reference: 'INS-B',
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
    ])

    const disbursed = await db.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { userId: worker.id, type: 'PAYOUT' },
    })
    const row = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })

    // Exactly one payment can be honoured: the second leaves only 300.00
    // outstanding, and 500.00 exceeds it.
    expect(disbursed._sum.amount?.toFixed(2)).toBe('-500.00')
    expect(row.paidAmount.toFixed(2)).toBe('500.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('300.00')
  })

  it('مجموع قيود الصرف يساوي المدفوع المسجَّل على المستحق', async () => {
    // The invariant that survives any future change to the payment rules: the
    // PAYOUT entries for a (منفّذ, دورة) always sum to exactly −paidAmount. If
    // they diverge, the ledger and the payout row disagree about how much left
    // the organization, and only one of them is the permanent record.
    const { actor, worker, payout, cycleId } = await draftedPayout('800.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

    await Promise.allSettled([
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '500.00',
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '500.00',
        method: METHODS[1]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
    ])

    const entries = await db.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { userId: worker.id, cycleId, type: 'PAYOUT' },
    })
    const row = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })

    expect(entries._sum.amount?.toFixed(2)).toBe(`-${row.paidAmount.toFixed(2)}`)
  })
})

describe('modules/ledger — أول كتابات مالية متزامنة', () => {
  async function threeSimultaneousWrites() {
    const workers = [
      await createUser(db),
      await createUser(db),
      await createUser(db),
    ] as const

    return Promise.allSettled(
      workers.map((worker) =>
        appendEntry(db, {
          userId: worker.id,
          type: 'EARNING',
          amount: '100.00',
          note: 'أجر مهمة',
          actor: null,
          cycleDay: CYCLE_DAY,
          at: IN_AUGUST,
        }),
      ),
    )
  }

  it('تفتح دورة واحدة فقط على قاعدة لا دورة فيها', async () => {
    // `payout_cycles_single_open` is the guarantee; `ensureOpenCycle`'s
    // catch-and-re-read is what turns the index's rejection into the correct
    // outcome instead of a failed write. Two open cycles would mean two answers
    // to "which cycle is this entry in", and the close would settle one of them.
    expect(await db.payoutCycle.count()).toBe(0)

    const settled = await threeSimultaneousWrites()

    expect(settled.every((outcome) => outcome.status === 'fulfilled')).toBe(true)
    expect(await db.payoutCycle.count()).toBe(1)
    expect(await db.payoutCycle.count({ where: { status: 'OPEN' } })).toBe(1)
  })

  it('كل القيود المتزامنة تُنسب إلى نفس الدورة', async () => {
    // The losers of the race must adopt the winner's cycle, not fall back to a
    // null stamp: an entry with no cycle appears on no statement.
    await threeSimultaneousWrites()

    const entries = await db.ledgerEntry.findMany({ select: { cycleId: true } })

    expect(entries).toHaveLength(3)
    expect(entries.every((entry) => entry.cycleId !== null)).toBe(true)
    expect(new Set(entries.map((entry) => entry.cycleId)).size).toBe(1)
  })
})

describe('modules/payout — الجدولة تصطدم بعملية يدوية', () => {
  async function agencyReadyToClose() {
    const actor = await manager()
    const salaried = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '11000.00',
    })
    const freelancer = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: freelancer.id,
      type: 'EARNING',
      amount: '5000.00',
    })
    return { actor, salaried, freelancer }
  }

  it('لا تُغلق الدورة والقفل محجوز بعملية أخرى', async () => {
    // docs/TESTING.md §4 axis 6: "scheduler firing while a manual recalculation
    // runs". Being refused the lock must mean writing *nothing* — not a partial
    // close, and above all not a salary accrual, which is the largest number the
    // job writes and the one a second run would double.
    const { actor } = await agencyReadyToClose()

    const attempt = await whileCloseLockHeld(() =>
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
    )

    expect(attempt.acquired).toBe(false)
    expect(attempt.result).toBeNull()
    expect(await db.payoutCycle.count({ where: { status: 'CLOSED' } })).toBe(0)
    expect(await db.payout.count()).toBe(0)
    expect(await db.ledgerEntry.count({ where: { type: 'SALARY' } })).toBe(0)
  })

  it('بعد تحرير القفل تُغلق الدورة مرة واحدة فقط', async () => {
    // The refused attempt must leave nothing behind that makes the next one
    // behave differently — a half-closed cycle, or a salary already accrued
    // against a cycle that never closed.
    const { actor } = await agencyReadyToClose()

    const blocked = await whileCloseLockHeld(() =>
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
    )
    expect(blocked.acquired).toBe(false)

    const second = await closeCycleUnderLock(db, {
      actor,
      now: CLOSE_AT,
      cycleDay: CYCLE_DAY,
    })

    expect(second.result?.closed).toBe(true)
    expect(await db.payoutCycle.count({ where: { status: 'CLOSED' } })).toBe(1)
    expect(await db.payoutCycle.count({ where: { status: 'OPEN' } })).toBe(1)
    expect(await db.ledgerEntry.count({ where: { type: 'SALARY' } })).toBe(1)
    expect(await db.payout.count()).toBe(2)
  })
})
