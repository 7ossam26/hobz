import { describe, expect, it, vi } from 'vitest'

import { calendarFor } from '@/lib/calendar'
import { ForbiddenError } from '@/lib/errors'

import {
  createLedgerEntry,
  createPayout,
  createPayoutCycle,
  createProject,
  createStatusActivity,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import {
  CYCLE_DAY,
  PENALTY_DEFAULTS,
  penaltyRows,
  recompute,
} from '../../helpers/penalty'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const { deductionsReport, listMoneyRegister, taskPenaltyPanel } =
  await import('@/modules/penalty/register')
const { getMoneyRegister, getTaskPenaltyPanel, getDeductionsReport } =
  await import('@/modules/penalty/queries')
const { grantBonus, createManualPenalty, reversePenaltyOrBonus } =
  await import('@/modules/penalty/service')

/**
 * The manager's register, the task sheet's panel, and SPEC R4's report —
 * phase brief items 9 and 10.
 *
 * Every figure on all three is a `SUM` over `ledger_entries` (CLAUDE.md
 * invariant 1). Nothing is cached and there is no "total penalties" column
 * anywhere, which is what makes the register, the task sheet, the منفّذ's
 * statement and the payout breakdown incapable of disagreeing. These tests are
 * what would notice if somebody added one.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NOW = cairo('2026-03-05T12:00')
const IN_MARCH = cairo('2026-03-10T09:00')
const IN_APRIL = cairo('2026-04-10T09:00')

/** The canonical scenario: 3 working days late on a 1000.00 task → 150.00. */
async function agency() {
  await seedPermissionCatalog(db)
  const owner = await createUser(db)
  const boss = await createUserWithPermissions(db, [
    'penalty.view',
    'penalty.create',
    'penalty.reverse',
    'bonus.create',
    'report.view',
    'ledger.view.own',
  ])
  const actor = await actorFor(db, boss.id)
  const worker = await createUser(db, { payType: 'PER_TASK', fullName: 'سلمى' })
  const project = await createProject(db, { ownerId: owner.id, name: 'موقع العميل' })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'IN_PROGRESS',
    taskValue: '1000.00',
    dueDate: DUE,
    originalDueDate: DUE,
  })
  return { owner, actor, worker, project, task }
}

const panelFor = (taskId: string) =>
  taskPenaltyPanel(db, {
    taskId,
    calendar: calendarFor(db),
    settings: PENALTY_DEFAULTS,
    now: NOW,
  })

