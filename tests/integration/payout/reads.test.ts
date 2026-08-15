import { describe, expect, it } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import { clearJobs, registeredJobs } from '@/lib/scheduler'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { CLOSE_CYCLE_JOB_NAME, registerPayoutJobs } from '@/modules/payout/job'
import {
  approvePayout,
  closeCycle,
  getPayout,
  listCycles,
  listPayouts,
  listStatements,
  markPayoutPaid,
} from '@/modules/payout/service'

import {
  createLedgerEntry,
  createPayout,
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
const METHODS = SETTINGS_CATALOG['payout.paymentMethods'].default
const IN_AUGUST = cairo('2026-08-10T09:00')
const CLOSE_AT = cairo('2026-08-28T23:59')

/**
 * The read paths behind `/payouts` and the cycle history on مستحقاتي.
 *
 * Two of them carry a soft-delete rule that has to match (invariant 8): a cycle
 * total that includes a departed منفّذ's payout while the table below it hides
 * that row gives a finance user a number no combination of what they can see
 * adds up to.
 */
async function manager() {
  await seedPermissionCatalog(db)
  const user = await createUserWithPermissions(db, [
    'payout.generate',
    'payout.approve',
    'payout.markPaid',
  ])
  return actorFor(db, user.id)
}

async function closedCycleWithPayouts() {
  const actor = await manager()
  const [first, second] = [await createUser(db), await createUser(db)]
  await createLedgerEntry(db, {
    createdAt: IN_AUGUST,
    userId: first.id,
    amount: '1000.00',
  })
  await createLedgerEntry(db, {
    createdAt: IN_AUGUST,
    userId: second.id,
    amount: '600.00',
  })
  const closed = await closeCycle(db, { actor, now: CLOSE_AT, cycleDay: CYCLE_DAY })
  return { actor, first, second, cycleId: closed.cycleId! }
}

describe('modules/payout — قراءة المستحقات', () => {
  it('يسرد مستحقات دورة مع بيانات المنفّذ والمتبقي', async () => {
    const { cycleId, first } = await closedCycleWithPayouts()

    const payouts = await listPayouts(db, { cycleId })

    expect(payouts).toHaveLength(2)
    const mine = payouts.find((payout) => payout.userId === first.id)
    expect(mine?.user?.fullName).toBeTruthy()
    expect(mine?.net).toBe('1000.00')
    expect(mine?.outstanding).toBe('1000.00')
    expect(mine?.status).toBe('DRAFT')
  })

  it('يصفّي بالمنفّذ وبالحالة', async () => {
    const { actor, cycleId, first } = await closedCycleWithPayouts()
    const payout = await db.payout.findFirstOrThrow({ where: { userId: first.id } })
    await approvePayout(db, { payoutId: payout.id, actor, now: CLOSE_AT })

    expect(await listPayouts(db, { userId: first.id })).toHaveLength(1)
    expect(await listPayouts(db, { cycleId, status: 'APPROVED' })).toHaveLength(1)
    expect(await listPayouts(db, { cycleId, status: 'DRAFT' })).toHaveLength(1)
  })

  it('يحترم نطاق القارئ حين يُمرَّر', async () => {
    const { cycleId, first } = await closedCycleWithPayouts()
    expect(await listPayouts(db, { cycleId, scope: { userId: first.id } })).toHaveLength(
      1,
    )
  })

  it('يخفي مستحقات منفّذ محذوف', async () => {
    const { cycleId, first } = await closedCycleWithPayouts()
    await db.user.update({
      where: { id: first.id },
      data: { deletedAt: cairo('2026-08-29T09:00') },
    })

    expect(await listPayouts(db, { cycleId })).toHaveLength(1)
  })

  it('يُرجع المستحق الواحد ويرفض المعرّف المجهول', async () => {
    const { first } = await closedCycleWithPayouts()
    const row = await db.payout.findFirstOrThrow({ where: { userId: first.id } })

    expect((await getPayout(db, row.id)).id).toBe(row.id)
    await expect(getPayout(db, 'nope')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/payout — قراءة الدورات', () => {
  it('يسرد الدورات من الأحدث مع إجماليّاتها وعددها', async () => {
    const { actor, cycleId, first } = await closedCycleWithPayouts()
    const payout = await db.payout.findFirstOrThrow({ where: { userId: first.id } })
    await approvePayout(db, { payoutId: payout.id, actor, now: CLOSE_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '400.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: cairo('2026-08-29T10:00'),
    })

    const cycles = await listCycles(db)

    // Newest first: the cycle the close opened comes before the one it closed.
    expect(cycles[0]?.status).toBe('OPEN')
    const closed = cycles.find((cycle) => cycle.id === cycleId)
    expect(closed?.payoutCount).toBe(2)
    expect(closed?.totalNet).toBe('1600.00')
    expect(closed?.totalPaid).toBe('400.00')
    expect(closed?.closedById).toBe(actor.id)
  })

  it('الدورة بلا مستحقات تُرجع أصفارًا لا فراغًا', async () => {
    await createPayoutCycle(db, { status: 'CLOSED' })

    const [cycle] = await listCycles(db)
    expect(cycle?.payoutCount).toBe(0)
    expect(cycle?.totalNet).toBe('0.00')
    expect(cycle?.totalPaid).toBe('0.00')
  })

  it('لا تحتسب الإجماليات مستحق منفّذ محذوف', async () => {
    // The counterpart of the `listPayouts` filter above: a total that counts a
    // row the table hides is a number nobody can reconcile on screen.
    const { cycleId, first } = await closedCycleWithPayouts()
    await db.user.update({
      where: { id: first.id },
      data: { deletedAt: cairo('2026-08-29T09:00') },
    })

    const closed = (await listCycles(db)).find((cycle) => cycle.id === cycleId)
    expect(closed?.payoutCount).toBe(1)
    expect(closed?.totalNet).toBe('600.00')
  })

  it('يحدّ عدد الدورات المطلوبة', async () => {
    await createPayoutCycle(db, { status: 'CLOSED' })
    await createPayoutCycle(db, {
      status: 'CLOSED',
      periodStart: cairo('2026-06-28T23:59'),
      periodEnd: cairo('2026-07-28T23:59'),
    })

    expect(await listCycles(db, { limit: 1 })).toHaveLength(1)
    // Out-of-range limits are clamped, not trusted.
    expect((await listCycles(db, { limit: 9999 })).length).toBeLessThanOrEqual(60)
  })
})

describe('modules/payout — كشوف المنفّذ', () => {
  it('يُرجع مستحقات المنفّذ مع فترة كل دورة', async () => {
    const { first, cycleId } = await closedCycleWithPayouts()

    const statements = await listStatements(db, { userId: first.id })

    expect(statements).toHaveLength(1)
    expect(statements[0]?.payout.net).toBe('1000.00')
    expect(statements[0]?.cycle.id).toBe(cycleId)
    expect(statements[0]?.cycle.status).toBe('CLOSED')
    expect(statements[0]?.cycle.closedAt).toEqual(CLOSE_AT)
  })

  it('يُرجع قائمة فارغة لمن لا مستحقات له', async () => {
    const worker = await createUser(db)
    expect(await listStatements(db, { userId: worker.id })).toEqual([])
  })

  it('لا يُظهر كشوف غيره', async () => {
    const { first, second } = await closedCycleWithPayouts()
    const statements = await listStatements(db, { userId: second.id })

    expect(statements).toHaveLength(1)
    expect(statements[0]?.payout.userId).toBe(second.id)
    expect(statements.every((statement) => statement.payout.userId !== first.id)).toBe(
      true,
    )
  })

  it('يحدّ عدد الكشوف المطلوبة', async () => {
    const worker = await createUser(db)
    const cycle = await createPayoutCycle(db, { status: 'CLOSED' })
    await createPayout(db, { userId: worker.id, cycleId: cycle.id, net: '10.00' })

    expect(await listStatements(db, { userId: worker.id, limit: 1 })).toHaveLength(1)
  })
})

describe('modules/payout — أثر العنوان في سجل التدقيق', () => {
  it('يحمل عنوان IP في كل خطوة يقوم بها إنسان', async () => {
    // CLAUDE.md invariant 7 wants an audit row for everything that touches
    // money; a compliance reviewer asking "from where" needs the column filled
    // in on the *human* steps. The scheduler has no IP, which is why the
    // parameter is optional — and why the filled-in case needs a test of its own.
    const actor = await manager()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '500.00',
    })
    const ip = '197.51.100.24'

    const closed = await closeCycle(db, {
      actor,
      now: CLOSE_AT,
      cycleDay: CYCLE_DAY,
      ip,
    })
    const payout = await db.payout.findFirstOrThrow({
      where: { cycleId: closed.cycleId! },
    })
    await approvePayout(db, { payoutId: payout.id, actor, now: CLOSE_AT, ip })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '500.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
      now: cairo('2026-08-29T10:00'),
      ip,
    })

    const actions = await db.auditLog.findMany({
      where: { ip },
      select: { action: true },
    })
    const names = actions.map((row) => row.action)
    expect(names).toContain('payout.cycleClosed')
    expect(names).toContain('payout.drafted')
    expect(names).toContain('payout.approved')
    expect(names).toContain('payout.paid')
    // The PAYOUT ledger entry the payment appended carries it too.
    expect(names).toContain('ledger.entryCreated')
  })
})

