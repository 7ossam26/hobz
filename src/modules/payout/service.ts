import { ar } from '@/i18n/ar'
import { recordAudit, type AuditActorRef } from '@/lib/audit'
import { cairoDateKeyOfParts, cairoInstant, cairoParts } from '@/lib/calendar/cairo'
import type { Db } from '@/lib/db'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import {
  add,
  clampAtZero,
  gt,
  gte,
  isNegative,
  isPositive,
  isZero,
  negate,
  round2,
  sub,
  toMoney,
  toStorageString,
  zero,
  type Money,
  type MoneyInput,
} from '@/lib/money'
import { monthlySalaryOf } from '@/modules/ledger/pay-profile'
import { appendEntry, isUniqueViolation, moneyOf } from '@/modules/ledger/service'
import type { LedgerType } from '@/modules/ledger/sign'

import { ensureOpenCycle, CYCLE_SELECT, type CycleRow } from './cycle'
import { noopPayoutEvents, type PayoutEventBus } from './ports'
import type {
  CloseCycleResult,
  PayoutCycleDto,
  PayoutDto,
  PayoutStatementDto,
  PayoutStatus,
} from './types'

/**
 * modules/payout/service — SPEC §5.5.
 *
 * ── The one design decision everything else follows from ──────────────────
 *
 * SPEC §5.5 says `net = SUM(all unpaid ledger entries in period)`. This module
 * reads that as **`net = clampAtZero(balance at the moment of close)`**, and the
 * two agree exactly whenever the previous cycle was paid in full. Where they
 * differ, the balance is the correct one, and it is the reading that makes three
 * separate requirements need no code at all:
 *
 *  - "A payout can never be negative — the surplus carries forward as a debit
 *    balance into the next cycle" (phase brief item 8). The clamp is the whole
 *    of it; the surplus is simply a balance that stays negative.
 *  - "Advances settle automatically at month-end because balance is a sum — do
 *    not write special-case deduction code" (item 5). Nothing here mentions
 *    advances.
 *  - "Partial payment: remainder stays outstanding" (item 8). Each payment
 *    appends a negative `PAYOUT` entry, so what was not paid is still in the
 *    balance and turns up next month by itself.
 *
 * A per-period net would have needed bespoke carry-forward code for each of
 * those three, and a bug in any one of them loses somebody's money quietly.
 *
 * The five breakdown columns describe *this cycle's movements*; `carriedForward`
 * is whatever the balance was before them. So the statement always reconciles:
 *
 *     net = max(0, carriedForward + gross − penalties + bonuses − advances + adjustments)
 */

/**
 * Cairo month bounds. Via `lib/calendar/cairo` rather than `Date.getMonth()`,
 * which would answer in the runner's timezone and put a 01:00-Cairo salary in
 * the previous month for anybody running the app outside Egypt.
 */
function startOfCairoMonth(at: Date): Date {
  const { year, month } = cairoParts(at)
  return cairoInstant(cairoDateKeyOfParts(year, month, 1), 0)
}

const earlierOf = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b)

function startOfNextCairoMonth(at: Date): Date {
  const { year, month } = cairoParts(at)
  return cairoInstant(
    cairoDateKeyOfParts(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1),
    0,
  )
}

const PAYOUT_SELECT = {
  id: true,
  userId: true,
  cycleId: true,
  carriedForward: true,
  gross: true,
  penalties: true,
  bonuses: true,
  advances: true,
  adjustments: true,
  net: true,
  paidAmount: true,
  status: true,
  method: true,
  reference: true,
  note: true,
  approvedById: true,
  approvedAt: true,
  paidById: true,
  paidAt: true,
  createdAt: true,
  user: { select: { id: true, fullName: true, username: true } },
} as const

type DecimalLike = { toFixed(dp: number): string }

interface PayoutRow {
  id: string
  userId: string
  cycleId: string
  carriedForward: DecimalLike
  gross: DecimalLike
  penalties: DecimalLike
  bonuses: DecimalLike
  advances: DecimalLike
  adjustments: DecimalLike
  net: DecimalLike
  paidAmount: DecimalLike
  status: string
  method: string | null
  reference: string | null
  note: string | null
  approvedById: string | null
  approvedAt: Date | null
  paidById: string | null
  paidAt: Date | null
  createdAt: Date
  user?: { id: string; fullName: string; username: string } | null
}

