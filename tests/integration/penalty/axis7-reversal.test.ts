import { describe, expect, it, vi } from 'vitest'

import { DomainError, NotFoundError, type AppError } from '@/lib/errors'
import { add, mul, negate, pct, sub, toStorageString } from '@/lib/money'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { balanceFor } from '@/modules/ledger/service'
import type { MoneyDomainEvent, MoneyReversedEvent } from '@/modules/penalty/ports'

import {
  createLedgerEntry,
  createPayout,
  createPayoutCycle,
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import {
  activePenalties,
  CYCLE_DAY,
  netPenaltyFor,
  penaltyRows,
  recompute,
  recordingEvents,
  reversalRows,
} from '../../helpers/penalty'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

// The same preamble as `reversal.test.ts`, deliberately: this file and that one
// hold two halves of one axis, and a case must be movable between them without
// discovering that half the module graph is missing.
vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const { reversePenaltyOrBonus, grantBonus, createManualPenalty } =
  await import('@/modules/penalty/service')

/**
 * docs/TESTING.md §4 axis 7 — REVERSAL, for penalties and bonuses.
 *
 * `reversal.test.ts` proves who is *allowed* to reverse and that the three
 * refusals reach a manager as Arabic rather than as a stack trace.
 * `../ledger/reversal.test.ts` proves the correction cancels its original for
 * every type money moves through. This file is the third question, and the one a
 * منفّذ actually asks: **after the correction, what is true?**
 *
 *  - the ledger still holds every row it held, unchanged (CLAUDE.md invariant 1),
 *  - the sum is exactly what it was before the mistake,
 *  - and the reversal does not quietly become a policy — the engine keeps
 *    computing the figure the arithmetic says is owed.
 *
 * ── The canonical scenario, shared with `engine.test.ts` ───────────────────
 *
 * 2026-03-01 is a **Sunday**; the default weekend is Friday and Saturday.
 *
 *   dueDate            Sun 2026-03-01 17:00 Cairo
 *   + 24h grace        Mon 2026-03-02 17:00   ← lateness starts counting here
 *   measured at        Thu 2026-03-05 12:00   → 3 working days
 *
 * The reversal and the re-run happen at 13:00 and 14:00 on that same Thursday,
 * so the lateness the engine measures is unchanged by the correction itself —
 * which is the whole point of the "does a reversal pardon?" test below.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NOW = cairo('2026-03-05T12:00')
const REVERSED_AT = cairo('2026-03-05T13:00')
const RECOMPUTED_AT = cairo('2026-03-05T14:00')
/** Three further working days: Fri and Sat contribute nothing, Sun 08 does. */
const LATER = cairo('2026-03-08T12:00')

const IN_JULY = cairo('2026-07-10T09:00')
const IN_AUGUST = cairo('2026-08-10T09:00')

/** Test *inputs* may be literals (docs/TESTING.md §5). Expectations may not. */
const TASK_VALUE = '1000.00'
const LATE_WORKING_DAYS = 3
const LATE_WORKING_DAYS_LATER = 4

const PENALTY_PCT = SETTINGS_CATALOG['penalty.defaultValue'].default

/**
 * `taskValue × penalty.defaultValue% × working days`, computed rather than
 * typed. Lowering the agency's rate in Settings must move every expectation in
 * this file with it, or the suite would keep asserting a figure the product no
 * longer charges.
 */
const PENALTY = toStorageString(mul(pct(TASK_VALUE, PENALTY_PCT), LATE_WORKING_DAYS))
const PENALTY_LATER = toStorageString(
  mul(pct(TASK_VALUE, PENALTY_PCT), LATE_WORKING_DAYS_LATER),
)
const PENALTY_DEBIT = toStorageString(negate(PENALTY))

/** Non-round, so a lost piastre fails an assertion instead of hiding in a zero. */
const OPENING_BALANCE = '1000.33'
const MANUAL_AMOUNT = '249.99'
const BONUS_AMOUNT = '399.99'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The rejected value, so a test can assert the error's class *and* its key. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to reject, but it resolved')
}

const keyOf = (error: unknown): string => (error as AppError).messageKey

type DecimalLike = { toFixed(dp: number): string }

/** A row reduced to comparable values — `Decimal` columns become 2dp strings. */
function snapshot(row: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof (value as DecimalLike | null | undefined)?.toFixed === 'function'
        ? (value as DecimalLike).toFixed(2)
        : value,
    ]),
  )
}

