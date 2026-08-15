import { describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db'
import { Decimal, sum as moneySum, toStorageString } from '@/lib/money'
import { balanceFor, balancesFor } from '@/modules/ledger/service'

import { createLedgerEntry, createUser } from '../../factories/db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * Phase brief, test 1: "Balance = sum, across thousands of entries, with
 * correct 2dp rounding."
 *
 * SPEC §4: "Balance is always `SUM(amount)`. There is no mutable balance column
 * anywhere." These tests are what stops the first performance-minded reader
 * from adding one.
 */

/**
 * Amounts chosen to exercise the arithmetic rather than to look tidy: cents
 * that do not sum to a round figure, both signs, and magnitudes three orders of
 * magnitude apart in the same total.
 */
function amountFor(index: number): string {
  const cycle = index % 7
  if (cycle === 0) return '1234.56'
  if (cycle === 1) return '0.07'
  if (cycle === 2) return '-99.99'
  if (cycle === 3) return '4999.95'
  if (cycle === 4) return '-1250.33'
  if (cycle === 5) return '0.01'
  return '-0.02'
}

const ENTRY_COUNT = 3_000

async function seedEntries(userId: string, count: number): Promise<string[]> {
  const amounts = Array.from({ length: count }, (_, i) => amountFor(i))
  await db.ledgerEntry.createMany({
    data: amounts.map((amount, i) => ({
      userId,
      type: amount.startsWith('-') ? ('PENALTY' as const) : ('EARNING' as const),
      amount,
      note: `حركة ${i}`,
    })),
  })
  return amounts
}

describe('modules/ledger — الرصيد مجموع، لا عمود', () => {
  it('يساوي مجموع آلاف القيود بدقة خانتين', async () => {
    const user = await createUser(db)
    const amounts = await seedEntries(user.id, ENTRY_COUNT)

    const expected = toStorageString(moneySum(amounts))
    const balance = await balanceFor(db, { userId: user.id })

    expect(balance).toBe(expected)
    // Two independent summations agreeing — the database's numeric SUM and
    // decimal.js in the test — is what makes this an assertion about
    // correctness rather than about the implementation agreeing with itself.
    expect(new Decimal(balance).equals(moneySum(amounts))).toBe(true)
  })

  it('يعيد دائمًا خانتين عشريتين', async () => {
    const user = await createUser(db)
    await seedEntries(user.id, 101)

    expect(await balanceFor(db, { userId: user.id })).toMatch(/^-?\d+\.\d{2}$/)
  })

  it('لا ينحرف كما ينحرف الجمع بالأرقام العشرية العائمة', async () => {
    const user = await createUser(db)
    // 0.1 + 0.2 !== 0.3 in binary floating point. Ten thousand of them is where
    // a `number`-based balance stops being merely inelegant and starts being
    // a number nobody can reproduce by hand.
    const amounts = Array.from({ length: 300 }, (_, i) =>
      i % 3 === 0 ? '0.10' : i % 3 === 1 ? '0.20' : '-0.30',
    )
    await db.ledgerEntry.createMany({
      data: amounts.map((amount, i) => ({
        userId: user.id,
        type: amount.startsWith('-') ? ('PENALTY' as const) : ('EARNING' as const),
        amount,
        note: `حركة ${i}`,
      })),
    })

    expect(await balanceFor(db, { userId: user.id })).toBe('0.00')
  })

  it('يُحسب في استعلام واحد', async () => {
    // The phase brief asks for exactly this: "computed in a single indexed
    // query". A per-entry read that happens to produce the right total would
    // pass every other test in this file.
    const user = await createUser(db)
    await seedEntries(user.id, 50)

    const aggregate = vi.fn(db.ledgerEntry.aggregate.bind(db.ledgerEntry))
    const spy = { ledgerEntry: { aggregate } } as unknown as Db

    await balanceFor(spy, { userId: user.id })
    expect(aggregate).toHaveBeenCalledTimes(1)
  })

  it('صفر لمستخدم بلا أي حركة — لا null ولا خطأ', async () => {
    const user = await createUser(db)
    expect(await balanceFor(db, { userId: user.id })).toBe('0.00')
  })

  it('صفر لمستخدم غير موجود أصلًا', async () => {
    expect(await balanceFor(db, { userId: 'ghost' })).toBe('0.00')
  })

  it('يفصل رصيد كل منفّذ عن الآخر', async () => {
    const [first, second] = [await createUser(db), await createUser(db)]
    await createLedgerEntry(db, { userId: first.id, amount: '500.00' })
    await createLedgerEntry(db, { userId: second.id, amount: '-200.00', type: 'PENALTY' })

    expect(await balanceFor(db, { userId: first.id })).toBe('500.00')
    expect(await balanceFor(db, { userId: second.id })).toBe('-200.00')
  })

  it('يكون سالبًا حين تتجاوز الخصومات الاستحقاقات', async () => {
    const user = await createUser(db)
    await createLedgerEntry(db, { userId: user.id, amount: '1000.00' })
    await createLedgerEntry(db, { userId: user.id, amount: '-1500.00', type: 'PENALTY' })

    // A *balance* may go negative; a payout may not (SPEC §5.4). Conflating the
    // two is how carry-forward debt disappears.
    expect(await balanceFor(db, { userId: user.id })).toBe('-500.00')
  })
})

describe('modules/ledger — الرصيد عند لحظة بعينها', () => {
  it('يستبعد ما كُتب بعد اللحظة المطلوبة', async () => {
    const user = await createUser(db)
    await createLedgerEntry(db, {
      userId: user.id,
      amount: '500.00',
      createdAt: cairo('2026-08-10T09:00'),
    })
    await createLedgerEntry(db, {
      userId: user.id,
      amount: '700.00',
      createdAt: cairo('2026-08-20T09:00'),
    })

    expect(await balanceFor(db, { userId: user.id, at: cairo('2026-08-15T00:00') })).toBe(
      '500.00',
    )
    expect(await balanceFor(db, { userId: user.id })).toBe('1200.00')
  })

  it('الحد الأعلى مفتوح — القيد المكتوب في نفس اللحظة لا يُحتسب', async () => {
    // Half-open `[…, at)`, the same convention lateness uses (SPEC §5.3). A
    // closed bound would count an entry written by the close itself.
    const user = await createUser(db)
    const at = cairo('2026-08-15T10:00')
    await createLedgerEntry(db, { userId: user.id, amount: '500.00', createdAt: at })

    expect(await balanceFor(db, { userId: user.id, at })).toBe('0.00')
    expect(
      await balanceFor(db, { userId: user.id, at: new Date(at.getTime() + 1) }),
    ).toBe('500.00')
  })
})

describe('modules/ledger — أرصدة مجموعة من المنفّذين', () => {
  it('يعيد رصيد كل واحد في استعلام واحد', async () => {
    const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)]
    await createLedgerEntry(db, { userId: a.id, amount: '500.00' })
    await createLedgerEntry(db, { userId: a.id, amount: '250.50' })
    await createLedgerEntry(db, { userId: b.id, amount: '-100.00', type: 'PENALTY' })

    const groupBy = vi.fn(db.ledgerEntry.groupBy.bind(db.ledgerEntry))
    const spy = { ledgerEntry: { groupBy } } as unknown as Db

    const balances = await balancesFor(spy, { userIds: [a.id, b.id, c.id] })

    expect(groupBy).toHaveBeenCalledTimes(1)
    expect(balances.get(a.id)).toBe('750.50')
    expect(balances.get(b.id)).toBe('-100.00')
    // Asked for, no entries: present and zero, rather than absent. A caller
    // rendering a table must not have to distinguish the two.
    expect(balances.get(c.id)).toBe('0.00')
  })

  it('يعيد خريطة فارغة لقائمة فارغة دون استعلام', async () => {
    const groupBy = vi.fn()
    const spy = { ledgerEntry: { groupBy } } as unknown as Db

    expect((await balancesFor(spy, { userIds: [] })).size).toBe(0)
    expect(groupBy).not.toHaveBeenCalled()
  })
})
