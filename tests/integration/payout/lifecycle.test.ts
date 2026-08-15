import { describe, expect, it } from 'vitest'

import { ConflictError, DomainError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { balanceFor } from '@/modules/ledger/service'
import { approvePayout, closeCycle, markPayoutPaid } from '@/modules/payout/service'

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

const CLOSE_AT = cairo('2026-08-28T23:59')
const PAY_AT = cairo('2026-08-29T11:00')
const SECOND_PAY_AT = cairo('2026-09-05T11:00')

/** See the note in close.test.ts: entries are stamped into the cycle they belong to. */
const IN_AUGUST = cairo('2026-08-10T09:00')
const IN_SEPTEMBER = cairo('2026-09-10T09:00')

/**
 * SPEC §5.5: "`DRAFT → APPROVED` requires `payout.approve`. `APPROVED → PAID`
 * records method, reference, date, and supports **partial payment** (remainder
 * stays outstanding)."
 *
 * "Remainder stays outstanding" is not a column here. Each payment appends a
 * negative `PAYOUT` entry, so whatever was not paid is still in the balance and
 * turns up in the next cycle by itself.
 */
async function drafted(net = '800.00') {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, [
    'payout.generate',
    'payout.approve',
    'payout.markPaid',
  ])
  const actor = await actorFor(db, admin.id)
  const worker = await createUser(db)
  await createLedgerEntry(db, {
    createdAt: IN_AUGUST,
    userId: worker.id,
    type: 'EARNING',
    amount: net,
  })

  const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
  const payout = await db.payout.findFirstOrThrow({ where: { userId: worker.id } })
  return { actor, worker, payout, cycleId: result.cycleId! }
}