describe('modules/payout — اللحظة الافتراضية', () => {
  it('يعتمد ويصرف بساعة النظام حين لا تُمرَّر لحظة', async () => {
    // Every other test injects `now` so its assertions are about the calendar
    // rather than about the clock. The default path is what the server actions
    // fall back to, and an approval that recorded no time at all would leave
    // "when was this approved" unanswerable.
    const { actor, first } = await closedCycleWithPayouts()
    const payout = await db.payout.findFirstOrThrow({ where: { userId: first.id } })

    const approved = await approvePayout(db, { payoutId: payout.id, actor })
    expect(approved.approvedAt).not.toBeNull()

    const paid = await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '1000.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor,
      cycleDay: CYCLE_DAY,
    })
    expect(paid.status).toBe('PAID')
    expect(paid.paidAt).not.toBeNull()
  })
})

describe('modules/payout — تسجيل المهمة المجدولة', () => {
  it('يسجّل إغلاق الدورة في الجدولة مرة واحدة', () => {
    // `src/instrumentation.ts` calls this on boot. A job that is never
    // registered is a cycle that never closes by itself, and nothing else in
    // the product would notice.
    clearJobs()
    registerPayoutJobs()

    const names = registeredJobs().map((job) => job.name)
    expect(names).toContain(CLOSE_CYCLE_JOB_NAME)
    expect(names.filter((name) => name === CLOSE_CYCLE_JOB_NAME)).toHaveLength(1)
    clearJobs()
  })
})
