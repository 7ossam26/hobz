import { describe, expect, it } from 'vitest'

import { ConflictError, DomainError, NotFoundError, type AppError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import {
  appendEntry,
  balanceFor,
  recordAdjustment,
  reverseEntry,
} from '@/modules/ledger/service'
import type { LedgerType } from '@/modules/ledger/sign'

import {
  createLedgerEntry,
  createPayout,
  createPayoutCycle,
  createProject,
  createTask,
  createUser,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const CYCLE_DAY = SETTINGS_CATALOG['payout.cycleDay'].default

/**
 * docs/TESTING.md §4 axis 7 — REVERSAL, in full.
 *
 * `append-only.test.ts` proves the shape of a correction (a second row, never an
 * UPDATE). This file is about the three things that make the correction *safe*:
 *
 *  - it cancels the original **exactly**, for every type money moves through,
 *  - it lands in the **open** cycle, so a statement somebody already read never
 *    changes underneath them,
 *  - and it is refused once the money has actually left the organization.
 *
 * Every instant is an explicit Cairo wall-clock reading (docs/TESTING.md §5).
 * That is not decoration here: `appendEntry` stamps an entry with whichever
 * cycle is open *at its `createdAt`*, so a test that let the clock decide would
 * attach the original and its reversal to whatever cycle the suite happened to
 * run in — and the "closed cycle vs open cycle" assertions below would quietly
 * stop testing anything on the 29th of a month.
 */
const IN_JULY = cairo('2026-07-10T09:00')
const IN_AUGUST = cairo('2026-08-10T09:00')
const NOW = cairo('2026-08-15T10:00')

/** A non-round opening balance, so any rounding drift shows up as a mismatch. */
const OPENING_BALANCE = '1000.33'

async function scenario() {
  await seedPermissionCatalog(db)
  const manager = await createUser(db)
  const worker = await createUser(db)
  return { manager: await actorFor(db, manager.id), worker }
}

/**
 * A cycle that has been closed and the one that succeeded it, with contiguous
 * periods — the arrangement every "the reversal must not touch the closed
 * statement" test needs.
 */
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

/** The rejected value, so a test can assert on the error's identity *and* its key. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to reject, but it resolved')
}

const keyOf = (error: unknown): string => (error as AppError).messageKey
const prismaCodeOf = (error: unknown): string | undefined =>
  (error as { code?: string }).code

/**
 * A row reduced to comparable values — `Decimal` columns become their 2dp
 * strings, so `toEqual` compares the money rather than two decimal.js internals.
 */
type DecimalLike = { toFixed(dp: number): string }

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
 * Every type a correction can legitimately land on, with the amount its reversal
 * must carry.
 *
 * The axis brief names only "a penalty" and "a bonus". Enumerating all six is
 * the point: `reverseEntry` negates whatever it finds and writes it as a
 * `REVERSAL`, whose sign rule is `either` — so nothing in `assertSignForType`
 * would catch a negation that was skipped, doubled, or rounded for one type and
 * not the others. Amounts end in `.99`/`.55`/`.01` so a lost piastre fails the
 * balance assertion instead of hiding in a round number.
 */
const REVERSIBLE: ReadonlyArray<[LedgerType, string, string]> = [
  ['PENALTY', '-249.99', '249.99'],
  ['BONUS', '399.99', '-399.99'],
  ['EARNING', '1499.99', '-1499.99'],
  ['ADVANCE', '-2999.99', '2999.99'],
  ['ADJUSTMENT', '-120.55', '120.55'],
  ['SALARY', '11000.01', '-11000.01'],
]

describe('modules/ledger — القيد العكسي يلغي أثر القيد بالضبط', () => {
  it.each([...REVERSIBLE])(
    'يعكس قيد %s بمقدار مساوٍ وإشارة معكوسة ويعيد الرصيد إلى ما كان',
    async (type, amount, negated) => {
      const { manager, worker } = await scenario()
      await createLedgerEntry(db, {
        userId: worker.id,
        amount: OPENING_BALANCE,
        createdAt: IN_AUGUST,
      })

      const original = await appendEntry(db, {
        userId: worker.id,
        type,
        amount,
        note: `حركة من نوع ${type}`,
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      })
      // The entry must actually have moved the balance, or the assertion below
      // would pass for a reversal that did nothing at all.
      expect(await balanceFor(db, { userId: worker.id })).not.toBe(OPENING_BALANCE)

      const reversal = await reverseEntry(db, {
        entryId: original.id,
        reason: 'تصحيح بعد المراجعة',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      })

      expect(reversal.type).toBe('REVERSAL')
      expect(reversal.amount).toBe(negated)
      expect(reversal.reversesEntryId).toBe(original.id)
      expect(await balanceFor(db, { userId: worker.id })).toBe(OPENING_BALANCE)
    },
  )

  it('يحمل القيد العكسي مهمة الأصل ليظل السطر مفهومًا في الكشف', async () => {
    // Without the copied `taskId` the منفّذ sees "‎−1500.00 تصحيح" against no
    // task at all, which is exactly the unexplainable movement this product
    // exists to abolish.
    const { manager, worker } = await scenario()
    const project = await createProject(db, { ownerId: manager.id })
    const task = await createTask(db, { projectId: project.id, assigneeId: worker.id })

    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'EARNING',
      amount: '1500.00',
      taskId: task.id,
      note: 'أجر مهمة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'أُلغيت المهمة بعد اعتمادها',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    expect(reversal.taskId).toBe(task.id)
  })

  it('القيد العكسي يخصّ المنفّذ نفسه ويُنسب إلى من صحّح', async () => {
    // Two different people in one row. Crediting the correction to the manager
    // instead of the منفّذ would pay the wrong person and leave the deduction
    // standing.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'الخصم احتُسب على مهمة ممددة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    expect(reversal.userId).toBe(worker.id)
    expect(reversal.createdById).toBe(manager.id)
    expect(await balanceFor(db, { userId: manager.id })).toBe('0.00')
  })

  it('سبب العكس هو نصّ القيد الذي يقرؤه المنفّذ، مقصوص الأطراف', async () => {
    // The reason is not filed away in the audit log only — it is the statement
    // line. Storing it untrimmed leaks whitespace into an RTL table cell.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: '  المكافأة سُجّلت مرتين  ',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    expect(reversal.note).toBe('المكافأة سُجّلت مرتين')
  })

  it('يميّز العكس اليدوي عن العكس الآلي', async () => {
    // `reverseTaskEarning` passes `isAutoGenerated: true` when a cancellation
    // reverses an earning. The statement's "تلقائي" column, and Phase 8's "one
    // active *auto* PENALTY per task", both read this flag — a reversal written
    // by a person must never claim the machine did it.
    const { manager, worker } = await scenario()
    const [byHand, byJob] = [
      await appendEntry(db, {
        userId: worker.id,
        type: 'BONUS',
        amount: '400.00',
        note: 'مكافأة أولى',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
      await appendEntry(db, {
        userId: worker.id,
        type: 'BONUS',
        amount: '500.00',
        note: 'مكافأة ثانية',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    ]

    const manual = await reverseEntry(db, {
      entryId: byHand.id,
      reason: 'قرار المدير',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })
    const automatic = await reverseEntry(db, {
      entryId: byJob.id,
      reason: 'إلغاء تلقائي',
      actor: null,
      cycleDay: CYCLE_DAY,
      at: NOW,
      isAutoGenerated: true,
    })

    expect(manual.isAutoGenerated).toBe(false)
    expect(automatic.isAutoGenerated).toBe(true)
  })

  it('لا يُعدَّل القيد الأصلي بأي حرف بعد عكسه', async () => {
    // CLAUDE.md invariant 1 asserted at the widest possible width: not "the
    // amount survived" but "the row survived", including `note` and `cycleId`.
    // A future refactor that "helpfully" stamped the original as cancelled
    // would be an UPDATE on an append-only table.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    const before = await db.ledgerEntry.findUniqueOrThrow({ where: { id: original.id } })

    await reverseEntry(db, {
      entryId: original.id,
      reason: 'تمديد معتمد',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    const after = await db.ledgerEntry.findUniqueOrThrow({ where: { id: original.id } })
    expect(snapshot(after)).toEqual(snapshot(before))
  })
})

describe('modules/ledger — العكس يقع في الدورة المفتوحة لا في الدورة المغلقة', () => {
  it('يقيّد العكس في الدورة المفتوحة وإن كان الأصل في دورة مغلقة', async () => {
    // SPEC §5.4's recomputation ("insert REVERSAL + insert new PENALTY") has to
    // work across a cycle boundary. It only stays safe because the correction
    // lands *forward*: attributing it to the closed cycle would silently change
    // a period that has already been reported.
    const { manager, worker } = await scenario()
    const { closed, open } = await closedAndOpenCycles()

    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleId: closed.id,
      cycleDay: CYCLE_DAY,
      at: IN_JULY,
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'اعتُمد التمديد بأثر رجعي',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(reversal.cycleId).toBe(open.id)
    expect(reversal.cycleId).not.toBe(closed.id)
  })

  it('لا يمسّ أرقام المستحق المخزّنة للدورة المغلقة', async () => {
    // The منفّذ has already read this statement. Recomputing its columns after
    // the fact — even to a "more correct" figure — turns a document into a
    // moving target, and the correction is meant to appear as its own movement
    // next month instead.
    const { manager, worker } = await scenario()
    const { closed } = await closedAndOpenCycles()

    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleId: closed.id,
      cycleDay: CYCLE_DAY,
      at: IN_JULY,
    })
    const payout = await createPayout(db, {
      userId: worker.id,
      cycleId: closed.id,
      gross: '1000.00',
      penalties: '250.00',
      net: '750.00',
      status: 'DRAFT',
    })
    const before = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })

    await reverseEntry(db, {
      entryId: original.id,
      reason: 'اعتُمد التمديد بأثر رجعي',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const after = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })
    expect(snapshot(after)).toEqual(snapshot(before))
  })

  it('يفتح دورة جديدة ولا يعيد فتح المغلقة حين لا توجد دورة مفتوحة', async () => {
    // The window between "the cycle closed" and "somebody wrote the next
    // entry". Re-opening the settled cycle to hold the reversal would undo the
    // close and let a second payout be drafted for money already drafted once.
    const { manager, worker } = await scenario()
    const closed = await createPayoutCycle(db, {
      periodStart: cairo('2026-06-29T00:00'),
      periodEnd: cairo('2026-07-28T23:59'),
      status: 'CLOSED',
    })

    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleId: closed.id,
      cycleDay: CYCLE_DAY,
      at: IN_JULY,
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'اعتُمد التمديد بأثر رجعي',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const stillClosed = await db.payoutCycle.findUniqueOrThrow({
      where: { id: closed.id },
    })
    const open = await db.payoutCycle.findFirstOrThrow({ where: { status: 'OPEN' } })

    expect(stillClosed.status).toBe('CLOSED')
    expect(reversal.cycleId).toBe(open.id)
    // Contiguous: the new cycle starts exactly where the settled one ended, so
    // the reversal cannot fall into a gap between two periods.
    expect(open.periodStart).toEqual(closed.periodEnd)
  })

  it('يعكس قيدًا لا ينتمي إلى أي دورة ويقيّده في الدورة المفتوحة', async () => {
    // SPEC §4 makes `cycleId` nullable so history predating the first cycle can
    // be imported. Such an entry has no payout to consult, and the paid-guard
    // must not read "no cycle" as "cannot be corrected" — that would make every
    // imported row permanently wrong.
    const { manager, worker } = await scenario()
    const { open } = await closedAndOpenCycles()
    const orphan = await createLedgerEntry(db, {
      userId: worker.id,
      cycleId: null,
      type: 'PENALTY',
      amount: '-99.99',
      createdAt: IN_JULY,
    })

    const reversal = await reverseEntry(db, {
      entryId: orphan.id,
      reason: 'خصم مستورد بالخطأ',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(reversal.amount).toBe('99.99')
    expect(reversal.cycleId).toBe(open.id)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})

describe('modules/ledger — ما صُرف فعلًا لا يُعكس', () => {
  it('يرفض العكس بعد صرف مستحق المنفّذ عن تلك الدورة ويسمّي السبب', async () => {
    // docs/TESTING.md §4 axis 7. The messageKey is asserted, not just the error
    // class: `reverseTaskEarning` branches on exactly this key to audit a
    // blocked clawback and let the cancellation succeed anyway. Rename the key
    // and that branch silently stops catching, turning a refused correction
    // into a thrown error in the middle of cancelling a task.
    const { manager, worker } = await scenario()
    const { closed } = await closedAndOpenCycles()

    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleId: closed.id,
      cycleDay: CYCLE_DAY,
      at: IN_JULY,
    })
    await createPayout(db, {
      userId: worker.id,
      cycleId: closed.id,
      status: 'PAID',
      net: '750.00',
      paidAmount: '750.00',
    })

    const error = await rejection(
      reverseEntry(db, {
        entryId: original.id,
        reason: 'الخصم كان خاطئًا',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    )

    expect(error).toBeInstanceOf(DomainError)
    expect(keyOf(error)).toBe('ledger.errors.cycleAlreadyPaid')
    expect((error as AppError).details).toMatchObject({
      entryId: original.id,
      cycleId: closed.id,
    })
    // Refused before anything was written, not rolled back after.
    expect(await db.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe('-250.00')
  })

  it('يسمح بالعكس حين يكون المصروف مستحق منفّذ آخر في نفس الدورة', async () => {
    // The guard is per منفّذ, not per cycle. In an organization of a hundred people
    // the first payment of the month would otherwise freeze every other
    // worker's corrections until the last one was paid.
    const { manager, worker } = await scenario()
    const other = await createUser(db)
    const { closed } = await closedAndOpenCycles()

    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleId: closed.id,
      cycleDay: CYCLE_DAY,
      at: IN_JULY,
    })
    await createPayout(db, {
      userId: other.id,
      cycleId: closed.id,
      status: 'PAID',
      net: '900.00',
      paidAmount: '900.00',
    })
    await createPayout(db, {
      userId: worker.id,
      cycleId: closed.id,
      status: 'DRAFT',
      net: '750.00',
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'اعتُمد التمديد بأثر رجعي',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(reversal.amount).toBe('250.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('يسمح بالعكس حين صُرف جزء من المستحق ولم يكتمل', async () => {
    // A partial payment leaves the payout APPROVED, so the guard lets the
    // correction through. That is coherent rather than lax: the reversal lands
    // in the open cycle, the partially-paid statement is untouched, and the
    // remainder is still measured against a balance that is now right. Blocking
    // it would strand a wrong deduction the moment a first instalment was paid.
    const { manager, worker } = await scenario()
    const { closed } = await closedAndOpenCycles()

    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleId: closed.id,
      cycleDay: CYCLE_DAY,
      at: IN_JULY,
    })
    await createPayout(db, {
      userId: worker.id,
      cycleId: closed.id,
      status: 'APPROVED',
      net: '750.00',
      paidAmount: '300.00',
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'اعتُمد التمديد بأثر رجعي',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(reversal.amount).toBe('250.00')
  })
})

describe('modules/ledger — لا عكس مرتين ولا عكس للعكس', () => {
  it('يرفض عكس القيد مرتين ولا يحرّك الرصيد مرتين', async () => {
    // The money consequence, not just the error: a second reversal would credit
    // the مكافأة back twice and hand the منفّذ 400 جنيه they were never owed.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    await reverseEntry(db, {
      entryId: original.id,
      reason: 'المكافأة سُجّلت مرتين',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    const error = await rejection(
      reverseEntry(db, {
        entryId: original.id,
        reason: 'محاولة ثانية',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect(keyOf(error)).toBe('ledger.errors.alreadyReversed')
    expect(await db.ledgerEntry.count({ where: { userId: worker.id } })).toBe(2)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('الفهرس الفريد يرفض قيدًا عكسيًا ثانيًا مكتوبًا يدويًا', async () => {
    // The service's check is a read-then-write, so two concurrent callers can
    // both pass it. `ledger_entries_reversesEntryId_key` is what makes "reverse
    // once" true regardless of who checked when — asserted as a P2002 unique
    // violation rather than as "something threw", because a foreign-key or
    // trigger error here would mean the index is gone and nobody noticed.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    await reverseEntry(db, {
      entryId: original.id,
      reason: 'المكافأة سُجّلت مرتين',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    const error = await rejection(
      db.ledgerEntry.create({
        data: {
          userId: worker.id,
          type: 'REVERSAL',
          amount: '-400.00',
          note: 'التفاف على الخدمة',
          reversesEntryId: original.id,
        },
      }),
    )

    expect(prismaCodeOf(error)).toBe('P2002')
    expect(await db.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(1)
  })

  it('يرفض عكس قيد عكسي', async () => {
    // Reversing a reversal is a re-application, not a correction, and it would
    // make the trail read backwards: a reader totalling the chain by hand can
    // no longer tell which of the negations is still in force.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'المكافأة سُجّلت مرتين',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    const error = await rejection(
      reverseEntry(db, {
        entryId: reversal.id,
        reason: 'أعيدوا المكافأة',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    )

    expect(error).toBeInstanceOf(DomainError)
    expect(keyOf(error)).toBe('ledger.errors.cannotReverseReversal')
    expect(await db.ledgerEntry.count({ where: { userId: worker.id } })).toBe(2)
  })

  it('إعادة تطبيق مبلغ عُكس تكون بقيد تسوية جديد', async () => {
    // What the refusal above is *for*. The statement reads forward — مكافأة،
    // عكس، تسوية — and each line is a decision somebody made, instead of a
    // chain of negations nobody can total by hand.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    await reverseEntry(db, {
      entryId: original.id,
      reason: 'المكافأة سُجّلت مرتين',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    await recordAdjustment(db, {
      userId: worker.id,
      amount: '400.00',
      reason: 'إعادة صرف المكافأة بعد المراجعة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    const entries = await db.ledgerEntry.findMany({
      where: { userId: worker.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    expect(entries.map((row) => row.type)).toEqual(['BONUS', 'REVERSAL', 'ADJUSTMENT'])
    expect(await balanceFor(db, { userId: worker.id })).toBe('400.00')
  })
})

describe('modules/ledger — سبب العكس وسجلّ التدقيق', () => {
  it('يكتب سطر تدقيق للعكس يحمل السبب ويشير إلى القيدين', async () => {
    // CLAUDE.md invariant 7. The row must point at the *new* entry — that is
    // the thing that came into existence — while its payload still names the
    // entry it answers, so "why is this credit here" is one lookup away.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'الخصم احتُسب على مهمة ممددة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'ledger.reversed' },
    })
    expect(audit.entityId).toBe(reversal.id)
    expect(audit.actorId).toBe(manager.id)
    expect(audit.reason).toBe('الخصم احتُسب على مهمة ممددة')
    expect(audit.after as unknown as Record<string, unknown>).toMatchObject({
      type: 'REVERSAL',
      amount: '250.00',
      userId: worker.id,
      reversesEntryId: original.id,
    })
  })

  it('يرفض سببًا من مسافات ولا يكتب قيدًا ولا سطر تدقيق', async () => {
    // A blank reason is the whole failure mode this feature exists to prevent:
    // a correction nobody can explain is indistinguishable from the manager's
    // mood. Refused before the write, so a rejected attempt leaves no trace of
    // money that never moved.
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const error = await rejection(
      reverseEntry(db, {
        entryId: original.id,
        reason: ' \t\n ',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    )

    expect(error).toBeInstanceOf(DomainError)
    expect(keyOf(error)).toBe('ledger.errors.reasonRequired')
    expect(await db.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(0)
    expect(await db.auditLog.count({ where: { action: 'ledger.reversed' } })).toBe(0)
  })
})

describe('modules/ledger — عكس استحقاق مهمة لا يفتح باب الدفع مرتين', () => {
  /** A task whose approval has already been paid, and then reversed. */
  async function reversedEarning() {
    const { manager, worker } = await scenario()
    const project = await createProject(db, { ownerId: manager.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      taskValue: '1500.00',
    })
    const earning = await appendEntry(db, {
      userId: worker.id,
      type: 'EARNING',
      amount: '1500.00',
      taskId: task.id,
      note: 'أجر مهمة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    await reverseEntry(db, {
      entryId: earning.id,
      reason: 'أُلغيت المهمة بعد اعتمادها',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })
    return { manager, worker, task }
  }

  it('يمنع استحقاقًا ثانيًا لنفس المهمة بعد عكس الأول', async () => {
    // `ledger_entries_one_earning_per_task` is `("taskId") WHERE type =
    // 'EARNING'` — it counts EARNING rows, reversed or not. So the reversal
    // does *not* free the task, and a replayed `TaskApproved` after a
    // cancellation cannot pay a second time. The cost of that guarantee is
    // real and worth stating: re-paying this منفّذ for this task is only
    // possible as a deliberate ADJUSTMENT (next test), which is also what the
    // statement should say.
    const { manager, worker, task } = await reversedEarning()

    const error = await rejection(
      appendEntry(db, {
        userId: worker.id,
        type: 'EARNING',
        amount: '1500.00',
        taskId: task.id,
        note: 'أجر المهمة بعد استئنافها',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    )

    expect(prismaCodeOf(error)).toBe('P2002')
    expect(
      await db.ledgerEntry.count({ where: { taskId: task.id, type: 'EARNING' } }),
    ).toBe(1)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('يسمح بقيد تسوية على نفس المهمة — الفهرس على الاستحقاق وحده', async () => {
    // The escape hatch the index leaves open, and the reason it is safe to
    // leave it open: an ADJUSTMENT is signed, reasoned and human, so paying
    // this task again is a decision on the record rather than a duplicate
    // EARNING nobody can tell apart from the first.
    const { manager, worker, task } = await reversedEarning()

    const adjustment = await recordAdjustment(db, {
      userId: worker.id,
      amount: '1500.00',
      reason: 'استُؤنفت المهمة واعتُمدت من جديد',
      actor: manager,
      cycleDay: CYCLE_DAY,
      taskId: task.id,
      at: NOW,
    })

    expect(adjustment.taskId).toBe(task.id)
    expect(await balanceFor(db, { userId: worker.id })).toBe('1500.00')
  })
})

describe('modules/ledger — حدود العكس', () => {
  it('يرفض عكس قيد لمنفّذ محذوف', async () => {
    // CLAUDE.md invariant 8 on the *write* side: `appendEntry` refuses to
    // accrue anything to a soft-deleted منفّذ, and the reversal goes through
    // `appendEntry`. Pinned here because the symptom is confusing — a
    // NotFoundError naming a *user* raised from a call about an *entry* — and
    // because the trade is a real one: a wrong deduction on somebody who has
    // left can no longer be corrected in place. What remains visible is the
    // `payout.skippedDeletedUser` audit row the close writes for any departed
    // worker still carrying a balance.
    const { manager } = await scenario()
    const departed = await createUser(db)
    const original = await appendEntry(db, {
      userId: departed.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    await db.user.update({
      where: { id: departed.id },
      data: { deletedAt: cairo('2026-08-12T09:00') },
    })

    const error = await rejection(
      reverseEntry(db, {
        entryId: original.id,
        reason: 'الخصم كان خاطئًا',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    )

    expect(error).toBeInstanceOf(NotFoundError)
    expect(await db.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(0)
  })
})