function toPayoutDto(row: PayoutRow): PayoutDto {
  const net = moneyOf(row.net)
  const paid = moneyOf(row.paidAmount)

  return {
    id: row.id,
    userId: row.userId,
    cycleId: row.cycleId,
    user: row.user ?? null,
    carriedForward: row.carriedForward.toFixed(2),
    gross: row.gross.toFixed(2),
    penalties: row.penalties.toFixed(2),
    bonuses: row.bonuses.toFixed(2),
    advances: row.advances.toFixed(2),
    adjustments: row.adjustments.toFixed(2),
    net: net.toFixed(2),
    paidAmount: paid.toFixed(2),
    outstanding: toStorageString(sub(net, paid)),
    status: row.status as PayoutStatus,
    method: row.method,
    reference: row.reference,
    note: row.note,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt,
    paidById: row.paidById,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Closing a cycle
// ─────────────────────────────────────────────────────────────────────────────

export interface CloseCycleArgs {
  /** Null when the scheduler is closing it (SPEC §5.5's automatic close). */
  actor: AuditActorRef | null
  now: Date
  /** Settings `payout.cycleDay`. */
  cycleDay: number
  /** Close a specific cycle rather than whichever is open. */
  cycleId?: string
  /**
   * SPEC §5.5: a cycle is "also closeable early by permission". Default false,
   * so the unattended path — the scheduler — can never settle a cycle that has
   * not reached its `periodEnd`. Only the permissioned manual action sets it.
   */
  allowEarly?: boolean
  ip?: string
}

/**
 * SPEC §5.5's close, in five steps and one order that matters:
 *
 *  1. **Accrue salaries first**, into the cycle being closed — otherwise the
 *     payout that is about to be computed would not contain this month's pay.
 *  2. Mark the cycle CLOSED, moving `periodEnd` to the instant it actually
 *     closed so the stored period never claims time the cycle did not cover.
 *  3. Draft one payout per منفّذ who has movements or a balance.
 *  4. Audit.
 *  5. Open the next cycle, starting exactly where this one ended.
 *
 * Safe to run twice: a cycle that is not OPEN is reported as skipped, and every
 * write inside is guarded by a unique index besides.
 */
export async function closeCycle(
  db: Db,
  args: CloseCycleArgs,
): Promise<CloseCycleResult> {
  const ensured = args.cycleId
    ? ((await db.payoutCycle.findUnique({
        where: { id: args.cycleId },
        select: CYCLE_SELECT,
      })) as CycleRow | null)
    : await ensureOpenCycle(db, { now: args.now, cycleDay: args.cycleDay })

  if (!ensured) throw new NotFoundError('PayoutCycle', args.cycleId ?? '')

  const cycle: CycleRow = ensured
  const justCreated = (ensured as { created?: boolean }).created === true

  if (cycle.status !== 'OPEN') {
    return {
      closed: false,
      cycleId: cycle.id,
      nextCycleId: null,
      payoutsCreated: 0,
      salaryEntries: 0,
      skipped: 'already-closed',
    }
  }

  /**
   * ── The two guards that stop a second close from paying twice ────────────
   *
   * Closing opens the next cycle immediately. Without a guard, a second close —
   * a retried job, a double-clicked button, an advisory lock that queued two
   * callers instead of rejecting one — would settle a brand-new cycle covering
   * no elapsed time, drafting a second payout for money the first payout is
   * already about to pay.
   *
   * **Not started.** A cycle whose `periodStart` has not passed cannot be
   * closed. This catches the same-instant repeat exactly, including the one an
   * explicit early close would otherwise be allowed to make.
   *
   * **Not due.** A cycle that has not reached its `periodEnd` closes only when
   * the caller explicitly says so. The scheduler never does, so the unattended
   * path is closed to this class of bug entirely; the manual "close early"
   * action is a permissioned, confirmed, audited decision (SPEC §5.5).
   *
   * Both guards exempt a cycle *this very call* had to open. It has no elapsed
   * time and no meaningful `periodEnd` to be measured against, and refusing
   * would mean a first-ever close could never happen on a quiet system — the
   * salaried agency whose only movement each month is the accrual this close is
   * about to write.
   */
  if (!justCreated && args.now.getTime() <= cycle.periodStart.getTime()) {
    return {
      closed: false,
      cycleId: cycle.id,
      nextCycleId: null,
      payoutsCreated: 0,
      salaryEntries: 0,
      skipped: 'not-started',
    }
  }

  if (
    !justCreated &&
    args.now.getTime() < cycle.periodEnd.getTime() &&
    args.allowEarly !== true
  ) {
    return {
      closed: false,
      cycleId: cycle.id,
      nextCycleId: null,
      payoutsCreated: 0,
      salaryEntries: 0,
      skipped: 'not-due',
    }
  }

  const salaryEntries = await accrueSalaries(db, {
    cycle,
    actor: args.actor,
    now: args.now,
    cycleDay: args.cycleDay,
    ...(args.ip ? { ip: args.ip } : {}),
  })

  /**
   * `periodEnd` is the plan; `closedAt` is the fact. They are deliberately not
   * collapsed into one.
   *
   * An earlier version overwrote `periodEnd` with the close instant, on the
   * grounds that a period should never claim time it did not cover. That reads
   * well and quietly breaks the salary guard: a cycle closed late — the job
   * missed the 28th and somebody closed it on 1 September — would rewrite its
   * end into September, and September's own close would then see a September
   * salary and skip. The منفّذ loses a month's pay to a server that was down.
   *
   * Keeping the plan preserves *which month this cycle was for*, which is the
   * only question the accrual actually asks. The next cycle still starts at
   * `closedAt`, so no instant belongs to two cycles.
   */
  await db.payoutCycle.update({
    where: { id: cycle.id },
    data: {
      status: 'CLOSED',
      closedAt: args.now,
      closedById: args.actor?.id ?? null,
    },
  })

  const payoutsCreated = await draftPayouts(db, {
    cycle,
    closedAt: args.now,
    actor: args.actor,
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'payout.cycleClosed',
    entity: 'PayoutCycle',
    entityId: cycle.id,
    before: { status: 'OPEN', periodEnd: cycle.periodEnd },
    after: {
      status: 'CLOSED',
      closedAt: args.now,
      periodEnd: args.now,
      payoutsCreated,
      salaryEntries,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  // A cycle in which nobody was owed anything is settled the moment it closes.
  // Without this it would sit at CLOSED for ever, because the only other route
  // to PAID runs through a payment that is never going to happen.
  await settleCycleIfComplete(db, cycle.id, args.actor)

  const next = await ensureOpenCycle(db, { now: args.now, cycleDay: args.cycleDay })

  return {
    closed: true,
    cycleId: cycle.id,
    nextCycleId: next.id,
    payoutsCreated,
    salaryEntries,
    skipped: null,
  }
}

interface AccrueArgs {
  cycle: CycleRow
  actor: AuditActorRef | null
  now: Date
  cycleDay: number
  ip?: string
}

/**
 * SPEC §5.5: "Salaried workers get one `SALARY` entry per cycle. Approved leave
 * is paid."
 *
 * **The absence of proration is the feature.** Nothing here reads the calendar,
 * counts working days, or asks `modules/leave` anything — a salaried منفّذ on
 * approved leave for half the month is paid in full, which is what "approved
 * leave is paid" means. `tests/integration/payout/close.test.ts` asserts it, so
 * that the first person to reach for `workingDaysBetween` here is contradicted
 * by a failing test rather than by a comment.
 */
async function accrueSalaries(db: Db, args: AccrueArgs): Promise<number> {
  const workers = await db.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      isWorker: true,
      payType: { in: ['SALARY', 'HYBRID'] },
    },
    select: {
      id: true,
      fullName: true,
      payType: true,
      monthlySalary: true,
      defaultTaskRate: true,
    },
    orderBy: { id: 'asc' },
  })
  if (workers.length === 0) return 0

  /**
   * Already paid for this month?
   *
   * SPEC §5.5 says one `SALARY` entry per cycle, and the default cycle *is* a
   * month — but "monthly salary" is the stronger reading, and it is the one
   * that survives an operator closing twice in August. The per-cycle unique
   * index still holds; this is the wider net under it, and it is what protects
   * the largest number in the system.
   *
   * ── Why the window is over *cycles*, not over `createdAt` ────────────────
   *
   * The obvious version — "any SALARY stamped this Cairo month" — reads the
   * clock, and the clock is exactly what goes wrong. If the 28 August close is
   * missed (a server down, a failed job) and runs on 1 September, August's
   * salary is stamped September; the 28 September close then sees a September
   * salary and skips, and the منفّذ is never paid for September at all. A guard
   * that can cost somebody a month's pay is worse than the double payment it
   * prevents.
   *
   * Asking which *month a cycle was for* removes the clock from the question,
   * and that month is the **earlier of when the cycle was due and when it
   * actually ended** — `min(closedAt, periodEnd)`. Each half is load-bearing:
   *
   *  - `closedAt` alone puts a late-closed August into September, and costs
   *    September's salary.
   *  - `periodEnd` alone puts a cycle that was opened and closed on the same
   *    night into *next* month, because a freshly opened cycle's planned end is
   *    always a month out — which costs the following month's salary instead.
   *
   * Taking the earlier of the two is right in every case: an on-time close
   * (they are equal), an early close (the close is the answer), a late close
   * (the plan is), and a cycle born and settled in one call (the close again).
   */
  const anchor = earlierOf(args.now, args.cycle.periodEnd)
  const monthStart = startOfCairoMonth(anchor)
  const monthEnd = startOfNextCairoMonth(anchor)

  // Cycles are few — a couple of dozen in a lifetime — so the anchor is
  // computed in JS rather than contorted into a where-clause that cannot
  // express `min()`. The query narrows to the plausible ones first.
  const sameMonthCycles = (
    await db.payoutCycle.findMany({
      where: {
        id: { not: args.cycle.id },
        OR: [
          { closedAt: { gte: monthStart, lt: monthEnd } },
          { periodEnd: { gte: monthStart, lt: monthEnd } },
        ],
      },
      select: { id: true, closedAt: true, periodEnd: true },
    })
  )
    .filter((cycle) => {
      const at = earlierOf(cycle.closedAt ?? cycle.periodEnd, cycle.periodEnd)
      return at >= monthStart && at < monthEnd
    })
    .map((cycle) => cycle.id)

  const alreadyPaid =
    sameMonthCycles.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db.ledgerEntry.findMany({
              where: {
                type: 'SALARY',
                userId: { in: workers.map((w) => w.id) },
                cycleId: { in: sameMonthCycles },
              },
              select: { userId: true },
            })
          ).map((row) => row.userId),
        )

  let created = 0

  for (const worker of workers) {
    if (alreadyPaid.has(worker.id)) continue

    const salary = monthlySalaryOf(worker as never)

    if (salary === null || isZero(salary)) {
      await recordAudit(db, {
        actor: args.actor,
        action: 'payout.salarySkipped',
        entity: 'User',
        entityId: worker.id,
        after: {
          cycleId: args.cycle.id,
          reason: salary === null ? 'no-monthly-salary' : 'zero-monthly-salary',
        },
      })
      continue
    }

    const existing = await db.ledgerEntry.findFirst({
      where: { userId: worker.id, cycleId: args.cycle.id, type: 'SALARY' },
      select: { id: true },
    })
    if (existing) continue

    try {
      await appendEntry(db, {
        userId: worker.id,
        type: 'SALARY',
        amount: salary,
        note: ar.ledger.notes.salary,
        cycleId: args.cycle.id,
        cycleDay: args.cycleDay,
        isAutoGenerated: true,
        actor: args.actor,
        at: args.now,
        ...(args.ip ? { ip: args.ip } : {}),
      })
      created += 1
    } catch (error) {
      // `ledger_entries_one_salary_per_cycle` caught a concurrent run. That is
      // the index doing its job — the salary exists, which is the outcome asked
      // for.
      if (!isUniqueViolation(error)) throw error
    }
  }

  return created
}

