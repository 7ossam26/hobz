import { describe, expect, it } from 'vitest'

import { DomainError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { createLedgerTaskEvents } from '@/modules/ledger/earnings'
import { balanceFor } from '@/modules/ledger/service'
import { closeCycleJob } from '@/modules/payout/job'
import { approvePayout, closeCycle, markPayoutPaid } from '@/modules/payout/service'
import type { CloseCycleResult } from '@/modules/payout/types'
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
import { advanceDays, cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * docs/TESTING.md §4 axis 5 — "run the job 1×, 3×, 10× → identical ledger."
 *
 * Phase 7's equivalents of the penalty job are the cycle close and the earnings
 * subscriber, and both are reachable twice in ways nobody clicks twice: a
 * redeploy mid-run, a retried event, a manager pressing إغلاق while the cron
 * fires, a queue that redelivers. CLAUDE.md invariant 6 says running any of them
 * again must not change the outcome — and because invariant 1 makes the ledger
 * append-only, "changed the outcome" here means "wrote a row that can never be
 * taken back". A second SALARY, a second EARNING or a second PAYOUT is money
 * that has to be chased with a REVERSAL and explained to somebody.
 *
 * So the assertions are deliberately whole-table: the same rows, with the same
 * ids, in the same order, summing to the same balance — not merely the same
 * count.
 */

const db = testDb()
const CYCLE_DAY = SETTINGS_CATALOG['payout.cycleDay'].default
const METHODS = SETTINGS_CATALOG['payout.paymentMethods'].default

/**
 * 23:59 Cairo on a given August night.
 *
 * The close night is derived from Settings rather than typed in, because the
 * scheduled job's entire behaviour is "is tonight the night" (see the module
 * note in `modules/payout/job`). A hardcoded 28 would keep passing if an
 * operator moved `payout.cycleDay`, while testing something else entirely.
 */
const augustNight = (day: number): Date =>
  cairo(`2026-08-${String(day).padStart(2, '0')}T23:59`)

const CLOSE_AT = augustNight(CYCLE_DAY)
/** Any night that is not the cycle day. The cron fires on it too. */
const ORDINARY_NIGHT = augustNight(CYCLE_DAY === 1 ? CYCLE_DAY + 1 : CYCLE_DAY - 1)

/**
 * See the note in close.test.ts: `createLedgerEntry` attaches an entry to the
 * open cycle by its own `createdAt`, so every movement carries an explicit Cairo
 * instant inside the cycle under test rather than "now".
 */
const IN_AUGUST = cairo('2026-08-10T09:00')
const IN_SEPTEMBER = cairo('2026-09-05T09:00')

const PAY_AT = cairo('2026-08-29T11:00')

async function manager() {
  await seedPermissionCatalog(db)
  const user = await createUserWithPermissions(db, [
    'payout.generate',
    'payout.approve',
    'payout.markPaid',
  ])
  return actorFor(db, user.id)
}

/**
 * The whole ledger, with money flattened to canonical strings.
 *
 * Spread rather than hand-picked columns: "identical ledger" has to mean every
 * column, including ones a later phase adds, and a snapshot that only compares
 * the fields somebody remembered would pass through the exact regression this
 * axis exists to catch.
 */
async function ledgerSnapshot() {
  const rows = await db.ledgerEntry.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map((row) => ({ ...row, amount: row.amount.toFixed(2) }))
}

/** Invariant 1's balance: always `SUM(amount)`, never a column. */
async function ledgerTotal(): Promise<string> {
  const { _sum } = await db.ledgerEntry.aggregate({ _sum: { amount: true } })
  return _sum.amount?.toFixed(2) ?? '0.00'
}

async function payoutSnapshot() {
  const rows = await db.payout.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map((row) => ({
    ...row,
    carriedForward: row.carriedForward.toFixed(2),
    gross: row.gross.toFixed(2),
    penalties: row.penalties.toFixed(2),
    bonuses: row.bonuses.toFixed(2),
    advances: row.advances.toFixed(2),
    adjustments: row.adjustments.toFixed(2),
    net: row.net.toFixed(2),
    paidAmount: row.paidAmount.toFixed(2),
  }))
}

describe('modules/payout — إغلاق الدورة لا يتغيّر بالتكرار', () => {
  async function agencyWithMovements() {
    const actor = await manager()
    const perTask = await createUser(db, { payType: 'PER_TASK' })
    const salaried = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '11000.00',
      defaultTaskRate: null,
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: perTask.id,
      type: 'EARNING',
      amount: '2000.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: perTask.id,
      type: 'PENALTY',
      amount: '-250.00',
    })
    return { actor, perTask, salaried }
  }

  it('التشغيل مرة ثم ثلاثًا ثم عشرًا يترك نفس القيود بنفس المعرّفات ونفس المجموع', async () => {
    const { actor } = await agencyWithMovements()

    const first = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    expect(first.closed).toBe(true)
    const ledger = await ledgerSnapshot()
    const total = await ledgerTotal()
    const payouts = await payoutSnapshot()

    for (let run = 0; run < 2; run += 1) {
      await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    }
    expect(await ledgerSnapshot()).toEqual(ledger)

    for (let run = 0; run < 7; run += 1) {
      await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    }
    expect(await ledgerSnapshot()).toEqual(ledger)
    expect(await ledgerTotal()).toBe(total)
    expect(await payoutSnapshot()).toEqual(payouts)
  })

  it('الإغلاقات المتكرّرة تُبلَّغ كمتخطَّاة ولا تفتح دورة ثالثة', async () => {
    // The count matters as much as the rows: every close opens the next cycle,
    // so a repeat that slipped past the guards would leave a chain of empty
    // cycles and — because a payout is drafted for anyone carrying a balance —
    // a second claim on money the first payout is already about to pay.
    const { actor } = await agencyWithMovements()
    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    const repeats: CloseCycleResult[] = []
    for (let run = 0; run < 9; run += 1) {
      repeats.push(await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY }))
    }

    expect(repeats.every((result) => result.closed === false)).toBe(true)
    expect(repeats.every((result) => result.skipped === 'not-started')).toBe(true)
    expect(repeats.every((result) => result.payoutsCreated === 0)).toBe(true)
    expect(await db.payoutCycle.count()).toBe(2)
    expect(await db.payoutCycle.count({ where: { status: 'OPEN' } })).toBe(1)
  })

  it('لا يكتب سطر تدقيق جديدًا لكل إعادة تشغيل', async () => {
    // The audit trail answers "how many times was this cycle settled". Ten rows
    // saying the same cycle closed is not a harmless duplicate — it is the log
    // disagreeing with the ledger about what happened.
    const { actor } = await agencyWithMovements()

    for (let run = 0; run < 10; run += 1) {
      await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    }

    expect(await db.auditLog.count({ where: { action: 'payout.cycleClosed' } })).toBe(1)
    // One `drafted` row per payout that exists — the منفّذ with movements and
    // the salaried one the close accrued for — and not one more per re-run.
    // Asserted against the payout count rather than a literal, so the row this
    // is really about (a duplicate) cannot hide behind a fixture gaining a
    // third worker later.
    expect(await db.payout.count()).toBe(2)
    expect(await db.auditLog.count({ where: { action: 'payout.drafted' } })).toBe(
      await db.payout.count(),
    )
  })

  it('إعادة إغلاق دورة مغلقة لا تغيّر شيئًا على الإطلاق', async () => {
    const { actor } = await agencyWithMovements()
    const first = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    const ledger = await ledgerSnapshot()
    const payouts = await payoutSnapshot()
    const cycles = await db.payoutCycle.count()
    const audits = await db.auditLog.count()

    const again = await closeCycle(db, {
      actor,
      now: PAY_AT,
      cycleDay: CYCLE_DAY,
      cycleId: first.cycleId!,
    })

    expect(again).toMatchObject({
      closed: false,
      skipped: 'already-closed',
      nextCycleId: null,
      payoutsCreated: 0,
      salaryEntries: 0,
    })
    expect(await ledgerSnapshot()).toEqual(ledger)
    expect(await payoutSnapshot()).toEqual(payouts)
    expect(await db.payoutCycle.count()).toBe(cycles)
    // Not even an audit row: a refused close is not an event, and a trail that
    // records attempts as closes cannot be used to reconcile anything.
    expect(await db.auditLog.count()).toBe(audits)
  })

  it('حركة جديدة بعد الإغلاق لا تغيّر مستحق الدورة المغلقة مهما أُعيد التشغيل', async () => {
    // The statement a منفّذ read last month must stay exactly as they read it.
    // The next cycle is where new movements land, and re-running the close is
    // the most likely way for that to be violated.
    const { actor, perTask } = await agencyWithMovements()
    const august = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    const drafted = await payoutSnapshot()

    await createLedgerEntry(db, {
      createdAt: IN_SEPTEMBER,
      userId: perTask.id,
      type: 'EARNING',
      amount: '700.00',
    })
    for (let run = 0; run < 10; run += 1) {
      await closeCycle(db, { actor, now: cairo('2026-09-06T10:00'), cycleDay: CYCLE_DAY })
    }

    expect(await payoutSnapshot()).toEqual(drafted)
    // Two: the منفّذ with August movements, and the salaried worker the close
    // accrued for. Ten re-runs add none.
    expect(await db.payout.count({ where: { cycleId: august.cycleId! } })).toBe(2)
    // The September earning is still sitting in the open cycle, unsettled.
    const september = await db.ledgerEntry.findFirstOrThrow({
      where: { userId: perTask.id, createdAt: IN_SEPTEMBER },
    })
    expect(september.cycleId).toBe(august.nextCycleId)
  })
})

