import { describe, expect, it } from 'vitest'

import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { balanceFor } from '@/modules/ledger/service'
import { closeCycleUnderLock } from '@/modules/payout/job'
import { cycleEndAfter } from '@/modules/payout/period'
import { closeCycle } from '@/modules/payout/service'

import {
  createLeave,
  createLedgerEntry,
  createPayoutCycle,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const CYCLE_DAY = SETTINGS_CATALOG['payout.cycleDay'].default
const CLOSE_AT = cairo('2026-08-28T23:59')

/**
 * Entries carry an explicit Cairo timestamp inside the cycle under test.
 *
 * The factory attaches an entry to whichever cycle its `createdAt` falls in —
 * exactly as `appendEntry` does in production — so an entry stamped "now" would
 * belong to whatever cycle the wall clock happens to be in on the day the suite
 * runs, and these assertions would start failing on the 29th of a month
 * (docs/TESTING.md §5: never `new Date()` inside a test).
 */
const IN_AUGUST = cairo('2026-08-10T09:00')
const IN_SEPTEMBER = cairo('2026-09-10T09:00')

async function manager() {
  await seedPermissionCatalog(db)
  const user = await createUserWithPermissions(db, ['payout.generate', 'payout.approve'])
  return actorFor(db, user.id)
}

/**
 * SPEC §5.5. Closing a cycle is the one operation in the product that turns a
 * month of movements into a number somebody is handed, so almost everything
 * here is about it being *exactly once*: one cycle, one salary, one payout per
 * منفّذ, whatever the scheduler and a hurried manager do at the same moment.
 */
describe('modules/payout — إغلاق الدورة', () => {
  it('يولّد مستحقًا مسودة لكل منفّذ له حركة في الدورة', async () => {
    const actor = await manager()
    const [first, second] = [await createUser(db), await createUser(db)]

    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: first.id,
      amount: '2000.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: second.id,
      amount: '3000.00',
    })

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    expect(result.closed).toBe(true)
    expect(result.payoutsCreated).toBe(2)

    const payouts = await db.payout.findMany({ where: { cycleId: result.cycleId! } })
    expect(payouts).toHaveLength(2)
    expect(payouts.every((p) => p.status === 'DRAFT')).toBe(true)
    expect(payouts.find((p) => p.userId === first.id)?.net.toFixed(2)).toBe('2000.00')
  })

  it('يجمع الاستحقاقات والخصومات والمكافآت والسلف في مستحق واحد', async () => {
    const actor = await manager()
    const worker = await createUser(db)

    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '4000.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'BONUS',
      amount: '500.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'ADVANCE',
      amount: '-1000.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'ADJUSTMENT',
      amount: '120.00',
    })

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    const payout = await db.payout.findFirstOrThrow({ where: { userId: worker.id } })

    // The breakdown columns print magnitudes; the ledger rows carry the signs.
    expect(payout.gross.toFixed(2)).toBe('4000.00')
    expect(payout.penalties.toFixed(2)).toBe('250.00')
    expect(payout.bonuses.toFixed(2)).toBe('500.00')
    expect(payout.advances.toFixed(2)).toBe('1000.00')
    expect(payout.adjustments.toFixed(2)).toBe('120.00')
    expect(payout.carriedForward.toFixed(2)).toBe('0.00')
    // gross − penalties + bonuses − advances + adjustments = 3370
    expect(payout.net.toFixed(2)).toBe('3370.00')
    expect(result.payoutsCreated).toBe(1)
  })

  it('صافي المستحق يساوي الرصيد لحظة الإغلاق', async () => {
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '1234.56',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-34.56',
    })

    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    const payout = await db.payout.findFirstOrThrow({ where: { userId: worker.id } })
    expect(payout.net.toFixed(2)).toBe(await balanceFor(db, { userId: worker.id }))
  })

  it('لا يولّد مستحقًا لمن لا حركة له ولا رصيد', async () => {
    const actor = await manager()
    await createUser(db)

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    expect(result.payoutsCreated).toBe(0)
    expect(await db.payout.count()).toBe(0)
  })

  it('لا يُغلق دورة لم تبلغ موعدها إلا بطلب صريح', async () => {
    // The unattended path must never settle a cycle early. Without this, a job
    // that fired twice would close the freshly opened cycle a microsecond later
    // and draft a second payout for money the first one is about to pay.
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '100.00',
    })

    const early = cairo('2026-08-20T14:30')
    const refused = await closeCycle(db, { actor, now: early, cycleDay: CYCLE_DAY })

    expect(refused.closed).toBe(false)
    expect(refused.skipped).toBe('not-due')
    expect(await db.payout.count()).toBe(0)
    expect(await db.payoutCycle.count({ where: { status: 'CLOSED' } })).toBe(0)
  })

  it('لا يُغلق دورة لم تبدأ بعد حتى مع الطلب الصريح', async () => {
    // Closing opens the next cycle at the same instant. A second close — a
    // double-clicked button, a lock that queued instead of rejecting — must not
    // be able to settle that brand-new, zero-length cycle.
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '100.00',
    })

    const first = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    expect(first.closed).toBe(true)

    const second = await closeCycle(db, {
      actor,
      now: CLOSE_AT,
      cycleDay: CYCLE_DAY,
      allowEarly: true,
    })

    expect(second.closed).toBe(false)
    expect(second.skipped).toBe('not-started')
    expect(await db.payout.count()).toBe(1)
    expect(await db.payoutCycle.count({ where: { status: 'CLOSED' } })).toBe(1)
  })

  it('يفتح الدورة التالية فورًا وتبدأ من لحظة الإغلاق', async () => {
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '100.00',
    })

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    const closed = await db.payoutCycle.findUniqueOrThrow({
      where: { id: result.cycleId! },
    })
    const next = await db.payoutCycle.findUniqueOrThrow({
      where: { id: result.nextCycleId! },
    })

    expect(closed.status).toBe('CLOSED')
    expect(closed.closedAt).toEqual(CLOSE_AT)
    // The period a cycle covers ends when it actually closed, never later.
    expect(closed.periodEnd).toEqual(CLOSE_AT)
    expect(next.status).toBe('OPEN')
    expect(next.periodStart).toEqual(CLOSE_AT)
    expect(next.periodEnd).toEqual(cycleEndAfter(CLOSE_AT, CYCLE_DAY))
  })

  it('الدورات متلاصقة — لا فجوة ولا تداخل', async () => {
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '100.00',
    })

    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    await createLedgerEntry(db, {
      createdAt: IN_SEPTEMBER,
      userId: worker.id,
      amount: '100.00',
    })
    await closeCycle(db, {
      actor,
      now: cairo('2026-09-28T23:59'),
      cycleDay: CYCLE_DAY,
    })

    const cycles = await db.payoutCycle.findMany({ orderBy: { periodStart: 'asc' } })
    expect(cycles).toHaveLength(3)
    expect(cycles[1]?.periodStart).toEqual(cycles[0]?.periodEnd)
    expect(cycles[2]?.periodStart).toEqual(cycles[1]?.periodEnd)
    expect(cycles.filter((c) => c.status === 'OPEN')).toHaveLength(1)
  })

  it('يسمح بإغلاق مبكر ويسجّل من أغلقها', async () => {
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '100.00',
    })

    const early = cairo('2026-08-20T14:30')
    const result = await closeCycle(db, {
      actor,
      now: early,
      cycleDay: CYCLE_DAY,
      allowEarly: true,
    })
    expect(result.closed).toBe(true)

    const closed = await db.payoutCycle.findUniqueOrThrow({
      where: { id: result.cycleId! },
    })
    expect(closed.closedAt).toEqual(early)
    expect(closed.closedById).toBe(actor.id)
    // `periodEnd` keeps saying which month the cycle was *for*; `closedAt` says
    // when it actually ended. Collapsing the two would cost a منفّذ a month's
    // salary the first time a close ran late — see the accrual's month guard.
    expect(closed.periodEnd).toEqual(CLOSE_AT)
    // The next cycle picks up at the fact, not at the plan, so no day belongs
    // to two cycles.
    const next = await db.payoutCycle.findUniqueOrThrow({
      where: { id: result.nextCycleId! },
    })
    expect(next.periodStart).toEqual(early)
  })

  it('الإغلاق بالجدولة يسجَّل بلا فاعل بشري', async () => {
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '100.00',
    })

    const result = await closeCycle(db, {
      actor: null,
      now: CLOSE_AT,
      cycleDay: CYCLE_DAY,
    })
    const closed = await db.payoutCycle.findUniqueOrThrow({
      where: { id: result.cycleId! },
    })

    expect(closed.closedById).toBeNull()
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'payout.cycleClosed' },
    })
    expect(audit.actorId).toBeNull()
  })

  it('يكتب سطر تدقيق للإغلاق ولكل مستحق', async () => {
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '100.00',
    })

    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    expect(await db.auditLog.count({ where: { action: 'payout.cycleClosed' } })).toBe(1)
    expect(await db.auditLog.count({ where: { action: 'payout.drafted' } })).toBe(1)
  })

  it('يرفض إغلاق دورة مغلقة أصلًا', async () => {
    const actor = await manager()
    const cycle = await createPayoutCycle(db, { status: 'CLOSED' })

    const result = await closeCycle(db, {
      actor,
      now: CLOSE_AT,
      cycleDay: CYCLE_DAY,
      cycleId: cycle.id,
    })
    expect(result.closed).toBe(false)
    expect(result.skipped).toBe('already-closed')
  })

  it('يفتح دورة أولى إن لم توجد أي دورة بعد', async () => {
    // A salaried-only agency writes no ledger entries until the first close, so
    // the close cannot depend on somebody else having opened a cycle first.
    const actor = await manager()
    expect(await db.payoutCycle.count()).toBe(0)

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    expect(result.closed).toBe(true)
    expect(await db.payoutCycle.count()).toBe(2)
  })
})

