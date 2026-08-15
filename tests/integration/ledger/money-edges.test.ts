import { describe, expect, it } from 'vitest'

import { AppError } from '@/lib/errors'
import { add, div, MONEY_MAX, sum as moneySum, toStorageString } from '@/lib/money'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { appendEntry, balanceFor, recordAdvance } from '@/modules/ledger/service'
import {
  approvePayout,
  closeCycle,
  getPayout,
  markPayoutPaid,
} from '@/modules/payout/service'

import {
  createLedgerEntry,
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

/**
 * docs/TESTING.md §4 axis 8 — money.
 *
 * `payout/carry-forward.test.ts` and `payout/lifecycle.test.ts` prove the
 * headline promises in round numbers: a payout floors at zero, a surplus
 * carries, a remainder stays outstanding. This file is the same promises at the
 * piastre, where they actually break — half a piastre that gets rounded instead
 * of refused, a total that is rounded twice, a zero produced by negation
 * printing as `-0.00`, three payments that must add to a thousand exactly.
 *
 * Nothing here asserts a business number that a Setting owns: the cycle day and
 * the payment methods come from `SETTINGS_CATALOG`, and the column boundary
 * comes from `lib/money`'s `MONEY_MAX` rather than being retyped.
 */

/** The `Decimal(12,2)` boundary, derived rather than restated. */
const COLUMN_MAX = toStorageString(MONEY_MAX)
const ONE_OVER_COLUMN_MAX = toStorageString(add(MONEY_MAX, '0.01'))

const PIASTRE = '0.01'
const HALF_PIASTRE = '0.005'

const AUGUST = cairo('2026-08-28T23:59')
const SEPTEMBER = cairo('2026-09-28T23:59')
const OCTOBER = cairo('2026-10-28T23:59')
const NOVEMBER = cairo('2026-11-28T23:59')

/** See close.test.ts: an entry lands in the cycle its `createdAt` falls inside. */
const IN_AUGUST = cairo('2026-08-10T09:00')
const IN_SEPTEMBER = cairo('2026-09-10T09:00')
const IN_OCTOBER = cairo('2026-10-10T09:00')
const IN_NOVEMBER = cairo('2026-11-10T09:00')

const PAY_AT = cairo('2026-08-29T11:00')
const SECOND_PAY_AT = cairo('2026-09-05T11:00')
const THIRD_PAY_AT = cairo('2026-09-12T11:00')

async function actorAndWorker() {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, [
    'payout.generate',
    'payout.approve',
    'payout.markPaid',
    'advance.create',
  ])
  return { actor: await actorFor(db, admin.id), worker: await createUser(db) }
}

async function payoutFor(userId: string, cycleId: string) {
  return db.payout.findFirstOrThrow({ where: { userId, cycleId } })
}

/**
 * The error a refused write threw, so a test can name the *rule* that refused
 * it. `rejects.toBeInstanceOf(DomainError)` cannot tell "three decimal places"
 * apart from "wrong direction" or "out of range", and this whole axis is about
 * that difference: a scale error means somebody's arithmetic needs a decision,
 * a range error means the column is about to lose digits.
 */