interface DraftArgs {
  cycle: CycleRow
  closedAt: Date
  actor: AuditActorRef | null
  ip?: string
}

const CREDIT_MAGNITUDE: readonly LedgerType[] = ['EARNING', 'SALARY']

async function draftPayouts(db: Db, args: DraftArgs): Promise<number> {
  // Two grouped queries for the whole agency, not two per person.
  const [balanceRows, movementRows] = await Promise.all([
    db.ledgerEntry.groupBy({
      by: ['userId'],
      _sum: { amount: true },
      // `lte`, not `lt`. A cycle's window is closed at the top because the
      // close writes into it: `accrueSalaries` stamps this month's SALARY at
      // exactly `closedAt`, and a half-open bound would compute every salaried
      // منفّذ's payout without their salary in it. (`balanceFor` keeps the
      // half-open convention it is tested under; this is the one place the
      // boundary belongs to the cycle rather than to the reader.)
      where: { createdAt: { lte: args.closedAt } },
    }),
    db.ledgerEntry.groupBy({
      by: ['userId', 'type'],
      _sum: { amount: true },
      where: { cycleId: args.cycle.id },
    }),
  ])

  const balances = balanceRows as unknown as Array<{
    userId: string
    _sum: { amount: DecimalLike | null }
  }>
  const movements = movementRows as unknown as Array<{
    userId: string
    type: string
    _sum: { amount: DecimalLike | null }
  }>

  const balanceOf = new Map<string, Money>(
    balances.map((row) => [row.userId, moneyOf(row._sum.amount)]),
  )

  /**
   * What earlier payouts still claim: `Σ(net − paidAmount)` over every DRAFT or
   * APPROVED payout from a previous cycle.
   *
   * Without this, a payout that was drafted and not yet paid — a disputed
   * month, a finance user on leave, a partial payment — is claimed *again* by
   * the next close, because the money is still sitting in the balance that
   * `net` is computed from. Two payouts then add up to more than the منفّذ is
   * owed, both screens say so, and paying both would hand over money twice.
   *
   * Subtracting it here is the only place that fixes the arithmetic rather than
   * the symptom. The unpaid remainder stays exactly where SPEC §5.5 puts it —
   * outstanding on the payout that owns it — and this cycle claims only what is
   * genuinely new.
   */
  const claims = await db.payout.groupBy({
    by: ['userId'],
    _sum: { net: true, paidAmount: true },
    where: { cycleId: { not: args.cycle.id }, status: { in: ['DRAFT', 'APPROVED'] } },
  })
  const claimedBy = new Map<string, Money>(
    (
      claims as unknown as Array<{
        userId: string
        _sum: { net: DecimalLike | null; paidAmount: DecimalLike | null }
      }>
    ).map((row) => [
      row.userId,
      clampAtZero(sub(moneyOf(row._sum.net), moneyOf(row._sum.paidAmount))),
    ]),
  )

  const byUser = new Map<string, Map<LedgerType, Money>>()
  for (const row of movements) {
    const totals = byUser.get(row.userId) ?? new Map<LedgerType, Money>()
    totals.set(row.type as LedgerType, moneyOf(row._sum.amount))
    byUser.set(row.userId, totals)
  }

  // Anyone with movements this cycle, plus anyone carrying a balance from
  // before it. The second half is what keeps a debt visible every month rather
  // than only in the month it was incurred.
  const candidates = new Set<string>([
    ...byUser.keys(),
    ...[...balanceOf.entries()].filter(([, value]) => !isZero(value)).map(([id]) => id),
  ])
  // Somebody whose entire balance is already claimed by an unpaid payout has
  // nothing new this cycle — but they are still a candidate, so the statement
  // says "0.00 this month, and last month's is still with finance" rather than
  // going silent.
  if (candidates.size === 0) return 0

  const users = await db.user.findMany({
    where: { id: { in: [...candidates] } },
    select: { id: true, deletedAt: true },
  })
  const alive = new Set(users.filter((u) => u.deletedAt === null).map((u) => u.id))

  let created = 0

  for (const userId of [...candidates].sort()) {
    if (!alive.has(userId)) {
      // Invariant 8 says soft-deleted rows stay out of every query, but money
      // owed to somebody who has left is not something to discover in a year.
      const balance = balanceOf.get(userId) ?? zero()
      if (!isZero(balance)) {
        await recordAudit(db, {
          actor: args.actor,
          action: 'payout.skippedDeletedUser',
          entity: 'User',
          entityId: userId,
          after: { cycleId: args.cycle.id, balance: toStorageString(balance) },
        })
      }
      continue
    }

    const totals = byUser.get(userId) ?? new Map<LedgerType, Money>()
    const totalOf = (type: LedgerType): Money => totals.get(type) ?? zero()

    const gross = CREDIT_MAGNITUDE.reduce<Money>(
      (acc, type) => acc.plus(totalOf(type)),
      zero(),
    )
    const penalties = totalOf('PENALTY').abs()
    const bonuses = totalOf('BONUS')
    const advances = totalOf('ADVANCE').abs()
    const adjustments = totalOf('ADJUSTMENT')

    const periodMovement = [...totals.values()].reduce<Money>(
      (acc, value) => acc.plus(value),
      zero(),
    )
    const balance = balanceOf.get(userId) ?? zero()
    const claimed = claimedBy.get(userId) ?? zero()

    /**
     * `carriedForward` is the part of the previous balance that **no other
     * payout has already claimed** — not the raw balance brought in. Netting
     * the claims off here rather than off `net` is what keeps the statement's
     * arithmetic printable and true at the same time:
     *
     *   net = max(0, carriedForward + gross − penalties + bonuses − advances + adjustments)
     *
     * A منفّذ who was paid 500 of last month's 800 reads a `carriedForward` of
     * zero and this month's earnings in full, because the missing 300 is still
     * on last month's statement where they can see it — rather than appearing
     * twice, once in each place.
     */
    const carriedForward = sub(sub(balance, periodMovement), claimed)
    const net = clampAtZero(sub(balance, claimed))

    try {
      const row = (await db.payout.create({
        data: {
          userId,
          cycleId: args.cycle.id,
          carriedForward: toStorageString(carriedForward),
          gross: toStorageString(gross),
          penalties: toStorageString(penalties),
          bonuses: toStorageString(bonuses),
          advances: toStorageString(advances),
          adjustments: toStorageString(adjustments),
          net: toStorageString(net),
        },
        select: PAYOUT_SELECT,
      })) as PayoutRow

      await recordAudit(db, {
        actor: args.actor,
        action: 'payout.drafted',
        entity: 'Payout',
        entityId: row.id,
        after: {
          userId,
          cycleId: args.cycle.id,
          carriedForward: toStorageString(carriedForward),
          gross: toStorageString(gross),
          penalties: toStorageString(penalties),
          bonuses: toStorageString(bonuses),
          advances: toStorageString(advances),
          adjustments: toStorageString(adjustments),
          net: toStorageString(net),
        },
        ...(args.ip ? { ip: args.ip } : {}),
      })
      created += 1
    } catch (error) {
      // `payouts_userId_cycleId_key`: a concurrent close already drafted this
      // person's payout. One payout per worker per cycle is the guarantee, and
      // it just held.
      if (!isUniqueViolation(error)) throw error
    }
  }

  return created
}