describe('modules/payout — استحقاق الراتب', () => {
  async function salaried(monthlySalary: string | null = '11000.00') {
    return createUser(db, {
      payType: 'SALARY',
      monthlySalary,
      defaultTaskRate: null,
      isWorker: true,
    })
  }

  it('قيد راتب واحد لكل موظف براتب في كل دورة', async () => {
    const actor = await manager()
    const worker = await salaried()

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    const entries = await db.ledgerEntry.findMany({ where: { userId: worker.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.type).toBe('SALARY')
    expect(entries[0]?.amount.toFixed(2)).toBe('11000.00')
    expect(entries[0]?.isAutoGenerated).toBe(true)
    expect(entries[0]?.cycleId).toBe(result.cycleId)
    expect(result.salaryEntries).toBe(1)
  })

  it('الموظف المختلط يأخذ راتبه وأجر مهامه معًا', async () => {
    const actor = await manager()
    const worker = await createUser(db, {
      payType: 'HYBRID',
      monthlySalary: '8000.00',
      defaultTaskRate: '300.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '900.00',
    })

    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    const payout = await db.payout.findFirstOrThrow({ where: { userId: worker.id } })
    expect(payout.gross.toFixed(2)).toBe('8900.00')
    expect(payout.net.toFixed(2)).toBe('8900.00')
  })

  it('من يتقاضى بالمهمة لا يأخذ قيد راتب', async () => {
    const actor = await manager()
    const worker = await createUser(db, { payType: 'PER_TASK' })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '500.00',
    })

    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    expect(
      await db.ledgerEntry.count({ where: { userId: worker.id, type: 'SALARY' } }),
    ).toBe(0)
  })

  it('الإجازة المعتمدة مدفوعة بالكامل — لا خصم ولا تناسب', async () => {
    // SPEC §5.5: "Approved leave is paid." The feature is the *absence* of
    // proration, so it needs a test or the first person to add one will not be
    // contradicted by anything.
    const actor = await manager()
    const worker = await salaried('11000.00')
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-08-03',
      endDate: '2026-08-13',
      status: 'APPROVED',
    })

    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    const entry = await db.ledgerEntry.findFirstOrThrow({
      where: { userId: worker.id, type: 'SALARY' },
    })
    expect(entry.amount.toFixed(2)).toBe('11000.00')
  })

  it('لا يستحق راتبًا من عُطِّل حسابه أو حُذف', async () => {
    const actor = await manager()
    await createUser(db, { payType: 'SALARY', monthlySalary: '9000.00', isActive: false })
    await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '9000.00',
      deletedAt: new Date('2026-07-01T00:00:00Z'),
    })

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    expect(result.salaryEntries).toBe(0)
    expect(await db.ledgerEntry.count({ where: { type: 'SALARY' } })).toBe(0)
  })

  it('لا ينفجر ولا يكتب صفرًا لمن نوعه راتب بلا راتب مسجّل', async () => {
    const actor = await manager()
    const worker = await salaried(null)

    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    expect(result.salaryEntries).toBe(0)
    expect(await db.ledgerEntry.count({ where: { userId: worker.id } })).toBe(0)
    expect(await db.auditLog.count({ where: { action: 'payout.salarySkipped' } })).toBe(1)
  })

  it('لا يتقاضى راتبين في شهر واحد ولو أُغلقت دورتان', async () => {
    // SPEC §5.5 says one SALARY entry per cycle, and the default cycle *is* a
    // month. "Monthly salary is monthly" is the stronger reading and the one
    // that survives an operator closing twice in August — the per-cycle unique
    // index cannot catch that, because the second close is a different cycle.
    const actor = await manager()
    const worker = await salaried('11000.00')

    await closeCycle(db, { actor, now: cairo('2026-08-20T12:00'), cycleDay: CYCLE_DAY })
    await closeCycle(db, {
      actor,
      now: CLOSE_AT,
      cycleDay: CYCLE_DAY,
      allowEarly: true,
    })

    const salaries = await db.ledgerEntry.findMany({
      where: { userId: worker.id, type: 'SALARY' },
    })
    expect(salaries).toHaveLength(1)
    expect(salaries[0]?.amount.toFixed(2)).toBe('11000.00')
  })

  it('يتقاضى راتبه في الشهر التالي كالمعتاد', async () => {
    // The month guard must not become a permanent block: September is a new
    // month and a new salary.
    const actor = await manager()
    const worker = await salaried('11000.00')

    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    await closeCycle(db, {
      actor,
      now: cairo('2026-09-28T23:59'),
      cycleDay: CYCLE_DAY,
    })

    expect(
      await db.ledgerEntry.count({ where: { userId: worker.id, type: 'SALARY' } }),
    ).toBe(2)
  })

  it('لا يكرّر الراتب إذا أُعيد تشغيل الإغلاق على نفس الدورة', async () => {
    const actor = await manager()
    const worker = await salaried()
    const cycle = await createPayoutCycle(db, { status: 'OPEN' })

    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY, cycleId: cycle.id })
    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY, cycleId: cycle.id })

    expect(
      await db.ledgerEntry.count({ where: { userId: worker.id, type: 'SALARY' } }),
    ).toBe(1)
  })

  it('يرفض قيد راتب ثانٍ لنفس الدورة على مستوى قاعدة البيانات', async () => {
    const actor = await manager()
    const worker = await salaried()
    const result = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    await expect(
      db.ledgerEntry.create({
        data: {
          userId: worker.id,
          cycleId: result.cycleId,
          type: 'SALARY',
          amount: '11000.00',
          note: 'التفاف',
        },
      }),
    ).rejects.toThrow()
  })
})

