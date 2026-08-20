import { describe, expect, it } from 'vitest'

import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { recordAdvance } from '@/modules/ledger/service'
import { balanceFor } from '@/modules/ledger/service'
import { closeCycle, markPayoutPaid, approvePayout } from '@/modules/payout/service'

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

const AUGUST = cairo('2026-08-28T23:59')
const SEPTEMBER = cairo('2026-09-28T23:59')
const OCTOBER = cairo('2026-10-28T23:59')
const NOVEMBER = cairo('2026-11-28T23:59')

/** See the note in close.test.ts: entries are stamped into the cycle they belong to. */
const IN_AUGUST = cairo('2026-08-10T09:00')
const IN_SEPTEMBER = cairo('2026-09-10T09:00')
const IN_OCTOBER = cairo('2026-10-10T09:00')
const IN_NOVEMBER = cairo('2026-11-10T09:00')

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
 * SPEC §5.4: "A payout may reach zero but **never goes negative** — surplus
 * deduction carries to the next cycle as a debit balance."
 *
 * The phase brief asks for this explicitly, twice ("Deductions exceeding
 * earnings → payout is 0, carry-forward is exact", "Advance larger than the
 * cycle → carries correctly"), and it is the single place where a design that
 * stored a per-cycle net instead of a balance would quietly lose money.
 */
describe('modules/payout — الخصومات تتجاوز الاستحقاقات', () => {
  it('المستحق يساوي صفرًا لا سالبًا', async () => {
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
      amount: '-1500.00',
    })

    const result = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    const payout = await payoutFor(worker.id, result.cycleId!)

    expect(payout.net.toFixed(2)).toBe('0.00')
    // The breakdown still tells the truth about what happened.
    expect(payout.gross.toFixed(2)).toBe('1000.00')
    expect(payout.penalties.toFixed(2)).toBe('1500.00')
    // And the debt is not lost — it is simply the balance.
    expect(await balanceFor(db, { userId: worker.id })).toBe('-500.00')
  })

  it('الفائض يُرحَّل بالضبط إلى الدورة التالية', async () => {
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
      amount: '-1500.00',
    })
    await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })

    await createLedgerEntry(db, {
      createdAt: IN_SEPTEMBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '2000.00',
    })
    const september = await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })
    const payout = await payoutFor(worker.id, september.cycleId!)

    expect(payout.carriedForward.toFixed(2)).toBe('-500.00')
    expect(payout.gross.toFixed(2)).toBe('2000.00')
    expect(payout.net.toFixed(2)).toBe('1500.00')
  })

  it('الرقم يقفل حسابيًا: مرحّل + إجمالي − خصم + مكافأة − سلفة + تسوية', async () => {
    const { actor, worker } = await actorAndWorker()
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-800.00',
    })
    await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })

    const september = { createdAt: IN_SEPTEMBER, userId: worker.id } as const
    await createLedgerEntry(db, { ...september, type: 'EARNING', amount: '5000.00' })
    await createLedgerEntry(db, { ...september, type: 'PENALTY', amount: '-300.00' })
    await createLedgerEntry(db, { ...september, type: 'BONUS', amount: '250.00' })
    await createLedgerEntry(db, { ...september, type: 'ADVANCE', amount: '-1000.00' })
    await createLedgerEntry(db, { ...september, type: 'ADJUSTMENT', amount: '-75.50' })

    const closed = await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })
    const p = await payoutFor(worker.id, closed.cycleId!)

    const expected =
      Number(p.carriedForward) +
      Number(p.gross) -
      Number(p.penalties) +
      Number(p.bonuses) -
      Number(p.advances) +
      Number(p.adjustments)

    expect(Number(p.net)).toBe(Math.max(0, expected))
    expect(p.net.toFixed(2)).toBe('3074.50')
  })

  it('لا يُصرف شيء لمن صافيه صفر، والدين يظل ظاهرًا في الدورة التالية', async () => {
    const { actor, worker } = await actorAndWorker()
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-500.00',
    })

    const august = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    const payout = await payoutFor(worker.id, august.cycleId!)
    expect(payout.net.toFixed(2)).toBe('0.00')

    // Nothing moves when a zero payout is settled — a PAYOUT entry of zero
    // would be a movement that moved nothing.
    await approvePayout(db, { payoutId: payout.id, actor, now: AUGUST })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '0.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: AUGUST,
    })

    expect(await db.ledgerEntry.count({ where: { type: 'PAYOUT' } })).toBe(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe('-500.00')

    const september = await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })
    expect(
      (await payoutFor(worker.id, september.cycleId!)).carriedForward.toFixed(2),
    ).toBe('-500.00')
  })
})

