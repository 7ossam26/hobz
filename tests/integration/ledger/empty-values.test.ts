import { describe, expect, it } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { createLedgerTaskEvents } from '@/modules/ledger/earnings'
import {
  dailyRate,
  effectiveTaskRate,
  monthlySalaryOf,
} from '@/modules/ledger/pay-profile'
import { listLedgerSchema } from '@/modules/ledger/schema'
import { appendEntry, listEntries, summaryFor } from '@/modules/ledger/service'
import { closeCycle, listStatements } from '@/modules/payout/service'
import { approveTask } from '@/modules/task/service'

import {
  createLedgerEntry,
  createPayoutCycle,
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
const WORKING_DAYS_PER_MONTH = SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default

const AUGUST_CLOSE = cairo('2026-08-28T23:59')
const SEPTEMBER_CLOSE = cairo('2026-09-28T23:59')
const NOW = cairo('2026-08-15T10:00')

/**
 * See the note in payout/close.test.ts: the factory attaches an entry to
 * whichever cycle its `createdAt` falls in, exactly as `appendEntry` does, so
 * every arrangement stamps an explicit Cairo instant inside the cycle under
 * test rather than "now".
 */
const IN_AUGUST = cairo('2026-08-10T09:00')

const events = createLedgerTaskEvents({ cycleDay: CYCLE_DAY })

/**
 * docs/TESTING.md §4 axis 12 — empty/null: "no assignee, no due date, no
 * salary, brand-new user, empty cycle."
 *
 * The axis matters here more than anywhere else in the product because every
 * one of these cases has a plausible-looking wrong answer. A missing salary
 * that becomes `0.00`, an empty statement that becomes `null`, a departed
 * منفّذ's balance that becomes nobody's problem — each reads as a correct
 * result on screen and is only discovered when somebody is paid the wrong
 * amount. So the assertions below are as much about *what is written down when
 * nothing happens* (the audit row naming the reason) as about the money.
 */

/** `after` is a `Json` column; these tests care about two or three keys in it. */
function auditPayload(row: { after: unknown }): Record<string, unknown> {
  return (row.after ?? {}) as Record<string, unknown>
}

async function manager() {
  await seedPermissionCatalog(db)
  const user = await createUserWithPermissions(db, ['payout.generate', 'payout.approve'])
  return actorFor(db, user.id)
}

/** Mirrors earnings.test.ts: approval goes through the task module, not the bus. */
async function approvalScenario(
  overrides: { taskValue?: string; assigned?: boolean } = {},
) {
  await seedPermissionCatalog(db)
  const boss = await createUserWithPermissions(db, ['task.approve', 'task.cancel'])
  const worker = await createUser(db)
  const project = await createProject(db, { ownerId: boss.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: overrides.assigned === false ? null : worker.id,
    status: 'IN_REVIEW',
    taskValue: overrides.taskValue ?? '1500.00',
  })

  return { task, worker, actor: await actorFor(db, boss.id) }
}

describe('modules/ledger — منفّذ جديد لا حركة له', () => {
  it('كشف حسابه صفحة فارغة سليمة لا خطأ', async () => {
    const worker = await createUser(db)

    const page = await listEntries(db, { userId: worker.id })

    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
    expect(page.page).toBe(1)
    // The service's default page size must be the one the form's schema
    // promises: a first page that silently held a different number of rows than
    // the UI asked for would paginate wrong before anybody clicked anything.
    expect(page.pageSize).toBe(listLedgerSchema.parse({}).pageSize)
    // '0.00' and never null — a header that had to tell "nothing yet" apart
    // from "zero" would end up printing an empty box for half the organization.
    expect(page.balance).toBe('0.00')
  })

  it('ملخّصه قبل فتح أي دورة يعيد دورة حالية معدومة لا ينفجر', async () => {
    const worker = await createUser(db)
    // The premise: a freshly installed system, before anything opened a cycle.
    expect(await db.payoutCycle.count()).toBe(0)

    const summary = await summaryFor(db, { userId: worker.id })

    expect(summary.currentCycle).toBeNull()
    expect(summary.balance).toBe('0.00')
    expect(summary.outstandingPayouts).toBe('0.00')
  })

  it('ملخّصه داخل دورة مفتوحة يعرض صفرًا في كل بند', async () => {
    // The مستحقاتي header renders these six figures unconditionally. A missing
    // key here is a blank panel on the page of every منفّذ who has not yet
    // earned anything this month — which is everybody on the first of the month.
    const worker = await createUser(db)
    const cycle = await createPayoutCycle(db, { status: 'OPEN' })

    const summary = await summaryFor(db, { userId: worker.id })

    expect(summary.currentCycle?.id).toBe(cycle.id)
    expect(summary.currentCycle).toMatchObject({
      earnings: '0.00',
      salary: '0.00',
      penalties: '0.00',
      bonuses: '0.00',
      advances: '0.00',
      adjustments: '0.00',
    })
  })

  it('لا يعرض له أي سطر في «مستحقاتي» قبل أول دورة', async () => {
    const worker = await createUser(db)

    await expect(listStatements(db, { userId: worker.id })).resolves.toEqual([])
  })

  it('الإغلاق لا يترك له مستحقًا ولا سطر كشف', async () => {
    // A payout of 0.00 for somebody who joined yesterday is not harmless: it
    // enters the approval queue, is counted in the cycle's payout total, and
    // has to be explained to whoever approves it.
    const actor = await manager()
    const newcomer = await createUser(db)
    const active = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: active.id,
      amount: '900.00',
    })

    const result = await closeCycle(db, { actor, now: AUGUST_CLOSE, cycleDay: CYCLE_DAY })

    expect(result.payoutsCreated).toBe(1)
    expect(await db.payout.count({ where: { userId: newcomer.id } })).toBe(0)
    expect(await listStatements(db, { userId: newcomer.id })).toEqual([])
  })
})