describe('سجل الخصومات والمكافآت', () => {
  it('يجمع الخصومات والمكافآت مع مجاميع على كامل النتيجة لا على الصفحة', async () => {
    const { actor, worker, task } = await agency()
    await recompute(db, task.id, { now: NOW })
    await grantBonus(db, {
      userId: worker.id,
      amount: '400.00',
      reason: 'إنجاز مبكر',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })

    const page = await listMoneyRegister(db, { page: 1, pageSize: 50 })

    expect(page.total).toBe(2)
    expect(page.totalPenalties).toBe('150.00')
    expect(page.totalBonuses).toBe('400.00')
    expect(page.totalReversed).toBe('0.00')
    expect(page.netPenalties).toBe('150.00')
    // Magnitudes, not signs: the register prints them beside the words خصم and
    // مكافأة, and the direction is the row's kind.
    expect(page.items.map((row) => row.amount).sort()).toEqual(['150.00', '400.00'])
  })

  /**
   * A month with 10,000 deducted and 9,000 reversed is a completely different
   * month from one with 1,000 deducted. Netting them silently would make the
   * two identical on screen — and would hide a manager and the engine pulling
   * in opposite directions.
   */
  it('يعرض المعكوس بجانب الإجمالي، لا مطروحًا منه بصمت', async () => {
    const { actor, task } = await agency()
    await recompute(db, task.id, { now: NOW })
    const [entry] = await penaltyRows(db, task.id)
    await reversePenaltyOrBonus(db, {
      entryId: entry!.id,
      reason: 'العميل هو من تأخر',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })

    const page = await listMoneyRegister(db, { page: 1, pageSize: 50 })

    expect(page.totalPenalties).toBe('150.00')
    expect(page.totalReversed).toBe('150.00')
    expect(page.netPenalties).toBe('0.00')
    expect(page.items[0]?.reversalReason).toBe('العميل هو من تأخر')
  })

  it('يرشّح بالنوع وبالمنفّذ وبالتلقائي وبالمعكوس', async () => {
    const { actor, worker, task, project } = await agency()
    await recompute(db, task.id, { now: NOW })
    await createManualPenalty(db, {
      userId: worker.id,
      amount: '60.00',
      reason: 'غياب دون إخطار',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })
    await grantBonus(db, {
      userId: worker.id,
      amount: '400.00',
      reason: 'إنجاز مبكر',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })
    const other = await createUser(db)
    await createLedgerEntry(db, {
      userId: other.id,
      type: 'PENALTY',
      amount: '-10.00',
      createdAt: IN_MARCH,
    })

    const q = (over: Record<string, unknown>) =>
      listMoneyRegister(db, { page: 1, pageSize: 50, ...over })

    expect((await q({ kind: 'BONUS' })).total).toBe(1)
    expect((await q({ kind: 'PENALTY' })).total).toBe(3)
    expect((await q({ userId: worker.id })).total).toBe(3)
    expect((await q({ automatic: 'auto' })).total).toBe(1)
    expect((await q({ automatic: 'manual' })).total).toBe(3)
    expect((await q({ reversed: 'standing' })).total).toBe(4)
    expect((await q({ reversed: 'reversed' })).total).toBe(0)
    expect((await q({ taskId: task.id })).total).toBe(1)
    expect((await q({ projectId: project.id })).total).toBe(1)
    expect((await q({ from: IN_APRIL })).total).toBe(0)
    expect((await q({ to: IN_APRIL })).total).toBe(4)
  })

  it('يصفّح ويرتّب الأحدث أولًا', async () => {
    const { worker } = await agency()
    for (let i = 0; i < 5; i += 1) {
      await createLedgerEntry(db, {
        userId: worker.id,
        type: 'PENALTY',
        amount: `-${String(i + 1)}0.00`,
        createdAt: new Date(IN_MARCH.getTime() + i * 60_000),
      })
    }

    const first = await listMoneyRegister(db, { page: 1, pageSize: 2 })
    const second = await listMoneyRegister(db, { page: 2, pageSize: 2 })

    expect(first.items).toHaveLength(2)
    expect(first.total).toBe(5)
    expect(first.items[0]?.amount).toBe('50.00')
    expect(second.items[0]?.amount).toBe('30.00')
  })

  it('penalty.view مطلوب لفتح السجل', async () => {
    await seedPermissionCatalog(db)
    const nobody = await createUserWithPermissions(db, ['ledger.view.own'])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(getMoneyRegister({})).rejects.toBeInstanceOf(ForbiddenError)

    clearSessionActor()
  })

  it('لا يعرض حركات منفّذ محذوف', async () => {
    const { actor, worker } = await agency()
    await createManualPenalty(db, {
      userId: worker.id,
      amount: '60.00',
      reason: 'سبب',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })
    await db.user.update({
      where: { id: worker.id },
      data: { deletedAt: cairo('2026-03-20T09:00') },
    })

    setSessionActor(actor)
    const page = await getMoneyRegister({})
    clearSessionActor()

    // Soft-delete is respected in every query (CLAUDE.md invariant 8). The
    // entry itself has no `deletedAt` — it is append-only — so the guard sits
    // on the منفّذ it belongs to.
    expect(page.total).toBe(0)
  })
})