describe('modules/payout — دورة حياة المستحق', () => {
  it('مسودة ← معتمد ← مصروف', async () => {
    const { actor, payout } = await drafted()
    expect(payout.status).toBe('DRAFT')

    const approved = await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    expect(approved.status).toBe('APPROVED')
    expect(approved.approvedAt).not.toBeNull()

    const paid = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '800.00',
      method: METHODS[0]!,
      reference: 'INS-99120',
      note: 'صرف كامل',
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    expect(paid.status).toBe('PAID')
    expect(paid.paidAmount).toBe('800.00')
    expect(paid.outstanding).toBe('0.00')
    expect(paid.method).toBe(METHODS[0])
    expect(paid.reference).toBe('INS-99120')
  })

  it('الصرف يكتب قيدًا سالبًا يُطفئ الرصيد', async () => {
    const { actor, worker, payout, cycleId } = await drafted()
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '800.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    const entry = await db.ledgerEntry.findFirstOrThrow({ where: { type: 'PAYOUT' } })
    expect(entry.amount.toFixed(2)).toBe('-800.00')
    expect(entry.userId).toBe(worker.id)
    // Attributed to the cycle it settles, so that cycle's statement shows it
    // was paid rather than the next one showing a mystery deduction.
    expect(entry.cycleId).toBe(cycleId)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('لا يعتمد مستحقًا معتمدًا مرتين', async () => {
    const { actor, payout } = await drafted()
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    await expect(
      approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('لا يصرف مستحقًا لم يُعتمد', async () => {
    const { actor, payout } = await drafted()
    await expect(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '800.00',
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(await db.ledgerEntry.count({ where: { type: 'PAYOUT' } })).toBe(0)
  })

  it('يسجّل من اعتمد ومن صرف ومتى', async () => {
    const { actor, payout } = await drafted()
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '800.00',
      method: METHODS[1]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    const row = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })
    expect(row.approvedById).toBe(actor.id)
    expect(row.paidById).toBe(actor.id)
    expect(row.approvedAt).toEqual(PAY_AT)
    expect(row.paidAt).toEqual(PAY_AT)
  })

  it('يكتب سطر تدقيق لكل تغيّر حالة', async () => {
    const { actor, payout } = await drafted()
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '800.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    const actions = (
      await db.auditLog.findMany({
        where: { entity: 'Payout' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((r) => r.action)

    expect(actions).toContain('payout.drafted')
    expect(actions).toContain('payout.approved')
    expect(actions).toContain('payout.paid')
  })

  it('الدورة تصبح مصروفة حين يُصرف كل مستحقاتها', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, [
      'payout.generate',
      'payout.approve',
      'payout.markPaid',
    ])
    const actor = await actorFor(db, admin.id)
    const [a, b] = [await createUser(db), await createUser(db)]
    await createLedgerEntry(db, { createdAt: IN_AUGUST, userId: a.id, amount: '500.00' })
    await createLedgerEntry(db, { createdAt: IN_AUGUST, userId: b.id, amount: '700.00' })

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    const payouts = await db.payout.findMany({ where: { cycleId: result.cycleId! } })

    for (const [index, payout] of payouts.entries()) {
      await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
      await markPayoutPaid(db, {
        payoutId: payout.id,
        amount: payout.net.toFixed(2),
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      })

      const cycle = await db.payoutCycle.findUniqueOrThrow({
        where: { id: result.cycleId! },
      })
      // Still CLOSED while one payout is outstanding; PAID only at the end.
      expect(cycle.status).toBe(index === payouts.length - 1 ? 'PAID' : 'CLOSED')
    }
  })
})

describe('modules/payout — الصرف الجزئي', () => {
  it('دفعتان متتاليتان تُحسبان بالضبط', async () => {
    // Phase brief, test 5.
    const { actor, worker, payout } = await drafted('800.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

    const first = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '500.00',
      method: METHODS[0]!,
      reference: 'INS-1',
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    expect(first.status).toBe('APPROVED')
    expect(first.paidAmount).toBe('500.00')
    expect(first.outstanding).toBe('300.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('300.00')

    const second = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '300.00',
      method: METHODS[1]!,
      reference: 'INS-2',
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: SECOND_PAY_AT,
    })

    expect(second.status).toBe('PAID')
    expect(second.paidAmount).toBe('800.00')
    expect(second.outstanding).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')

    // Two payments, two ledger rows — the payout row keeps the running total,
    // the ledger keeps the history.
    const entries = await db.ledgerEntry.findMany({
      where: { type: 'PAYOUT' },
      orderBy: { createdAt: 'asc' },
    })
    expect(entries.map((e) => e.amount.toFixed(2))).toEqual(['-500.00', '-300.00'])
    // The last method wins on the row; both survive on the entries' notes.
    expect(second.method).toBe(METHODS[1])
  })

  it('الباقي يبقى على مستحق شهره ولا تطالب به الدورة التالية مرة أخرى', async () => {
    // SPEC §5.5's "remainder stays outstanding" means it stays outstanding **on
    // the payout that owns it** — not that the next cycle claims it a second
    // time. The distinction is the whole difference between a remainder and a
    // duplicate: the balance still holds the 300, so a next cycle that simply
    // read the balance would draft 1300 while August's row still claimed 300,
    // and the two screens would together promise 1600 against 1300 earned.
    const { actor, worker, payout } = await drafted('800.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '500.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    await createLedgerEntry(db, {
      createdAt: IN_SEPTEMBER,
      userId: worker.id,
      type: 'EARNING',
      amount: '1000.00',
    })
    const september = await closeCycle(db, {
      actor,
      now: cairo('2026-09-28T23:59'),
      cycleDay: CYCLE_DAY,
    })
    const next = await db.payout.findFirstOrThrow({
      where: { userId: worker.id, cycleId: september.cycleId! },
    })

    // Nothing carried that August's statement is not already showing.
    expect(next.carriedForward.toFixed(2)).toBe('0.00')
    expect(next.gross.toFixed(2)).toBe('1000.00')
    expect(next.net.toFixed(2)).toBe('1000.00')

    // August's remainder is exactly where the منفّذ was told it would be.
    const august = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })
    expect(august.status).toBe('APPROVED')
    expect(august.net.minus(august.paidAmount).toFixed(2)).toBe('300.00')

    // The invariant that makes both of the above safe: what every outstanding
    // payout claims never adds up to more than the منفّذ actually has.
    const outstanding = (
      await db.payout.findMany({ where: { userId: worker.id } })
    ).reduce((total, row) => total + Number(row.net) - Number(row.paidAmount), 0)
    expect(outstanding.toFixed(2)).toBe(await balanceFor(db, { userId: worker.id }))
    expect(outstanding.toFixed(2)).toBe('1300.00')
  })

  it('يمكن صرف مستحق معتمد حتى لو نزل خصم بعده', async () => {
    // SPEC §5.4: a deduction that overshoots carries to the *next* cycle as a
    // debit balance. It does not retroactively shrink a figure a manager has
    // already approved — and Phase 8's engine records penalties after a close
    // as a matter of routine, so a guard that read the live balance here would
    // make ordinary approved payouts unpayable.
    const { actor, worker, payout } = await drafted('1000.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

    await createLedgerEntry(db, {
      createdAt: IN_SEPTEMBER,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-200.00',
    })

    const paid = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '1000.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: cairo('2026-09-02T11:00'),
    })

    expect(paid.status).toBe('PAID')
    expect(paid.paidAmount).toBe('1000.00')
    // The خصم is not lost — it is a debit balance, and the next cycle collects it.
    expect(await balanceFor(db, { userId: worker.id })).toBe('-200.00')
  })

  it('يرفض دفعة تتجاوز المتبقي', async () => {
    const { actor, payout } = await drafted('800.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

    await expect(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '900.00',
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
    ).rejects.toBeInstanceOf(DomainError)

    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '500.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })
    await expect(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '300.01',
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: SECOND_PAY_AT,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض دفعة سالبة', async () => {
    const { actor, payout } = await drafted('800.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

    await expect(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '-100.00',
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض الصرف بعد اكتمال الدفع', async () => {
    const { actor, payout } = await drafted('800.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '800.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    await expect(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '1.00',
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: SECOND_PAY_AT,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('مجموع قيود الصرف يساوي المدفوع على المستحق', async () => {
    const { actor, worker, payout, cycleId } = await drafted('800.00')
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '250.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '125.50',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: SECOND_PAY_AT,
    })

    const sum = await db.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { userId: worker.id, cycleId, type: 'PAYOUT' },
    })
    const row = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })

    expect(sum._sum.amount?.toFixed(2)).toBe(`-${row.paidAmount.toFixed(2)}`)
    expect(row.paidAmount.toFixed(2)).toBe('375.50')
  })
})

describe('modules/payout — طريقة الصرف', () => {
  it('تُقبل فقط من قائمة الإعدادات', async () => {
    const { actor, payout } = await drafted()
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

    await expect(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '800.00',
        method: 'شيك مؤجل',
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: PAY_AT,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('تُحفظ كنسخة نصية لا كمرجع', async () => {
    // SPEC §7 keeps `payout.paymentMethods` a plain list of Arabic strings
    // because "nothing stores a reference to it". A payment record must keep
    // saying "فودافون كاش" even after the operator renames the entry.
    const { actor, payout } = await drafted()
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '800.00',
      method: METHODS[1]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })

    const row = await db.payout.findUniqueOrThrow({ where: { id: payout.id } })
    expect(row.method).toBe(METHODS[1])
    expect(typeof row.method).toBe('string')
  })

  it('لا تُشترط طريقة لصرف صفري', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, [
      'payout.generate',
      'payout.approve',
      'payout.markPaid',
    ])
    const actor = await actorFor(db, admin.id)
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-100.00',
    })

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    const payout = await db.payout.findFirstOrThrow({
      where: { cycleId: result.cycleId! },
    })
    await approvePayout(db, { payoutId: payout.id, actor, now: PAY_AT })

    const paid = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '0.00',
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: PAY_AT,
    })
    expect(paid.status).toBe('PAID')
  })
})