describe('modules/payout — لا مطالبتان بنفس المال', () => {
  it('مستحق معتمد لم يُصرف لا تطالب به الدورة التالية من جديد', async () => {
    // The most ordinary way two payouts end up claiming one balance: August is
    // drafted and approved, finance is away, September closes. The money is
    // still in the balance, so a close that only read the balance would draft
    // it again — and both screens would then say the organization owes 2000 when it
    // owes 1000.
    const { actor, worker } = await actorAndWorker()
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '1000.00',
    })

    const august = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    const first = await payoutFor(worker.id, august.cycleId!)
    await approvePayout(db, { payoutId: first.id, actor, now: cairo('2026-08-29T10:00') })

    const september = await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })
    const second = await payoutFor(worker.id, september.cycleId!)

    expect(second.net.toFixed(2)).toBe('0.00')
    expect(second.carriedForward.toFixed(2)).toBe('0.00')
    // August's payout is untouched and still fully payable.
    expect(
      (await db.payout.findUniqueOrThrow({ where: { id: first.id } })).net.toFixed(2),
    ).toBe('1000.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('1000.00')
  })

  it('المستحق القديم يظل قابلًا للصرف بعد إغلاق الدورة التالية', async () => {
    // The counterpart of the test above, and the reason the fix is at the draft
    // side: a stale claim that made an approved payout unpayable would strand a
    // منفّذ's money in a row nobody can settle.
    const { actor, worker } = await actorAndWorker()
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '1000.00',
    })

    const august = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    const first = await payoutFor(worker.id, august.cycleId!)
    await approvePayout(db, { payoutId: first.id, actor, now: cairo('2026-08-29T10:00') })
    await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })

    const paid = await markPayoutPaid(db, {
      payoutId: first.id,
      amount: '1000.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: cairo('2026-09-29T10:00'),
    })

    expect(paid.status).toBe('PAID')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})

describe('modules/payout — سلفة أكبر من الدورة', () => {
  it('تُخصم تلقائيًا عبر الدورات حتى تُسدَّد، بلا كود خاص', async () => {
    // Phase brief item 5: "They settle automatically at month-end because
    // balance is a sum — do not write special-case deduction code." This test
    // is what proves no such code exists: nothing anywhere subtracts an
    // outstanding advance, and yet it settles.
    const { actor, worker } = await actorAndWorker()

    await recordAdvance(db, {
      userId: worker.id,
      amount: '3000.00',
      note: 'سلفة قبل العيد',
      actor,
      cycleDay: CYCLE_DAY,
      at: cairo('2026-08-05T10:00'),
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '1000.00',
    })

    const august = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    const first = await payoutFor(worker.id, august.cycleId!)
    expect(first.advances.toFixed(2)).toBe('3000.00')
    expect(first.net.toFixed(2)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-2000.00')

    await createLedgerEntry(db, {
      createdAt: IN_SEPTEMBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '1000.00',
    })
    const september = await closeCycle(db, { actor, now: SEPTEMBER, cycleDay: CYCLE_DAY })
    const second = await payoutFor(worker.id, september.cycleId!)
    expect(second.carriedForward.toFixed(2)).toBe('-2000.00')
    expect(second.net.toFixed(2)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-1000.00')

    await createLedgerEntry(db, {
      createdAt: IN_OCTOBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '1000.00',
    })
    const october = await closeCycle(db, { actor, now: OCTOBER, cycleDay: CYCLE_DAY })
    const third = await payoutFor(worker.id, october.cycleId!)
    expect(third.net.toFixed(2)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')

    // Cleared exactly — the fourth month pays in full and not a piastre less.
    await createLedgerEntry(db, {
      createdAt: IN_NOVEMBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '1000.00',
    })
    const november = await closeCycle(db, { actor, now: NOVEMBER, cycleDay: CYCLE_DAY })
    const fourth = await payoutFor(worker.id, november.cycleId!)
    expect(fourth.carriedForward.toFixed(2)).toBe('0.00')
    expect(fourth.net.toFixed(2)).toBe('1000.00')
  })

  it('السلفة تُسجَّل كقيد سالب مهما أُدخلت موجبة', async () => {
    const { actor, worker } = await actorAndWorker()

    const entry = await recordAdvance(db, {
      userId: worker.id,
      amount: '2500.00',
      note: 'سلفة',
      actor,
      cycleDay: CYCLE_DAY,
      at: cairo('2026-08-05T10:00'),
    })

    expect(entry.type).toBe('ADVANCE')
    expect(entry.amount).toBe('-2500.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-2500.00')
  })

  it('سلفة تتجاوز رصيدًا سالبًا أصلًا تتراكم ولا تُدوَّر', async () => {
    const { actor, worker } = await actorAndWorker()
    await recordAdvance(db, {
      userId: worker.id,
      amount: '1000.00',
      note: 'سلفة أولى',
      actor,
      cycleDay: CYCLE_DAY,
      at: cairo('2026-08-05T10:00'),
    })
    await recordAdvance(db, {
      userId: worker.id,
      amount: '500.00',
      note: 'سلفة ثانية',
      actor,
      cycleDay: CYCLE_DAY,
      at: cairo('2026-08-06T10:00'),
    })

    expect(await balanceFor(db, { userId: worker.id })).toBe('-1500.00')
    const august = await closeCycle(db, { actor, now: AUGUST, cycleDay: CYCLE_DAY })
    expect((await payoutFor(worker.id, august.cycleId!)).advances.toFixed(2)).toBe(
      '1500.00',
    )
  })
})