/**
 * Every ledger row a منفّذ has, keyed by id.
 *
 * Comparing two of these is how "no row was updated and no row was deleted" is
 * asserted as a fact about the whole table rather than about the one row a test
 * happened to look at. An UPDATE shows up as a changed value, a DELETE as a
 * missing key, and an unexpected extra write as a changed size.
 */
async function ledgerByEntryId(
  userId: string,
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await db.ledgerEntry.findMany({ where: { userId } })
  return new Map(rows.map((row) => [row.id, snapshot(row)]))
}

function reversedEvents(events: readonly MoneyDomainEvent[]): MoneyReversedEvent[] {
  return events.filter((e): e is MoneyReversedEvent => e.type === 'MoneyReversed')
}

async function scenario() {
  await seedPermissionCatalog(db)
  const worker = await createUser(db, { payType: 'PER_TASK' })
  const manager = await createUserWithPermissions(db, [
    'penalty.create',
    'penalty.reverse',
    'bonus.create',
    'bonus.reverse',
  ])
  return { worker, manager: await actorFor(db, manager.id) }
}

/** The canonical late task, with its automatic deduction already accrued. */
async function accruedPenalty() {
  const { worker, manager } = await scenario()
  const owner = await createUser(db)
  const project = await createProject(db, { ownerId: owner.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'IN_PROGRESS',
    taskValue: TASK_VALUE,
    dueDate: DUE,
    originalDueDate: DUE,
  })
  await recompute(db, task.id, { now: NOW })
  const [entry] = await penaltyRows(db, task.id)
  return { worker, manager, task, entryId: entry!.id }
}