describe('modules/payout — إغلاقان متزامنان', () => {
  it('ينتج دورة واحدة ومستحقًا واحدًا لكل منفّذ', async () => {
    // Phase brief, test 6. The advisory lock is the first guarantee; the unique
    // index on (userId, cycleId) is what holds if the lock is ever skipped.
    const actor = await manager()
    const [first, second] = [await createUser(db), await createUser(db)]
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: first.id,
      amount: '2000.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: second.id,
      amount: '3000.00',
    })

    const [a, b] = await Promise.all([
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
    ])

    // Exactly one call did the work. Asserted on the *outcome* rather than on
    // who got the lock, because both ways of losing are correct: the second
    // caller is either rejected by `pg_try_advisory_xact_lock` or queued behind
    // it on a pooled connection and then told the cycle it wanted has already
    // been closed. A test that demanded the first would be a test of the
    // connection pool.
    expect([a, b].filter((outcome) => outcome.result?.closed)).toHaveLength(1)
    expect([a, b].some((outcome) => !outcome.acquired || outcome.result?.skipped)).toBe(
      true,
    )

    const closed = await db.payoutCycle.findMany({ where: { status: 'CLOSED' } })
    expect(closed).toHaveLength(1)
    expect(await db.payout.count()).toBe(2)
    expect(await db.payout.count({ where: { userId: first.id } })).toBe(1)
    expect(await db.payout.count({ where: { cycleId: closed[0]?.id } })).toBe(2)
    expect(await db.payoutCycle.count({ where: { status: 'OPEN' } })).toBe(1)
  })

  it('لا يضاعف الرواتب ولا المستحقات عند التشغيل ثلاث مرات', async () => {
    const actor = await manager()
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '11000.00',
    })

    await Promise.all([
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
      closeCycleUnderLock(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }),
    ])

    expect(
      await db.ledgerEntry.count({ where: { userId: worker.id, type: 'SALARY' } }),
    ).toBe(1)
    expect(await db.payout.count({ where: { userId: worker.id } })).toBe(1)
  })

  it('لا تفتح كتابتان متزامنتان دورتين', async () => {
    // `payout_cycles_single_open` — two open cycles would mean two answers to
    // "which cycle is this entry in".
    const [a, b] = [await createUser(db), await createUser(db)]
    await Promise.allSettled([
      createLedgerEntry(db, { createdAt: IN_AUGUST, userId: a.id, amount: '1.00' }),
      createLedgerEntry(db, { createdAt: IN_AUGUST, userId: b.id, amount: '1.00' }),
    ])
    await closeCycle(db, { actor: null, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    expect(await db.payoutCycle.count({ where: { status: 'OPEN' } })).toBe(1)
    await expect(
      db.payoutCycle.create({
        data: {
          periodStart: CLOSE_AT,
          periodEnd: cycleEndAfter(CLOSE_AT, CYCLE_DAY),
          status: 'OPEN',
        },
      }),
    ).rejects.toThrow()
  })
})