describe('modules/payout — الراتب مرة واحدة في الشهر', () => {
  it('إغلاقان في نفس الشهر الميلادي يعطيان قيد راتب واحدًا', async () => {
    // SPEC §5.5 says one SALARY per cycle, but the cycle is not the unit that
    // protects the largest number in the system: an early close followed by the
    // scheduled one puts two cycles inside one Cairo month, and the per-cycle
    // unique index would happily allow a second salary. The month is the wider
    // net under it.
    const actor = await manager()
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '11000.00',
      defaultTaskRate: null,
    })

    const early = await closeCycle(db, {
      actor,
      now: cairo('2026-08-10T14:30'),
      cycleDay: CYCLE_DAY,
      allowEarly: true,
    })
    const scheduled = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })

    expect(early.salaryEntries).toBe(1)
    expect(scheduled.closed).toBe(true)
    expect(scheduled.salaryEntries).toBe(0)

    const salaries = await db.ledgerEntry.findMany({
      where: { userId: worker.id, type: 'SALARY' },
    })
    expect(salaries).toHaveLength(1)
    expect(salaries[0]?.cycleId).toBe(early.cycleId)
    expect(salaries[0]?.amount.toFixed(2)).toBe('11000.00')
  })
})

describe('modules/ledger — مشترك الاستحقاقات لا يتأثر بإعادة الإطلاق', () => {
  it('إطلاق حدث اعتماد واحد عشر مرات يكتب قيد استحقاق واحدًا', async () => {
    // A retried or replayed TaskApproved is invisible to the state machine —
    // it already refused APPROVED → APPROVED — so "approving twice must not
    // double-pay" can only be true in the subscriber.
    await seedPermissionCatalog(db)
    const approver = await createUserWithPermissions(db, ['task.approve'])
    const actor = await actorFor(db, approver.id)
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: approver.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
      taskValue: '1500.00',
    })
    const events = createLedgerTaskEvents({ cycleDay: CYCLE_DAY })
    const approvedAt = cairo('2026-08-15T10:00')

    await approveTask(db, {
      actor,
      now: approvedAt,
      events,
      input: { taskId: task.id, qualityRating: 5 },
    })
    const ledger = await ledgerSnapshot()

    for (let replay = 0; replay < 9; replay += 1) {
      await events.emit(db, {
        type: 'TaskApproved',
        taskId: task.id,
        projectId: project.id,
        assigneeId: worker.id,
        taskValue: '1500.00',
        qualityRating: 5,
        approvedAt,
        approvedById: approver.id,
      })
    }

    expect(await ledgerSnapshot()).toEqual(ledger)
    expect(
      await db.ledgerEntry.count({ where: { taskId: task.id, type: 'EARNING' } }),
    ).toBe(1)
    expect(await balanceFor(db, { userId: worker.id })).toBe('1500.00')
  })
})