describe('modules/ledger — أعمدة الأجر الفارغة على صف حقيقي', () => {
  it('أجر اليوم لمن لا راتب شهري مسجّل له يعود null لا صفرًا', async () => {
    // The unit tests prove this against a built object; this one proves the
    // shape Prisma actually returns — a `Decimal | null` column — travels
    // through the same gate. A zero would multiply into a zero deduction under
    // PCT_DAILY_RATE_PER_DAY (SPEC §5.4) and read exactly like a correct one.
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: null,
      defaultTaskRate: null,
    })

    const row = await db.user.findUniqueOrThrow({
      where: { id: worker.id },
      select: { payType: true, monthlySalary: true, defaultTaskRate: true },
    })

    expect(monthlySalaryOf(row)).toBeNull()
    expect(dailyRate(row, WORKING_DAYS_PER_MONTH)).toBeNull()
  })

  it('سعر المهمة لمن لا سعر افتراضي مسجّل له يعود null', async () => {
    // The factory keeps this column null only when a test asks explicitly, for
    // this reason: a defaulted rate would let a task be priced from a figure
    // nobody entered.
    const worker = await createUser(db, { payType: 'PER_TASK', defaultTaskRate: null })

    const row = await db.user.findUniqueOrThrow({
      where: { id: worker.id },
      select: { payType: true, monthlySalary: true, defaultTaskRate: true },
    })

    expect(effectiveTaskRate(row)).toBeNull()
  })
})

describe('modules/payout — راتب غير مسجّل أو مسجّل بصفر', () => {
  it('راتب غير مسجّل: لا قيد، وسطر التدقيق يسمّي السبب والدورة', async () => {
    const actor = await manager()
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: null,
      defaultTaskRate: null,
    })

    const result = await closeCycle(db, { actor, now: AUGUST_CLOSE, cycleDay: CYCLE_DAY })

    expect(await db.ledgerEntry.count({ where: { userId: worker.id } })).toBe(0)
    const skipped = await db.auditLog.findFirstOrThrow({
      where: { action: 'payout.salarySkipped', entityId: worker.id },
    })
    // "Why was this person not paid in August" has to be answerable in
    // November, from the row alone.
    expect(auditPayload(skipped).reason).toBe('no-monthly-salary')
    expect(auditPayload(skipped).cycleId).toBe(result.cycleId)
  })

  it('راتب مسجّل بصفر: لا قيد بصفر، والسبب يقول صفر لا «غير مسجّل»', async () => {
    const actor = await manager()
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '0.00',
      defaultTaskRate: null,
    })

    const result = await closeCycle(db, { actor, now: AUGUST_CLOSE, cycleDay: CYCLE_DAY })

    expect(result.salaryEntries).toBe(0)
    expect(
      await db.ledgerEntry.count({ where: { userId: worker.id, type: 'SALARY' } }),
    ).toBe(0)
    const skipped = await db.auditLog.findFirstOrThrow({
      where: { action: 'payout.salarySkipped', entityId: worker.id },
    })
    // Two different operational problems: a missing figure is a data-entry gap
    // somebody must fix, a zero is a decision somebody made. Collapsing them
    // into one reason hides the first behind the second forever.
    expect(auditPayload(skipped).reason).toBe('zero-monthly-salary')
  })

  it('الرواتب الناقصة لا توقف الإغلاق لبقية المنفّذين', async () => {
    // The failure this guards against is the worst kind: one bad row in the
    // users table stopping payday for the whole agency.
    const actor = await manager()
    const missing = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: null,
      defaultTaskRate: null,
    })
    const zeroed = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '0.00',
      defaultTaskRate: null,
    })
    const paid = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '11000.00',
      defaultTaskRate: null,
    })

    const result = await closeCycle(db, { actor, now: AUGUST_CLOSE, cycleDay: CYCLE_DAY })

    expect(result.closed).toBe(true)
    expect(result.salaryEntries).toBe(1)
    expect(result.payoutsCreated).toBe(1)
    expect(
      (await db.payout.findFirstOrThrow({ where: { userId: paid.id } })).net.toFixed(2),
    ).toBe('11000.00')
    expect(
      await db.payout.count({ where: { userId: { in: [missing.id, zeroed.id] } } }),
    ).toBe(0)
  })
})