async function refusal(write: Promise<unknown>): Promise<AppError> {
  try {
    await write
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the write to be refused, but it was accepted')
}

/** One منفّذ with an approved payout of exactly `amount`, ready to be paid. */
async function approvedPayoutOf(amount: string) {
  const { actor, worker } = await actorAndWorker()
  await createLedgerEntry(db, {
    createdAt: IN_AUGUST,
    userId: worker.id,
    type: 'EARNING',
    amount,
  })

  const closed = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
  const payout = await payoutFor(worker.id, closed.cycleId!)
  await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

  return { actor, worker, payout, cycleId: closed.cycleId! }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('modules/ledger — حدود القرش الواحد', () => {
  it('يقبل قرشًا واحدًا كأصغر حركة ممكنة', async () => {
    const worker = await createUser(db)

    const entry = await appendEntry(db, {
      userId: worker.id,
      type: 'EARNING',
      amount: PIASTRE,
      note: 'أصغر استحقاق ممكن',
      actor: null,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(entry.amount).toBe('0.01')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.01')
  })

  it('يرفض نصف قرش ولا يقرّبه إلى قرش', async () => {
    // The failure this prevents is not the lost half piastre — it is the
    // statement the منفّذ cannot reproduce by adding the lines up. Rounding on
    // the write path is invisible; refusing is not.
    const worker = await createUser(db)

    const error = await refusal(
      appendEntry(db, {
        userId: worker.id,
        type: 'EARNING',
        amount: HALF_PIASTRE,
        note: 'نصف قرش',
        actor: null,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    )

    expect(error.messageKey).toBe('ledger.errors.amountScale')
    // Refused before anything was written — not written and then compensated.
    expect(await db.ledgerEntry.count()).toBe(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('يقبل الحد الأقصى للعمود كما هو دون بتر', async () => {
    // If `Decimal(12,2)` or `lib/money`'s bound ever narrowed, this is the
    // entry that would come back short — and only in the digits nobody reads.
    const worker = await createUser(db)

    const entry = await appendEntry(db, {
      userId: worker.id,
      type: 'EARNING',
      amount: COLUMN_MAX,
      note: 'أقصى ما يسعه العمود',
      actor: null,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(entry.amount).toBe(COLUMN_MAX)
    expect(await balanceFor(db, { userId: worker.id })).toBe(COLUMN_MAX)
  })

  it('يرفض قرشًا واحدًا فوق الحد الأقصى للعمود', async () => {
    // Refused by the domain, in a language the UI can render. Without this the
    // first line of defence would be Postgres's "numeric field overflow",
    // raised inside a transaction that has already written half a close.
    const worker = await createUser(db)

    const error = await refusal(
      appendEntry(db, {
        userId: worker.id,
        type: 'EARNING',
        amount: ONE_OVER_COLUMN_MAX,
        note: 'قرش فوق الحد',
        actor: null,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    )

    expect(error.messageKey).toBe('ledger.errors.amountOutOfRange')
    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('يرفض الصفر لأن حركة لا تحرّك شيئًا ليست حركة', async () => {
    // SPEC §4: "Zero-amount entries are refused." A 0.00 row would be a line on
    // the statement that explains nothing and still has to be explained.
    const worker = await createUser(db)

    const error = await refusal(
      appendEntry(db, {
        userId: worker.id,
        type: 'ADJUSTMENT',
        amount: '0.00',
        note: 'تسوية بلا مقدار',
        actor: null,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    )

    expect(error.messageKey).toBe('ledger.errors.amountZero')
    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('يبلّغ عن الكسر العشري قبل الإشارة حين يخطئ القيد في الاثنين', async () => {
    // A PENALTY typed as +0.005 is wrong twice. Reporting "wrong direction"
    // first sends the developer to negate it and hit a second, unrelated
    // refusal — so `sign.ts` checks range and scale before sign, and this is
    // what stops that order from being reshuffled as a tidy-up.
    const worker = await createUser(db)

    const error = await refusal(
      appendEntry(db, {
        userId: worker.id,
        type: 'PENALTY',
        amount: HALF_PIASTRE,
        note: 'خصم بنصف قرش موجب',
        actor: null,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    )

    expect(error.messageKey).toBe('ledger.errors.amountScale')
  })
})

describe('modules/ledger — الجمع بدقة عشرية لا عائمة', () => {
  it('سلسلة طويلة من القروش تساوي رقمًا بعينه لا تقريبًا له', async () => {
    // `markPayoutPaid` decides PAID with `gte(paidAmount, net)`. Were either
    // side a float, a payout settled in many small payments would land a
    // ten-trillionth short of its net and stay outstanding forever, for money
    // that was paid in full.
    const worker = await createUser(db)
    const amounts = Array.from({ length: 700 }, () => '0.07')

    // `createMany` deliberately: this is an assertion about SUM over many rows,
    // and 700 audit rows would turn it into an assertion about insert speed.
    await db.ledgerEntry.createMany({
      data: amounts.map((amount, index) => ({
        userId: worker.id,
        type: 'EARNING' as const,
        amount,
        note: `حركة ${index}`,
      })),
    })

    const balance = await balanceFor(db, { userId: worker.id })

    expect(balance).toBe('49.00')
    expect(balance).toBe(toStorageString(moneySum(amounts)))
    // The same chain added as `number`, for contrast: it is not this figure,
    // and no amount of formatting makes it equal to it.
    const naiveFloatTotal = amounts.reduce((acc, value) => acc + Number(value), 0)
    expect(naiveFloatTotal).not.toBe(Number(balance))
  })

  it('يرفض قيمة غير مقرَّبة بدل أن يقرّبها نيابة عن المتصل', async () => {
    // 1000 ÷ 3 has no 2dp form. Whoever splits a task value three ways has to
    // decide where the stray piastre goes; the ledger refusing to decide for
    // them is what keeps the three lines addable by hand.
    const worker = await createUser(db)

    const error = await refusal(
      appendEntry(db, {
        userId: worker.id,
        type: 'EARNING',
        amount: div(1000, 3),
        note: 'ثلث القيمة',
        actor: null,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    )

    expect(error.messageKey).toBe('ledger.errors.amountScale')
    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('التقريب يحدث مرة واحدة عند الكتابة — ثلاثة أثلاث تساوي 999.99 لا 1000.00', async () => {
    // Round-then-sum and sum-then-round disagree by exactly one piastre here.
    // The ledger must produce the first: rounding a second time on the way out
    // would print a total that none of its own lines add up to, which is the
    // one thing a statement may never do.
    const worker = await createUser(db)
    const third = toStorageString(div(1000, 3))

    for (const note of ['الثلث الأول', 'الثلث الثاني', 'الثلث الثالث']) {
      await appendEntry(db, {
        userId: worker.id,
        type: 'EARNING',
        amount: third,
        note,
        actor: null,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      })
    }

    expect(third).toBe('333.33')
    expect(await balanceFor(db, { userId: worker.id })).toBe('999.99')
    // The other answer, computed the other way round, for the contrast: summing
    // the exact thirds and rounding once at the end says 1000.00.
    expect(toStorageString(moneySum([div(1000, 3), div(1000, 3), div(1000, 3)]))).toBe(
      '1000.00',
    )
  })
})

describe('modules/payout — مستحق قدره قرش واحد', () => {
  it('يُصرف بدفعة واحدة قدرها قرش ويُطفئ الرصيد', async () => {
    const { actor, worker, payout, cycleId } = await approvedPayoutOf(PIASTRE)

    const paid = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: PIASTRE,
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    expect(paid.net).toBe('0.01')
    expect(paid.status).toBe('PAID')
    expect(paid.outstanding).toBe('0.00')

    const entry = await db.ledgerEntry.findFirstOrThrow({
      where: { userId: worker.id, cycleId, type: 'PAYOUT' },
    })
    expect(entry.amount.toFixed(2)).toBe('-0.01')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('يرفض دفعة صفرية بينما ما زال القرش مستحقًا', async () => {
    // A zero payment against an outstanding balance moves nothing and yet
    // stamps `paidAt` and writes an audit row that reads like a payment. The
    // zero payment is only meaningful when there is genuinely nothing to pay.
    const { actor, payout } = await approvedPayoutOf(PIASTRE)

    const error = await refusal(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '0.00',
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
    )

    expect(error.messageKey).toBe('payout.errors.amountRequired')
    expect(await db.ledgerEntry.count({ where: { type: 'PAYOUT' } })).toBe(0)
  })

  it('يرفض دفعة أخرى ولو صفرية بعد صرف القرش', async () => {
    // The brief asks for "0.01 then 0.00". The second call is refused, and that
    // is the correct answer: a payout that has reached PAID is finished, and a
    // trailing zero payment would move `paidAt` to a day nothing happened.
    const { actor, payout } = await approvedPayoutOf(PIASTRE)
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: PIASTRE,
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    const error = await refusal(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '0.00',
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: SECOND_PAY_AT,
      }),
    )

    expect(error.messageKey).toBe('payout.errors.alreadyPaid')
    expect(await db.ledgerEntry.count({ where: { type: 'PAYOUT' } })).toBe(1)
  })

  it('يرفض دفعة بأقل من قرش', async () => {
    // The payment path needs its own scale guard: if it rounded, `paidAmount`
    // and the `PAYOUT` entry it writes would disagree, and SPEC §5.5's
    // "SUM(PAYOUT entries) = −paidAmount" would stop being checkable.
    const { actor, payout } = await approvedPayoutOf('800.00')

    const error = await refusal(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: HALF_PIASTRE,
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
    )

    expect(error.messageKey).toBe('ledger.errors.amountScale')
    expect(await db.ledgerEntry.count({ where: { type: 'PAYOUT' } })).toBe(0)
  })
})

describe('modules/payout — الصرف الجزئي بقروش لا تنقسم', () => {
  it('ثلاث دفعات 333.33 و333.33 و333.34 تُغلق الألف بالضبط', async () => {
    // A thousand split three ways is the smallest real case where "pay the rest
    // next week" has to survive a remainder. If the outstanding were recomputed
    // from a per-period net rather than from the balance, the third payment
    // would be refused as exceeding it by a piastre.
    const { actor, worker, payout } = await approvedPayoutOf('1000.00')

    const first = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '333.33',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })
    expect(first.status).toBe('APPROVED')
    expect(first.outstanding).toBe('666.67')
    expect(await balanceFor(db, { userId: worker.id })).toBe('666.67')

    const second = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '333.33',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: SECOND_PAY_AT,
    })
    expect(second.status).toBe('APPROVED')
    expect(second.outstanding).toBe('333.34')
    expect(await balanceFor(db, { userId: worker.id })).toBe('333.34')

    const third = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '333.34',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: THIRD_PAY_AT,
    })
    expect(third.status).toBe('PAID')
    expect(third.paidAmount).toBe('1000.00')
    expect(third.outstanding).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('مجموع قيود الصرف يساوي المدفوع بالضبط بعد كل دفعة', async () => {
    // SPEC §5.5 states this as an invariant, not as a consequence: the payout
    // row is a working document and the ledger is the permanent record, so the
    // moment the two disagree the permanent one is the only one worth reading.
    const { actor, worker, payout, cycleId } = await approvedPayoutOf('1000.00')

    const payments = [
      { amount: '333.33', now: PAY_AT },
      { amount: '333.33', now: SECOND_PAY_AT },
      { amount: '333.34', now: THIRD_PAY_AT },
    ]

    for (const payment of payments) {
      await markPayoutPaid(db, {
        payoutId: payout.id,
        amount: payment.amount,
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: payment.now,
      })

      const paidOut = await db.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { userId: worker.id, cycleId, type: 'PAYOUT' },
      })
      const row = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })

      expect(paidOut._sum.amount?.toFixed(2)).toBe(`-${row.paidAmount.toFixed(2)}`)
    }

    const entries = await db.ledgerEntry.findMany({
      where: { userId: worker.id, cycleId, type: 'PAYOUT' },
      orderBy: { createdAt: 'asc' },
    })
    expect(entries.map((entry) => entry.amount.toFixed(2))).toEqual([
      '-333.33',
      '-333.33',
      '-333.34',
    ])
  })
})

describe('modules/payout — الخصم يساوي الاستحقاق أو يزيد قرشًا', () => {
  it('خصم يساوي الاستحقاق تمامًا يعطي صافيًا 0.00 موجبًا لا 0.00-', async () => {
    // A zero that arrives by negation rather than by arithmetic prints as
    // `-0.00`, and a منفّذ reading "‑0.00 مستحق" has been told something that
    // is not a number. `clampAtZero` must return a positive zero, and so must
    // the `net − paidAmount` the DTO derives on read.
    const { actor, worker } = await actorAndWorker()
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '1234.56',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-1234.56',
    })

    const closed = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    const row = await payoutFor(worker.id, closed.cycleId!)
    const dto = await getPayout(db, row.id)

    expect(dto.net).toBe('0.00')
    expect(dto.outstanding).toBe('0.00')
    expect(dto.carriedForward).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
    // The breakdown still says what happened, at full magnitude.
    expect(dto.gross).toBe('1234.56')
    expect(dto.penalties).toBe('1234.56')
  })

  it('الدورة التالية تُرحّل 0.00 لا 0.00-', async () => {
    const { actor, worker } = await actorAndWorker()
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '1234.56',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-1234.56',
    })
    await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })

    await createLedgerEntry(db, {
      createdAt: IN_SEPTEMBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '10.00',
    })
    const september = await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })
    const dto = await getPayout(db, (await payoutFor(worker.id, september.cycleId!)).id)

    // `carriedForward = balance − periodMovement`, and here the two are equal
    // and non-zero. A subtraction that returns a signed zero would put `-0.00`
    // at the top of the statement.
    expect(dto.carriedForward).toBe('0.00')
    expect(dto.net).toBe('10.00')
  })

  it('تجاوز الخصم بقرش واحد يُصفّر المستحق ويُرحّل 0.01- إلى الدورة التالية', async () => {
    // One piastre is the smallest debt the system can carry, and the one most
    // likely to be rounded away by a "tidy" carry-forward. Losing it here would
    // mean the agency writes off every sub-piastre debt silently — and the
    // opposite mistake, keeping it as a payout, would pay a negative.
    const { actor, worker } = await actorAndWorker()
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '1000.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-1000.01',
    })

    const august = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    const first = await payoutFor(worker.id, august.cycleId!)
    expect(first.net.toFixed(2)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-0.01')

    // No movement at all in September: the debt alone is enough to keep the
    // منفّذ on the list, which is what stops a one-piastre debit disappearing
    // in the first quiet month.
    const september = await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })
    const second = await payoutFor(worker.id, september.cycleId!)

    expect(second.carriedForward.toFixed(2)).toBe('-0.01')
    expect(second.gross.toFixed(2)).toBe('0.00')
    expect(second.net.toFixed(2)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-0.01')
  })
})

describe('modules/payout — سلفة تُسدَّد على أربع دورات بقروش غير مستديرة', () => {
  it('الرصيد بعد كل دورة يساوي المتبقي من السلفة بالضبط', async () => {
    // carry-forward.test.ts settles a round advance in round instalments. The
    // amounts here never divide evenly, so any implementation that reconstructs
    // the outstanding advance instead of reading the balance drifts a piastre
    // per cycle — and the drift only shows up on the last one, where the debt
    // is meant to land on exactly 0.01 before it clears.
    const { actor, worker } = await actorAndWorker()

    await recordAdvance(db, {
      userId: worker.id,
      amount: '2500.75',
      note: 'سلفة قبل العيد',
      actor,
      cycleDay: CYCLE_DAY,
      at: cairo('2026-08-05T10:00'),
    })

    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '700.30',
    })
    const august = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    const first = await payoutFor(worker.id, august.cycleId!)
    expect(first.advances.toFixed(2)).toBe('2500.75')
    expect(first.net.toFixed(2)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-1800.45')

    await createLedgerEntry(db, {
      createdAt: IN_SEPTEMBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '900.15',
    })
    const september = await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })
    const second = await payoutFor(worker.id, september.cycleId!)
    expect(second.carriedForward.toFixed(2)).toBe('-1800.45')
    expect(second.net.toFixed(2)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-900.30')

    await createLedgerEntry(db, {
      createdAt: IN_OCTOBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '900.29',
    })
    const october = await closeCycle(db, { actor, now: OCTOBER, cycleDay: CYCLE_DAY })
    const third = await payoutFor(worker.id, october.cycleId!)
    expect(third.carriedForward.toFixed(2)).toBe('-900.30')
    expect(third.net.toFixed(2)).toBe('0.00')
    // One piastre still owed — not zero, and not rounded to zero.
    expect(await balanceFor(db, { userId: worker.id })).toBe('-0.01')

    await createLedgerEntry(db, {
      createdAt: IN_NOVEMBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '500.00',
    })
    const november = await closeCycle(db, { actor, now: NOVEMBER, cycleDay: CYCLE_DAY })
    const fourth = await payoutFor(worker.id, november.cycleId!)
    expect(fourth.carriedForward.toFixed(2)).toBe('-0.01')
    expect(fourth.net.toFixed(2)).toBe('499.99')
    expect(await balanceFor(db, { userId: worker.id })).toBe('499.99')
  })
})

describe('modules/payout — أقصى مبلغ يمر عبر السلسلة كاملة', () => {
  it('مستحق بحد العمود الأقصى يُصرف كاملًا دون بتر', async () => {
    // Entry → balance → net → payment → PAYOUT entry → balance. Every hop is a
    // `Decimal(12,2)` column or a `lib/money` round, and a single narrowing
    // anywhere along it truncates the largest number the system can hold.
    const { actor, worker, payout, cycleId } = await approvedPayoutOf(COLUMN_MAX)

    expect(payout.net.toFixed(2)).toBe(COLUMN_MAX)

    const paid = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: COLUMN_MAX,
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    expect(paid.status).toBe('PAID')
    expect(paid.paidAmount).toBe(COLUMN_MAX)
    expect(paid.outstanding).toBe('0.00')

    const entry = await db.ledgerEntry.findFirstOrThrow({
      where: { userId: worker.id, cycleId, type: 'PAYOUT' },
    })
    expect(entry.amount.toFixed(2)).toBe(`-${COLUMN_MAX}`)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})