describe('modules/payout — الصرف ليس عملية قابلة للتكرار', () => {
  it('محاولة صرف ثانية بعد السداد الكامل تُرفض ولا تكتب قيد صرف ثانيًا', async () => {
    // markPayoutPaid is deliberately NOT idempotent — a second payment is a
    // second payment, and the ledger must record both. What has to hold instead
    // is the guard: once `paidAmount` reaches `net` there is nothing left to
    // pay, so a repeated call (a double-clicked button, a retried action) is
    // refused rather than quietly appending a second negative PAYOUT and
    // driving the منفّذ's balance below zero.
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '800.00',
    })
    await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    const payout = await db.payout.findFirstOrThrow({ where: { userId: worker.id } })

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
    const ledger = await ledgerSnapshot()

    await expect(
      markPayoutPaid(db, {
        payoutId: payout.id,
        amount: '800.00',
        method: METHODS[0]!,
        paymentMethods: METHODS,
        actor,
        cycleDay: CYCLE_DAY,
        now: cairo('2026-08-29T11:05'),
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(await ledgerSnapshot()).toEqual(ledger)
    expect(await db.ledgerEntry.count({ where: { type: 'PAYOUT' } })).toBe(1)
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})

describe('modules/payout — المهمة المجدولة تسأل الإعدادات عن الليلة', () => {
  it('لا تفعل شيئًا في ليلة ليست يوم الصرف', async () => {
    // The cron is nightly on purpose (the day is a Setting, and a cron
    // expression is compiled once at startup), so ~27 nights a month the
    // handler must be a no-op. If it were not, the cycle would close on the
    // wrong night and every منفّذ would be paid for a fortnight.
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '11000.00',
      defaultTaskRate: null,
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '2000.00',
    })
    const ledger = await ledgerSnapshot()

    await closeCycleJob.handler({ db, runAt: ORDINARY_NIGHT, trigger: 'schedule' })

    expect(await ledgerSnapshot()).toEqual(ledger)
    expect(await db.payout.count()).toBe(0)
    expect(await db.payoutCycle.count({ where: { status: 'CLOSED' } })).toBe(0)
    expect(await db.auditLog.count({ where: { action: 'payout.cycleClosed' } })).toBe(0)
  })

  it('عشر ليالٍ متتالية تُغلق دورة واحدة فقط', async () => {
    // The scheduler ticks every night whether or not anything is due, and a
    // redeploy or a manual trigger makes a night tick twice. Ten ticks across
    // the cycle boundary must still settle exactly one cycle. (No Cairo DST
    // transition falls between late August and early September 2026, so a
    // 24-hour step stays at 23:59 local.)
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '11000.00',
      defaultTaskRate: null,
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '2000.00',
    })

    for (let night = 0; night < 10; night += 1) {
      await closeCycleJob.handler({
        db,
        runAt: advanceDays(CLOSE_AT, night),
        trigger: 'schedule',
      })
    }

    expect(await db.payoutCycle.count({ where: { status: 'CLOSED' } })).toBe(1)
    expect(await db.auditLog.count({ where: { action: 'payout.cycleClosed' } })).toBe(1)
    expect(await db.payout.count({ where: { userId: worker.id } })).toBe(1)
    expect(
      await db.ledgerEntry.count({ where: { userId: worker.id, type: 'SALARY' } }),
    ).toBe(1)
    // 2000 earned + 11000 salary, and neither counted twice.
    expect(await balanceFor(db, { userId: worker.id })).toBe('13000.00')
  })
})