describe('لوحة الخصم داخل ورقة المهمة', () => {
  it('تعيد حساب الرقم الحيّ دون أن تكتب شيئًا', async () => {
    const { task } = await agency()

    const panel = await panelFor(task.id)

    expect(panel.currentStatus).toBe('DUE')
    expect(panel.current?.amount).toBe('150.00')
    expect(panel.entries).toEqual([])
    expect(panel.totalCharged).toBe('0.00')
    // Looking at a deduction must never create one.
    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('تسمّي كل قيد بجولته وتجمّد ما سبق المراجعة', async () => {
    const { task } = await agency()
    await recompute(db, task.id, { now: NOW })

    await createStatusActivity(db, {
      taskId: task.id,
      from: 'IN_REVIEW',
      to: 'REVISION_REQUESTED',
      at: cairo('2026-03-06T10:00'),
    })
    await db.task.update({
      where: { id: task.id },
      data: {
        status: 'SUBMITTED',
        dueDate: cairo('2026-03-15T17:00'),
        submittedAt: cairo('2026-03-19T10:00'),
      },
    })
    await recompute(db, task.id, { now: cairo('2026-03-20T03:00') })

    const panel = await taskPenaltyPanel(db, {
      taskId: task.id,
      calendar: calendarFor(db),
      settings: PENALTY_DEFAULTS,
      now: cairo('2026-03-20T03:00'),
    })

    expect(panel.revisionCount).toBe(1)
    expect(panel.totalCharged).toBe('300.00')
    // Newest first: the revision's live entry, then the sealed original.
    expect(panel.entries.map((e) => e.roundIndex)).toEqual([1, 0])
    expect(panel.entries.map((e) => e.isCurrentRound)).toEqual([true, false])
  })

  it('الخصم اليدوي بلا جولة — لأنه ليس تراكمًا على موعد', async () => {
    const { actor, worker, task } = await agency()
    await createManualPenalty(db, {
      userId: worker.id,
      taskId: task.id,
      amount: '60.00',
      reason: 'تسليم ناقص',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })

    const panel = await panelFor(task.id)

    expect(panel.entries[0]?.roundIndex).toBeNull()
    expect(panel.entries[0]?.isCurrentRound).toBe(false)
    expect(panel.totalCharged).toBe('60.00')
  })

  it('تقول سبب غياب الرقم بدل أن تعرض صفرًا', async () => {
    const { owner } = await agency()
    const project = await createProject(db, { ownerId: owner.id })
    const unassigned = await createTask(db, {
      projectId: project.id,
      assigneeId: null,
      status: 'BACKLOG',
      dueDate: DUE,
      originalDueDate: DUE,
    })

    const panel = await panelFor(unassigned.id)

    expect(panel.currentStatus).toBe('NO_ASSIGNEE')
    expect(panel.current).toBeNull()
  })

  it('المنفّذ يقرأ تفصيل مهمته، وغيره لا', async () => {
    const { worker, task } = await agency()
    await seedPermissionCatalog(db)

    const own = await createUserWithPermissions(db, ['ledger.view.own'])
    await db.task.update({ where: { id: task.id }, data: { assigneeId: own.id } })
    setSessionActor(await actorFor(db, own.id))
    // SPEC §5.4 gives a منفّذ no way to contest a deduction in-system, so the
    // arithmetic is the entire recourse they have.
    expect((await getTaskPenaltyPanel({ taskId: task.id })).taskId).toBe(task.id)
    clearSessionActor()

    const stranger = await createUserWithPermissions(db, ['ledger.view.own'])
    setSessionActor(await actorFor(db, stranger.id))
    await expect(getTaskPenaltyPanel({ taskId: task.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    clearSessionActor()
    expect(worker.id).toBeTruthy()
  })
})

describe('تقرير الخصومات كإيراد (SPEC R4)', () => {
  async function twoMonths() {
    const { actor, worker, project, task } = await agency()
    await recompute(db, task.id, { now: NOW })
    const [entry] = await penaltyRows(db, task.id)
    await reversePenaltyOrBonus(db, {
      entryId: entry!.id,
      reason: 'اعتُمد تمديد',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })
    await createManualPenalty(db, {
      userId: worker.id,
      amount: '80.00',
      reason: 'غياب',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })
    await createManualPenalty(db, {
      userId: worker.id,
      amount: '20.00',
      reason: 'غياب',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_APRIL,
    })
    return { actor, worker, project }
  }

  const range = { from: cairo('2026-01-01T00:00'), to: cairo('2026-05-01T00:00') }

  it('يجمّع بالشهر ويفصل المعكوس عن الإجمالي', async () => {
    await twoMonths()

    const report = await deductionsReport(db, { ...range, groupBy: 'month' })

    expect(report.rows.map((r) => r.key)).toEqual(['2026-03', '2026-04'])
    expect(report.rows[0]).toMatchObject({
      penalties: '230.00',
      reversed: '150.00',
      net: '80.00',
      count: 2,
    })
    expect(report.rows[1]).toMatchObject({ penalties: '20.00', net: '20.00', count: 1 })
    expect(report.totalPenalties).toBe('250.00')
    expect(report.totalReversed).toBe('150.00')
    expect(report.totalNet).toBe('100.00')
  })

  it('يجمّع بالمنفّذ وبالمشروع وبدورة الصرف', async () => {
    const { worker, project } = await twoMonths()

    const byWorker = await deductionsReport(db, { ...range, groupBy: 'worker' })
    expect(byWorker.rows).toHaveLength(1)
    expect(byWorker.rows[0]?.key).toBe(worker.id)
    expect(byWorker.rows[0]?.label).toBe('سلمى')

    const byProject = await deductionsReport(db, { ...range, groupBy: 'project' })
    // The automatic penalty carries a task; the two manual ones do not, so they
    // bucket under "no project" rather than being silently dropped.
    expect(byProject.rows.map((r) => r.key).sort()).toEqual([project.id, 'none'].sort())

    const byCycle = await deductionsReport(db, { ...range, groupBy: 'cycle' })
    expect(byCycle.rows.length).toBeGreaterThan(0)
  })

  it('الفترة نصف مفتوحة: الحد الأعلى مستبعَد', async () => {
    await twoMonths()

    const marchOnly = await deductionsReport(db, {
      from: cairo('2026-03-01T00:00'),
      to: cairo('2026-04-01T00:00'),
      groupBy: 'month',
    })

    expect(marchOnly.rows.map((r) => r.key)).toEqual(['2026-03'])
    expect(marchOnly.totalPenalties).toBe('230.00')
  })

  it('فترة فارغة تعطي صفرًا لا خطأ', async () => {
    await twoMonths()

    const empty = await deductionsReport(db, {
      from: cairo('2027-01-01T00:00'),
      to: cairo('2027-02-01T00:00'),
      groupBy: 'month',
    })

    expect(empty.rows).toEqual([])
    expect(empty.totalNet).toBe('0.00')
  })

  it('report.view مطلوب', async () => {
    await seedPermissionCatalog(db)
    const nobody = await createUserWithPermissions(db, ['penalty.view'])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(
      getDeductionsReport({ from: range.from, to: range.to, groupBy: 'month' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    clearSessionActor()
  })

  it('المكافآت ليست خصومات ولا تدخل التقرير', async () => {
    const { actor, worker } = await agency()
    await grantBonus(db, {
      userId: worker.id,
      amount: '400.00',
      reason: 'إنجاز',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_MARCH,
    })

    const report = await deductionsReport(db, { ...range, groupBy: 'month' })

    // SPEC R4 is about deductions as agency *income*. A bonus is money going
    // the other way, and folding it in would be the margin arithmetic SPEC §1
    // forbids, wearing a different name.
    expect(report.totalPenalties).toBe('0.00')
  })
})

describe('القيد في دورة مصروفة لا يُعاد حسابه', () => {
  it('يتوقّف ويسجّل بدل أن يخصم مرتين', async () => {
    const { worker, task } = await agency()
    const cycle = await createPayoutCycle(db, {
      periodStart: cairo('2026-02-28T00:00'),
      periodEnd: cairo('2026-03-28T23:59'),
      status: 'CLOSED',
    })
    await createLedgerEntry(db, {
      userId: worker.id,
      taskId: task.id,
      type: 'PENALTY',
      amount: '-150.00',
      isAutoGenerated: true,
      cycleId: cycle.id,
      createdAt: NOW,
    })
    await createPayout(db, {
      userId: worker.id,
      cycleId: cycle.id,
      status: 'PAID',
      net: '500.00',
      paidAmount: '500.00',
    })

    // Three more working days would take the figure to 200.00 — but the old
    // 150.00 cannot be reversed, and inserting the new one alone would charge
    // this منفّذ 350.00 for one late delivery.
    const outcome = await recompute(db, task.id, { now: cairo('2026-03-08T12:00') })

    expect(outcome.outcome).toBe('skipped')
    expect(outcome.skipReason).toBe('not-penalisable')
    expect(outcome.amount).toBe('150.00')
    expect(await penaltyRows(db, task.id)).toHaveLength(1)

    const audit = await db.auditLog.findFirst({
      where: { action: 'ledger.reversalBlocked' },
    })
    expect((audit?.after as { reason?: string })?.reason).toBe('cycle-already-paid')
  })
})