describe('modules/ledger — اعتماد لا يصرف شيئًا', () => {
  it('مهمة بلا منفّذ: سطر التدقيق يسمّي السبب والقيمة التي لم تُصرف', async () => {
    // earnings.test.ts proves nothing is written. What matters a month later is
    // the payload: "no-assignee" plus the value, so an unassigned but valuable
    // task can be found and paid to whoever actually did it.
    const { task, actor } = await approvalScenario({
      assigned: false,
      taskValue: '1500.00',
    })

    await approveTask(db, {
      actor,
      now: NOW,
      events,
      input: { taskId: task.id, qualityRating: 4 },
    })

    expect(await db.ledgerEntry.count()).toBe(0)
    const skipped = await db.auditLog.findFirstOrThrow({
      where: { action: 'ledger.earningSkipped' },
    })
    expect(skipped.entityId).toBe(task.id)
    expect(auditPayload(skipped).reason).toBe('no-assignee')
    expect(auditPayload(skipped).taskValue).toBe('1500.00')
  })

  it('مهمة قيمتها صفر: السبب مذكور ومعه المنفّذ الذي لم يُصرف له', async () => {
    // A zero-value task is normal (internal work), so the skip must not read
    // like a fault — but the منفّذ has to be named, otherwise "I finished four
    // tasks and got paid for three" has no paper trail behind it.
    const { task, worker, actor } = await approvalScenario({ taskValue: '0.00' })

    await approveTask(db, {
      actor,
      now: NOW,
      events,
      input: { taskId: task.id, qualityRating: 4 },
    })

    expect(await db.ledgerEntry.count()).toBe(0)
    const skipped = await db.auditLog.findFirstOrThrow({
      where: { action: 'ledger.earningSkipped' },
    })
    expect(auditPayload(skipped).reason).toBe('zero-value')
    expect(auditPayload(skipped).assigneeId).toBe(worker.id)
  })
})