// ─────────────────────────────────────────────────────────────────────────────
// Payout lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovePayoutArgs {
  payoutId: string
  actor: AuditActorRef | null
  now?: Date
  ip?: string
  events?: PayoutEventBus
}

export async function approvePayout(db: Db, args: ApprovePayoutArgs): Promise<PayoutDto> {
  const now = args.now ?? new Date()
  const events = args.events ?? noopPayoutEvents
  const payout = await loadPayout(db, args.payoutId)

  if (payout.status !== 'DRAFT') {
    throw new ConflictError('payout.errors.notDraft', {
      payoutId: payout.id,
      status: payout.status,
    })
  }

  // Compare-and-swap on the status, not a plain update: two managers pressing
  // اعتماد at the same moment both read DRAFT, and without the `status` in the
  // where-clause both would write — one silently overwriting the other's name
  // and time on the record of who approved this money.
  const claimed = await db.payout.updateMany({
    where: { id: payout.id, status: 'DRAFT' },
    data: { status: 'APPROVED', approvedById: args.actor?.id ?? null, approvedAt: now },
  })
  if (claimed.count === 0) {
    throw new ConflictError('payout.errors.notDraft', { payoutId: payout.id })
  }

  const row = (await db.payout.findUniqueOrThrow({
    where: { id: payout.id },
    select: PAYOUT_SELECT,
  })) as PayoutRow

  await recordAudit(db, {
    actor: args.actor,
    action: 'payout.approved',
    entity: 'Payout',
    entityId: payout.id,
    before: { status: 'DRAFT' },
    after: { status: 'APPROVED', net: row.net.toFixed(2), approvedAt: now },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await events.emit(db, {
    type: 'PayoutApproved',
    payoutId: payout.id,
    userId: row.userId,
    net: toStorageString(moneyOf(row.net)),
    approvedById: args.actor?.id ?? null,
    at: now,
  })

  return toPayoutDto(row)
}

export interface MarkPayoutPaidArgs {
  payoutId: string
  /** This payment, not the running total. `≤ net − paidAmount`. */
  amount: MoneyInput
  /** Required for any non-zero payment; must be one of `paymentMethods`. */
  method?: string
  reference?: string
  note?: string
  /** Settings `payout.paymentMethods`, injected (CLAUDE.md invariant 4). */
  paymentMethods: readonly string[]
  actor: AuditActorRef | null
  cycleDay: number
  now?: Date
  ip?: string
  events?: PayoutEventBus
}

/**
 * Record a payment, in full or in part.
 *
 * The payment appends a negative `PAYOUT` entry attributed to **the cycle being
 * settled**, not to the open one. That way the closed statement shows that it
 * was paid, rather than the next month showing a deduction nobody recognises —
 * and it makes one more invariant checkable: the `PAYOUT` entries for a
 * (منفّذ, cycle) always sum to exactly `−paidAmount`.
 *
 * `paidAmount` on the row is a running total and is genuinely mutable. `Payout`
 * is a working document; the ledger is the permanent record.
 */
export async function markPayoutPaid(
  db: Db,
  args: MarkPayoutPaidArgs,
): Promise<PayoutDto> {
  const now = args.now ?? new Date()
  const events = args.events ?? noopPayoutEvents
  const payout = await loadPayout(db, args.payoutId)

  if (payout.status === 'DRAFT') {
    throw new DomainError('payout.errors.notApproved', { payoutId: payout.id })
  }
  if (payout.status === 'PAID') {
    throw new DomainError('payout.errors.alreadyPaid', { payoutId: payout.id })
  }

  const amount = toMoney(args.amount)
  if (isNegative(amount)) {
    throw new DomainError('payout.errors.negativeAmount', { amount: amount.toString() })
  }
  if (!round2(amount).equals(amount)) {
    throw new DomainError('ledger.errors.amountScale', { amount: amount.toString() })
  }

  const net = moneyOf(payout.net)
  const alreadyPaid = moneyOf(payout.paidAmount)
  const outstanding = sub(net, alreadyPaid)

  if (gt(amount, outstanding)) {
    throw new DomainError('payout.errors.exceedsOutstanding', {
      amount: toStorageString(amount),
      outstanding: toStorageString(outstanding),
    })
  }

  /**
   * There is deliberately **no second ceiling against the live balance here.**
   *
   * An earlier version clamped the payment to the منفّذ's current balance, to
   * stop two payouts claiming the same money. It stopped something real, and it
   * broke something worse: a `PENALTY` recorded after the close — which is
   * exactly what SPEC §5.4's engine does routinely — dropped the balance below
   * an already-approved payout and made it unpayable. SPEC §5.4 and §5.5 both
   * say a deduction that overshoots carries to the *next* cycle; they do not
   * say it retroactively shrinks a figure a manager has already approved and a
   * منفّذ has already been shown.
   *
   * The double-claim it was defending against is fixed where it is actually
   * caused: `draftPayouts` now subtracts what earlier payouts still claim, so
   * two payouts can never add up to more than the balance in the first place.
   * A ceiling here would be a second line of defence doing the first line's
   * job, at the price of a payout nobody can pay.
   */
  // A zero payment is only meaningful when there is nothing left to pay — it is
  // how a floored-at-zero payout is closed off. Anywhere else it is a no-op
  // that would look like a payment in the audit log.
  if (isPositive(outstanding) && !isPositive(amount)) {
    throw new DomainError('payout.errors.amountRequired', { payoutId: payout.id })
  }

  let method = payout.method
  if (isPositive(amount)) {
    if (!args.method) {
      throw new DomainError('payout.errors.methodRequired', { payoutId: payout.id })
    }
    if (!args.paymentMethods.includes(args.method)) {
      throw new DomainError('payout.errors.unknownMethod', { method: args.method })
    }
    method = args.method
  }

  const paidAmount = add(alreadyPaid, amount)
  const status: PayoutStatus = gte(paidAmount, net) ? 'PAID' : 'APPROVED'

  /**
   * The running total is claimed **before** the money is recorded, with the
   * amount we read in the where-clause.
   *
   * Two finance users paying the same payout at the same moment both read
   * `paidAmount = 0`, both pass every check above, and — with a plain update —
   * both would write a `PAYOUT` entry. The agency pays twice and the ledger
   * says so afterwards. Making the update conditional on the value that was
   * read turns the second one into a no-op that raises, and because the entry
   * is appended only after the claim succeeds, the losing caller writes nothing
   * at all.
   */
  const claimed = await db.payout.updateMany({
    where: {
      id: payout.id,
      status: payout.status as PayoutStatus,
      paidAmount: toStorageString(alreadyPaid),
    },
    data: {
      status,
      paidAmount: toStorageString(paidAmount),
      method,
      ...(args.reference !== undefined ? { reference: args.reference } : {}),
      ...(args.note !== undefined ? { note: args.note } : {}),
      paidById: args.actor?.id ?? null,
      paidAt: now,
    },
  })
  if (claimed.count === 0) {
    throw new ConflictError('payout.errors.concurrentPayment', { payoutId: payout.id })
  }

  if (isPositive(amount)) {
    await appendEntry(db, {
      userId: payout.userId,
      type: 'PAYOUT',
      amount: negate(amount),
      note: ar.ledger.notes.payout.replace('{amount}', toStorageString(amount)),
      cycleId: payout.cycleId,
      cycleDay: args.cycleDay,
      isAutoGenerated: true,
      actor: args.actor,
      at: now,
      ...(args.ip ? { ip: args.ip } : {}),
    })
  }

  const row = (await db.payout.findUniqueOrThrow({
    where: { id: payout.id },
    select: PAYOUT_SELECT,
  })) as PayoutRow

  await recordAudit(db, {
    actor: args.actor,
    action: status === 'PAID' ? 'payout.paid' : 'payout.partiallyPaid',
    entity: 'Payout',
    entityId: payout.id,
    before: { status: payout.status, paidAmount: alreadyPaid.toFixed(2) },
    after: {
      status,
      payment: toStorageString(amount),
      paidAmount: toStorageString(paidAmount),
      outstanding: toStorageString(sub(net, paidAmount)),
      method,
      reference: args.reference ?? null,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  if (status === 'PAID') await settleCycleIfComplete(db, payout.cycleId, args.actor)

  // Only a real payment is news. A zero-amount call is only reachable to close
  // out an already-floored payout (the check above), and "you were paid
  // nothing" is not a notification.
  if (isPositive(amount)) {
    await events.emit(db, {
      type: 'PayoutPaid',
      payoutId: payout.id,
      userId: payout.userId,
      amount: toStorageString(amount),
      fullyPaid: status === 'PAID',
      paidById: args.actor?.id ?? null,
      at: now,
    })
  }

  return toPayoutDto(row)
}

/**
 * A cycle is PAID when every payout it generated is. Derived, but stored, so
 * that "which cycles still owe somebody" is an indexed query rather than a
 * sub-aggregate per row.
 */
async function settleCycleIfComplete(
  db: Db,
  cycleId: string,
  actor: AuditActorRef | null,
): Promise<void> {
  const outstanding = await db.payout.count({
    where: { cycleId, status: { not: 'PAID' } },
  })
  if (outstanding > 0) return

  const cycle = await db.payoutCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, status: true },
  })
  if (!cycle || cycle.status !== 'CLOSED') return

  await db.payoutCycle.update({ where: { id: cycleId }, data: { status: 'PAID' } })
  await recordAudit(db, {
    actor,
    action: 'payout.cycleSettled',
    entity: 'PayoutCycle',
    entityId: cycleId,
    before: { status: 'CLOSED' },
    after: { status: 'PAID' },
  })
}

async function loadPayout(db: Db, id: string): Promise<PayoutRow> {
  const row = (await db.payout.findUnique({
    where: { id },
    select: PAYOUT_SELECT,
  })) as PayoutRow | null
  if (!row) throw new NotFoundError('Payout', id)
  return row
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export interface ListPayoutsArgs {
  cycleId?: string
  userId?: string
  status?: PayoutStatus
  scope?: Record<string, unknown>
}

export async function listPayouts(db: Db, args: ListPayoutsArgs): Promise<PayoutDto[]> {
  const rows = (await db.payout.findMany({
    where: {
      ...(args.scope ?? {}),
      ...(args.cycleId ? { cycleId: args.cycleId } : {}),
      ...(args.userId ? { userId: args.userId } : {}),
      ...(args.status ? { status: args.status } : {}),
      user: { deletedAt: null },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: PAYOUT_SELECT,
  })) as PayoutRow[]

  return rows.map(toPayoutDto)
}

export async function getPayout(db: Db, id: string): Promise<PayoutDto> {
  return toPayoutDto(await loadPayout(db, id))
}

export async function listCycles(
  db: Db,
  args: { limit?: number } = {},
): Promise<PayoutCycleDto[]> {
  const cycles = await db.payoutCycle.findMany({
    orderBy: { periodStart: 'desc' },
    take: Math.min(60, Math.max(1, args.limit ?? 24)),
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      closedAt: true,
      closedById: true,
    },
  })
  if (cycles.length === 0) return []

  const grouped = await db.payout.groupBy({
    by: ['cycleId'],
    _sum: { net: true, paidAmount: true },
    _count: { _all: true },
    // Soft-delete, on the same terms as `listPayouts` (invariant 8). Without
    // the filter a cycle containing a departed منفّذ's payout shows a total
    // that no combination of the rows on screen adds up to.
    where: { cycleId: { in: cycles.map((c) => c.id) }, user: { deletedAt: null } },
  })
  const totals = grouped as unknown as Array<{
    cycleId: string
    _count: { _all: number }
    _sum: { net: DecimalLike | null; paidAmount: DecimalLike | null }
  }>

  const byCycle = new Map(totals.map((row) => [row.cycleId, row]))

  return cycles.map((cycle) => {
    const total = byCycle.get(cycle.id)
    return {
      id: cycle.id,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      status: cycle.status as PayoutCycleDto['status'],
      closedAt: cycle.closedAt,
      closedById: cycle.closedById,
      payoutCount: total?._count._all ?? 0,
      totalNet: toStorageString(moneyOf(total?._sum.net)),
      totalPaid: toStorageString(moneyOf(total?._sum.paidAmount)),
    }
  })
}

/** The worker-facing cycle history behind "مستحقاتي". */
export async function listStatements(
  db: Db,
  args: { userId: string; limit?: number },
): Promise<PayoutStatementDto[]> {
  const rows = (await db.payout.findMany({
    where: { userId: args.userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(60, Math.max(1, args.limit ?? 24)),
    select: {
      ...PAYOUT_SELECT,
      cycle: {
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          closedAt: true,
        },
      },
    },
  })) as Array<
    PayoutRow & {
      cycle: {
        id: string
        periodStart: Date
        periodEnd: Date
        status: string
        closedAt: Date | null
      }
    }
  >

  return rows.map((row) => ({
    payout: toPayoutDto(row),
    cycle: {
      id: row.cycle.id,
      periodStart: row.cycle.periodStart,
      periodEnd: row.cycle.periodEnd,
      status: row.cycle.status as PayoutCycleDto['status'],
      closedAt: row.cycle.closedAt,
    },
  }))
}