/** A settled period and its successor — every "the reversal lands forward" case. */
async function closedAndOpenCycles() {
  const closed = await createPayoutCycle(db, {
    periodStart: cairo('2026-06-29T00:00'),
    periodEnd: cairo('2026-07-28T23:59'),
    status: 'CLOSED',
  })
  const open = await createPayoutCycle(db, {
    periodStart: cairo('2026-07-28T23:59'),
    periodEnd: cairo('2026-08-28T23:59'),
    status: 'OPEN',
  })
  return { closed, open }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('بعد العكس: المجموع صفر ولا صفّ تغيّر', () => {
  it('يعود مجموع القيود إلى صفر بالضبط، لا إلى ما يقاربه', async () => {
    const { worker, manager, task, entryId } = await accruedPenalty()
    expect(await balanceFor(db, { userId: worker.id })).toBe(PENALTY_DEBIT)

    await reversePenaltyOrBonus(db, {
      entryId,
      reason: 'العميل هو من تأخر في اعتماد المادة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: REVERSED_AT,
    })

    // The balance is a SUM and nothing else (CLAUDE.md invariant 1), so "the
    // deduction was undone" and "the sum is zero" are the same sentence.
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
    expect(await netPenaltyFor(db, task.id)).toBe('0.00')
  })

  it('يبقى القيد الأصلي كما هو ولا يُحذف صفّ ولا يُعدَّل', async () => {
    const { worker, manager, entryId } = await accruedPenalty()
    const before = await ledgerByEntryId(worker.id)
    const originalBefore = before.get(entryId)
    expect(originalBefore).toBeDefined()

    await reversePenaltyOrBonus(db, {
      entryId,
      reason: 'اعتُمد تمديد بأثر رجعي',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: REVERSED_AT,
    })

    const after = await ledgerByEntryId(worker.id)
    // The narrow claim first, so a failure names the row that moved.
    expect(after.get(entryId)).toEqual(originalBefore)
    // Then the wide one: every row that existed still exists, byte for byte. A
    // future refactor that "helpfully" stamped the original as cancelled would
    // be an UPDATE on an append-only table, and a منفّذ who printed their
    // statement yesterday would be holding a document that no longer matches.
    for (const [id, row] of before) expect(after.get(id)).toEqual(row)
    // Exactly one row appended — the REVERSAL — and nothing removed.
    expect(after.size).toBe(before.size + 1)
  })
})

describe('عكس خصم يدوي', () => {
  it('يعكس خصمًا قرّره إنسان ويعيد الرصيد إلى ما كان قبله', async () => {
    const { worker, manager } = await scenario()
    await createLedgerEntry(db, {
      userId: worker.id,
      amount: OPENING_BALANCE,
      createdAt: IN_AUGUST,
    })
    const penalty = await createManualPenalty(db, {
      userId: worker.id,
      amount: MANUAL_AMOUNT,
      reason: 'غياب يومين دون إخطار مسبق',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    expect(await balanceFor(db, { userId: worker.id })).toBe(
      toStorageString(sub(OPENING_BALANCE, MANUAL_AMOUNT)),
    )

    const outcome = await reversePenaltyOrBonus(db, {
      entryId: penalty.entryId as string,
      reason: 'الغياب كان بإذن شفهي من مدير المشروع',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(outcome.type).toBe('PENALTY')
    expect(await balanceFor(db, { userId: worker.id })).toBe(OPENING_BALANCE)
    const reversal = await db.ledgerEntry.findUniqueOrThrow({
      where: { id: outcome.reversalId },
      select: { amount: true, isAutoGenerated: true, createdById: true },
    })
    expect(reversal.amount.toFixed(2)).toBe(MANUAL_AMOUNT)
    // A human undid a human's decision. The statement's "تلقائي" column must
    // not claim the machine did either half of that.
    expect(reversal.isAutoGenerated).toBe(false)
    expect(reversal.createdById).toBe(manager.id)
  })

  it('عكس خصم يدوي على مهمة لا يمسّ الخصم الآلي على المهمة نفسها', async () => {
    // The mirror of "the engine does not touch a manager's deduction": the
    // manager's correction must not take the engine's figure with it. Both
    // deductions live on one task and one منفّذ, so anything that reversed by
    // `taskId` rather than by entry would pass every other test in the suite
    // and silently refund a delivery that really was late.
    const { worker, manager, task } = await accruedPenalty()
    const manual = await createManualPenalty(db, {
      userId: worker.id,
      taskId: task.id,
      amount: MANUAL_AMOUNT,
      reason: 'تسليم ناقص المرفقات',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    await reversePenaltyOrBonus(db, {
      entryId: manual.entryId as string,
      reason: 'المرفقات كانت مرسلة على قناة أخرى',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: REVERSED_AT,
    })

    expect(await activePenalties(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe(PENALTY_DEBIT)
    expect(await balanceFor(db, { userId: worker.id })).toBe(PENALTY_DEBIT)
    const reversals = await reversalRows(db, task.id)
    expect(reversals).toHaveLength(1)
    expect(reversals[0]?.reversesEntryId).toBe(manual.entryId)
    // The reversal carries the task, so the credit is a readable line on the
    // statement rather than an unexplained plus against nothing.
    expect(reversals[0]?.amount).toBe(MANUAL_AMOUNT)
  })
})

describe('العكس تصحيح لرقم، لا عفو دائم', () => {
  /**
   * **The reversal is a correction of a FIGURE, not a standing pardon.**
   *
   * This is worth pinning because a manager will confidently expect one or the
   * other, and the two readings differ by a month's money. Reversing an
   * automatic deduction says "this number was wrong"; it does not say "this
   * منفّذ is excused". The engine's target is a pure function of the due date,
   * the grace, the calendar and the profile — none of which a reversal
   * touches — so the next nightly sweep finds no active auto entry, computes
   * the same figure, and charges it again.
   *
   * To make a pardon stick, an *input* has to change: approve an extension, or
   * take the task out of the penalisable set. Otherwise the honest instruments
   * are `penalty.reverse` on each run's entry, or a `BONUS`/`ADJUSTMENT`, which
   * is a decision on the record instead of a deduction that mysteriously never
   * returns.
   */
  it('إعادة الحساب بعد العكس تعيد فرض الخصم لأن الحساب ما زال يقول إنه مستحق', async () => {
    const { worker, manager, task, entryId } = await accruedPenalty()
    await reversePenaltyOrBonus(db, {
      entryId,
      reason: 'راجعت الحساب وقرّرت إلغاءه',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: REVERSED_AT,
    })
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')

    // The nightly sweep, on the same day, against the same unchanged deadline.
    const outcome = await recompute(db, task.id, { now: RECOMPUTED_AT })

    expect(outcome.outcome).toBe('applied')
    expect(outcome.amount).toBe(PENALTY)
    expect(await balanceFor(db, { userId: worker.id })).toBe(PENALTY_DEBIT)

    const rows = await penaltyRows(db, task.id)
    expect(rows).toHaveLength(2)
    // The first stays reversed — nothing re-activates it — and the charge comes
    // back as its own new row, which is what makes the statement readable:
    // خصم، عكس، خصم، each with a date and a reason.
    expect(rows[0]?.id).toBe(entryId)
    expect(rows[0]?.reversed).toBe(true)
    expect(rows[1]?.id).not.toBe(entryId)
    expect(rows[1]?.reversed).toBe(false)
    expect(await activePenalties(db, task.id)).toHaveLength(1)
  })
})

describe('عكس المكافأة يسترد المال', () => {
  it('يُنقص الرصيد بمقدار المكافأة بالضبط', async () => {
    // The asymmetry that makes this worth its own case: reversing a خصم gives
    // money back and reversing a مكافأة takes it away. SPEC §6 gives the second
    // its own permission key for that reason, and the arithmetic has to be
    // exact in the direction that hurts too.
    const { worker, manager } = await scenario()
    await createLedgerEntry(db, {
      userId: worker.id,
      amount: OPENING_BALANCE,
      createdAt: IN_AUGUST,
    })
    const bonus = await grantBonus(db, {
      userId: worker.id,
      amount: BONUS_AMOUNT,
      reason: 'إنقاذ تسليم عميل في عطلة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    expect(await balanceFor(db, { userId: worker.id })).toBe(
      toStorageString(add(OPENING_BALANCE, BONUS_AMOUNT)),
    )

    const outcome = await reversePenaltyOrBonus(db, {
      entryId: bonus.entryId,
      reason: 'المكافأة سُجّلت للشخص الخطأ',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(outcome.type).toBe('BONUS')
    expect(await balanceFor(db, { userId: worker.id })).toBe(OPENING_BALANCE)
    const reversal = await db.ledgerEntry.findUniqueOrThrow({
      where: { id: outcome.reversalId },
      select: { amount: true },
    })
    expect(reversal.amount.toFixed(2)).toBe(toStorageString(negate(BONUS_AMOUNT)))
  })
})

describe('العكس يقع في الدورة المفتوحة', () => {
  it('قيد من دورة مغلقة لم تُصرف يُعكس في الدورة المفتوحة', async () => {
    // A منفّذ has already read the closed statement. The correction is meant to
    // appear as its own movement next month, not to rewrite a document somebody
    // is holding — so the assertion is on the reversal's `cycleId`, not merely
    // on the balance, which would be right either way.
    const { worker, manager } = await scenario()
    const { closed, open } = await closedAndOpenCycles()
    const entry = await createLedgerEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: PENALTY_DEBIT,
      cycleId: closed.id,
      createdAt: IN_JULY,
    })

    const outcome = await reversePenaltyOrBonus(db, {
      entryId: entry.id,
      reason: 'اعتُمد التمديد بأثر رجعي',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const reversal = await db.ledgerEntry.findUniqueOrThrow({
      where: { id: outcome.reversalId },
      select: { cycleId: true },
    })
    expect(reversal.cycleId).toBe(open.id)
    expect(reversal.cycleId).not.toBe(closed.id)
    // The settled period holds exactly what it held: one deduction, no credit.
    expect(await db.ledgerEntry.count({ where: { cycleId: closed.id } })).toBe(1)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})

describe('ما صُرف لا يُعكس، وما لم يُصرف بعد لا يمنع', () => {
  /** A penalty sitting in a settled period, with a payout in the given state. */
  async function paidScenario(status: 'DRAFT' | 'APPROVED' | 'PAID', paidAmount: string) {
    const { worker, manager } = await scenario()
    const { closed } = await closedAndOpenCycles()
    const entry = await createLedgerEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: PENALTY_DEBIT,
      cycleId: closed.id,
      createdAt: IN_JULY,
    })
    await createPayout(db, {
      userId: worker.id,
      cycleId: closed.id,
      status,
      net: '750.00',
      paidAmount,
    })
    return { worker, manager, entryId: entry.id }
  }

  it('عكس بعد صرف جزئي من مستحق مدفوع يفشل ولا يكتب شيئًا', async () => {
    // The guard reads the payout's **status**, not the arithmetic of
    // `paidAmount` vs `net`, and that is the correct reading: once a payout is
    // PAID, cash has left the agency against that period, and `paidAmount` is a
    // running total a REVERSAL cannot reconcile itself with. The instrument for
    // a paid period is an ADJUSTMENT in the open cycle, which the Arabic
    // message names for the manager.
    const { worker, manager, entryId } = await paidScenario('PAID', '300.00')

    const error = await rejection(
      reversePenaltyOrBonus(db, {
        entryId,
        reason: 'الخصم كان خاطئًا',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    )

    expect(error).toBeInstanceOf(DomainError)
    expect(keyOf(error)).toBe('ledger.errors.cycleAlreadyPaid')
    // Refused before the write, not rolled back after it.
    expect(await db.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(0)
    expect(await db.auditLog.count({ where: { action: 'penalty.reversed' } })).toBe(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe(PENALTY_DEBIT)
  })

  it.each(['DRAFT', 'APPROVED'] as const)(
    'مستحق في حالة %s لا يمنع العكس — لم يُصرف شيء بعد',
    async (status) => {
      // Drafting or approving a payout is a plan, not a payment. Blocking the
      // correction at either point would strand a wrong deduction for however
      // long the finance user takes to pay — which is exactly when somebody
      // notices it and asks for it to be fixed.
      const { worker, manager, entryId } = await paidScenario(status, '0.00')

      const outcome = await reversePenaltyOrBonus(db, {
        entryId,
        reason: 'اعتُمد التمديد بأثر رجعي',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      })

      expect(outcome.type).toBe('PENALTY')
      expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
    },
  )
})

describe('حمولة حدث MoneyReversed', () => {
  it('العكس البشري يحمل من قرّره ونوع القيد ومقداره وسببه كما كُتب', async () => {
    // Phase 9 renders this payload into a منفّذ's bell without recomputing
    // anything, so whatever is wrong here is wrong in front of them and cannot
    // be corrected by fixing the ledger later.
    const { worker, manager, task, entryId } = await accruedPenalty()
    const events = recordingEvents()
    const reason = 'العميل تأخر في اعتماد النص، والمنفّذ لا ذنب له'

    const outcome = await reversePenaltyOrBonus(db, {
      entryId,
      reason,
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: REVERSED_AT,
      events,
    })

    expect(events.events).toHaveLength(1)
    const [event] = reversedEvents(events.events)
    // The منفّذ whose money moved, never the manager who moved it.
    expect(event?.userId).toBe(worker.id)
    expect(event?.reversedType).toBe('PENALTY')
    // A positive magnitude: the bell says "أُلغي خصم 150.00", not "−150.00".
    expect(event?.amount).toBe(PENALTY)
    expect(event?.reason).toBe(reason)
    expect(event?.reversedById).toBe(manager.id)
    expect(event?.isAutoGenerated).toBe(false)
    expect(event?.dismissable).toBe(true)
    expect(event?.entryId).toBe(outcome.reversalId)
    expect(event?.reversesEntryId).toBe(entryId)
    expect(event?.taskId).toBe(task.id)
  })

  it('تصحيح المحرّك لنفسه بلا صاحب قرار: reversedById فارغ وisAutoGenerated', async () => {
    // The distinction the notification is built on. A منفّذ told "المدير ألغى
    // خصمك" when in fact the nightly job re-measured the lateness has been told
    // something false about a person, which is worse than being told nothing.
    const { worker, task, entryId } = await accruedPenalty()
    const events = recordingEvents()

    // Three more working days: the figure moves, so the engine reverses its own
    // entry and inserts the new one.
    const outcome = await recompute(db, task.id, { now: LATER, events })
    expect(outcome.outcome).toBe('recalculated')
    expect(outcome.amount).toBe(PENALTY_LATER)

    const [event] = reversedEvents(events.events)
    expect(event?.userId).toBe(worker.id)
    expect(event?.reversedType).toBe('PENALTY')
    // The figure that was undone, not the one replacing it.
    expect(event?.amount).toBe(PENALTY)
    expect(event?.reversedById).toBeNull()
    expect(event?.isAutoGenerated).toBe(true)
    expect(event?.reversesEntryId).toBe(entryId)

    // The bell and the statement say the same sentence, because they are the
    // same string rather than two renderings of one idea.
    const [reversal] = await reversalRows(db, task.id)
    expect(event?.reason).toBe(reversal?.note)
  })

  it('عكس المكافأة يُعلن نوعها BONUS لا PENALTY', async () => {
    // Same event, opposite news. Getting the type wrong tells the منفّذ their
    // deduction was cancelled on the day their bonus was taken away.
    const { worker, manager } = await scenario()
    const events = recordingEvents()
    const bonus = await grantBonus(db, {
      userId: worker.id,
      amount: BONUS_AMOUNT,
      reason: 'إنجاز مبكر',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    await reversePenaltyOrBonus(db, {
      entryId: bonus.entryId,
      reason: 'مُنحت مرتين بالخطأ',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
      events,
    })

    const [event] = reversedEvents(events.events)
    expect(event?.reversedType).toBe('BONUS')
    expect(event?.amount).toBe(BONUS_AMOUNT)
    expect(event?.taskId).toBeNull()
    expect(event?.reversedById).toBe(manager.id)
  })
})

describe('العكس بعد حذف المنفّذ', () => {
  /**
   * **The code guarantees a departed منفّذ's history stays readable, not
   * correctable.** `appendEntry` refuses to write anything to a soft-deleted
   * user (CLAUDE.md invariant 8 on the write side), and a reversal *is* an
   * append — so once somebody leaves, a wrong deduction on their statement can
   * no longer be undone in place.
   *
   * That is a real cost and it is asserted rather than wished away, because a
   * reader who knows "the ledger is append-only, nothing is ever lost" would
   * naturally assume the opposite. The trade is deliberate: the alternative is
   * a write path that treats "deleted" as advisory, which is how a soft-delete
   * stops meaning anything. What stays visible is the
   * `payout.skippedDeletedUser` audit row the close writes for any departed
   * worker still carrying a balance — the settlement is a conversation, not a
   * ledger entry.
   */
  it('عكس قيد لمنفّذ محذوف يفشل ولا يترك قيدًا ولا تدقيقًا ولا إشعارًا', async () => {
    const { worker, manager, entryId } = await accruedPenalty()
    const events = recordingEvents()
    await db.user.update({
      where: { id: worker.id },
      data: { deletedAt: cairo('2026-03-05T12:30') },
    })

    const error = await rejection(
      reversePenaltyOrBonus(db, {
        entryId,
        reason: 'الخصم كان خاطئًا',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: REVERSED_AT,
        events,
      }),
    )

    // A NotFoundError naming a *user*, raised from a call about an *entry* —
    // pinned here because the symptom is confusing enough to be "fixed" by
    // somebody who does not know it is the invariant talking.
    expect(error).toBeInstanceOf(NotFoundError)
    expect(await db.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(0)
    expect(await db.auditLog.count({ where: { action: 'penalty.reversed' } })).toBe(0)
    // Nothing half-happened: no bell rang about money that did not move.
    expect(events.events).toHaveLength(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe(PENALTY_DEBIT)
  })
})

describe('القيد العكسي لا يُعكس بدوره', () => {
  it('محاولة عكس قيد عكسي تُرفض ولا تغيّر الدفتر بأي صفّ', async () => {
    // Reversing a reversal is a re-application, not a correction: the trail
    // would read backwards and nobody totalling the chain by hand could say
    // which negation is still in force. Through this path the refusal arrives
    // one step earlier than the ledger's own — a REVERSAL is neither a خصم nor
    // a مكافأة, and SPEC §6 gives a human keys for exactly those two — so the
    // key asserted here is `notHumanReversible`, not `cannotReverseReversal`.
    const { worker, manager, entryId } = await accruedPenalty()
    const events = recordingEvents()
    const first = await reversePenaltyOrBonus(db, {
      entryId,
      reason: 'قرار الإدارة بإلغاء الخصم',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: REVERSED_AT,
    })
    const before = await ledgerByEntryId(worker.id)

    const error = await rejection(
      reversePenaltyOrBonus(db, {
        entryId: first.reversalId,
        reason: 'تراجعنا عن التراجع',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: RECOMPUTED_AT,
        events,
      }),
    )

    expect(error).toBeInstanceOf(DomainError)
    expect(keyOf(error)).toBe('ledger.errors.notHumanReversible')

    // Not merely "it threw": the ledger is the thing that must be unchanged.
    const after = await ledgerByEntryId(worker.id)
    expect(after.size).toBe(before.size)
    for (const [id, row] of before) expect(after.get(id)).toEqual(row)
    // The first reversal's audit row stands alone; the refused attempt left no
    // record of a decision nobody was allowed to make.
    expect(await db.auditLog.count({ where: { action: 'penalty.reversed' } })).toBe(1)
    expect(events.events).toHaveLength(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})