describe('modules/payout — دورة فارغة', () => {
  it('إغلاق دورة بلا منفّذين ولا قيود ينجح ويفتح التالية', async () => {
    // The first close of a brand-new installation, and the shape of every
    // month a small agency has no movements in. A close that threw here would
    // stop the scheduler and take the next month's cycle with it.
    const result = await closeCycle(db, {
      actor: null,
      now: AUGUST_CLOSE,
      cycleDay: CYCLE_DAY,
    })

    expect(result.closed).toBe(true)
    expect(result.payoutsCreated).toBe(0)
    expect(result.salaryEntries).toBe(0)
    expect(await db.payout.count()).toBe(0)
    expect(await db.auditLog.count({ where: { action: 'payout.drafted' } })).toBe(0)
    const next = await db.payoutCycle.findUniqueOrThrow({
      where: { id: result.nextCycleId! },
    })
    expect(next.status).toBe('OPEN')
  })

  it('دورة بلا حركة وكل الأرصدة صفر لا تولّد مستحقًا واحدًا', async () => {
    // A payout for somebody who is owed nothing and moved nothing is noise in
    // the approval queue every single month, forever, for every منفّذ who ever
    // worked here.
    const actor = await manager()
    const worker = await createUser(db)
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
      amount: '-1000.00',
    })
    await closeCycle(db, { actor, now: AUGUST_CLOSE, cycleDay: CYCLE_DAY })

    const september = await closeCycle(db, {
      actor,
      now: SEPTEMBER_CLOSE,
      cycleDay: CYCLE_DAY,
    })

    expect(september.closed).toBe(true)
    expect(september.payoutsCreated).toBe(0)
    expect(await db.payout.count({ where: { cycleId: september.cycleId! } })).toBe(0)
  })

  it('من تعادلت حركاته داخل الدورة يأخذ كشفًا بصفر لا عدمًا', async () => {
    // The other half of the previous test, and the line between them: having
    // *no* movements is silence, but having movements that cancel out is a
    // month the منفّذ needs to see explained — they earned 1000 and lost 1000.
    const actor = await manager()
    const worker = await createUser(db)
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
      amount: '-1000.00',
    })

    await closeCycle(db, { actor, now: AUGUST_CLOSE, cycleDay: CYCLE_DAY })

    const payout = await db.payout.findFirstOrThrow({ where: { userId: worker.id } })
    expect(payout.net.toFixed(2)).toBe('0.00')
    expect(payout.gross.toFixed(2)).toBe('1000.00')
    expect(payout.penalties.toFixed(2)).toBe('1000.00')
  })
})

describe('modules/ledger — منفّذ محذوف أو غير موجود', () => {
  const DEPARTED_AT = cairo('2026-08-01T09:00')

  it('لا يُصرف لمن حُذف حسابه، ويُسجَّل الرصيد المعلّق باسمه', async () => {
    // Invariant 8 keeps soft-deleted rows out of every query, but money owed to
    // somebody who has left is not something to discover a year later. The
    // audit row is the only place that debt stays visible.
    const actor = await manager()
    const departed = await createUser(db, { deletedAt: DEPARTED_AT })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: departed.id,
      amount: '500.00',
    })

    const result = await closeCycle(db, { actor, now: AUGUST_CLOSE, cycleDay: CYCLE_DAY })

    expect(result.payoutsCreated).toBe(0)
    expect(await db.payout.count()).toBe(0)
    const skipped = await db.auditLog.findFirstOrThrow({
      where: { action: 'payout.skippedDeletedUser', entityId: departed.id },
    })
    expect(auditPayload(skipped).balance).toBe('500.00')
  })

  it('محذوف رصيده صفر لا يُسجَّل أصلًا', async () => {
    // Silence is the right answer only when there is nothing owed. Auditing
    // every departed منفّذ every month would bury the one who is owed 500.
    const actor = await manager()
    const departed = await createUser(db, { deletedAt: DEPARTED_AT })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: departed.id,
      type: 'EARNING',
      amount: '400.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: departed.id,
      type: 'PENALTY',
      amount: '-400.00',
    })

    await closeCycle(db, { actor, now: AUGUST_CLOSE, cycleDay: CYCLE_DAY })

    expect(await db.payout.count()).toBe(0)
    expect(
      await db.auditLog.count({ where: { action: 'payout.skippedDeletedUser' } }),
    ).toBe(0)
  })

  it('يرفض قيدًا جديدًا لمنفّذ محذوف', async () => {
    // Soft-delete is respected on the write side too: a departed منفّذ's
    // history stays readable, but nothing new may accrue to it.
    const actor = await manager()
    const departed = await createUser(db, { deletedAt: DEPARTED_AT })

    await expect(
      appendEntry(db, {
        userId: departed.id,
        type: 'BONUS',
        amount: '100.00',
        note: 'مكافأة نهاية الخدمة',
        actor,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(await db.ledgerEntry.count()).toBe(0)
    // Refused before anything was written — including the cycle the entry would
    // have been attached to.
    expect(await db.payoutCycle.count()).toBe(0)
  })

  it('يرفض قيدًا لمستخدم غير موجود أصلًا', async () => {
    // A read for an unknown id answers '0.00'; a write must not answer at all.
    // This is the shape a stale id in a queued job arrives in.
    await expect(
      appendEntry(db, {
        userId: 'ghost',
        type: 'PENALTY',
        amount: '-100.00',
        note: 'خصم تأخير',
        actor: null,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(await db.ledgerEntry.count()).toBe(0)
  })
})
