import { requireActor } from '@/lib/auth/session'
import { cairoDateKeyOfParts, cairoInstant, cairoParts } from '@/lib/calendar/cairo'
import { prisma } from '@/lib/db'
import { ForbiddenError } from '@/lib/errors'
import { abs } from '@/lib/money'
import { timed } from '@/lib/perf'
import { can } from '@/lib/rbac'
import { listCycles, listPayouts } from '@/modules/payout/service'
import { getDeductionsReport } from '@/modules/penalty/queries'
import { UNDELIVERED_TASK_STATUSES } from '@/modules/project/health'
import { getProjects } from '@/modules/project/queries'

import type {
  MonthlyAgencySummaryDto,
  PayoutStatementReportDto,
  ProjectSummaryReportDto,
  WorkerPerformanceReportDto,
} from './types'

/**
 * modules/report/queries.ts — the four Phase 10 reports (phase brief item 5).
 *
 * Every function starts the same way every action in this product does
 * (CLAUDE.md invariant 3): session, then `report.view`. There is no wider
 * scoping applied on top of it, matching `modules/penalty/register.ts`'s
 * `deductionsReport` precedent — `report.view` is a whole-agency reporting
 * privilege, not a narrower view of whatever the reader happens to own or be
 * assigned to. A worker never holds it; a manager who does sees the agency,
 * not just their own projects.
 */

function assertCanViewReports(): Promise<void> {
  return requireActor().then((actor) => {
    if (!can(actor, 'report.view')) throw new ForbiddenError('report.view')
  })
}

function startOfCairoMonth(now: Date): Date {
  const { year, month } = cairoParts(now)
  return cairoInstant(cairoDateKeyOfParts(year, month, 1), 0)
}

/** `[from, to)` for a given `YYYY-MM` Cairo month, clamped so `to` never exceeds `now`. */
function cairoMonthBounds(
  monthKey: string | undefined,
  now: Date,
): { from: Date; to: Date } {
  if (!monthKey) return { from: startOfCairoMonth(now), to: now }

  const [yearPart, monthPart] = monthKey.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  const from = cairoInstant(cairoDateKeyOfParts(year, month, 1), 0)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const monthEnd = cairoInstant(cairoDateKeyOfParts(nextYear, nextMonth, 1), 0)

  return { from, to: monthEnd.getTime() < now.getTime() ? monthEnd : now }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Payout statement per worker per cycle
// ─────────────────────────────────────────────────────────────────────────

/**
 * `cycleId` defaults to the most recent cycle. Goes through
 * `modules/payout/service.ts`'s ungated `listCycles`/`listPayouts` directly,
 * not the `payout.view`-gated `getPayoutCycles` query — `report.view` alone
 * is meant to be the gate here (see the module note), and calling through the
 * gated wrapper would silently demand a *second* permission this report never
 * documented needing.
 */
export async function getPayoutStatementReport(
  cycleId?: string,
): Promise<PayoutStatementReportDto> {
  await assertCanViewReports()

  return timed('report.payoutStatement', async () => {
    const cycles = await listCycles(prisma, { limit: 60 })
    const cycle = cycleId
      ? (cycles.find((c) => c.id === cycleId) ?? null)
      : (cycles[0] ?? null)
    if (!cycle) return { cycle: null, rows: [] }

    const rows = await listPayouts(prisma, { cycleId: cycle.id, scope: {} })
    return { cycle, rows }
  })
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Project summary — tasks, completion, overdue, health
// ─────────────────────────────────────────────────────────────────────────

const COMPLETED_TASK_STATUSES = ['APPROVED', 'DONE'] as const
const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * Reuses `getProjects` — the actor's normal project scope applies (SPEC §6's
 * "restrictive is the safe direction to be wrong in"), unlike the other three
 * reports here. A project has an owner/member scope the way a payout or a
 * ledger entry does not, and a `report.view` holder whose role is otherwise
 * scoped narrower sees a smaller report rather than a silently wider one.
 */
export async function getProjectSummaryReport(
  now: Date = new Date(),
): Promise<ProjectSummaryReportDto> {
  await assertCanViewReports()

  return timed('report.projectSummary', async () => {
    const page = await getProjects({ pageSize: 100 }, now)
    const projectIds = page.items.map((p) => p.id)
    if (projectIds.length === 0) return { rows: [] }

    const [statusCounts, overdueCounts] = await Promise.all([
      prisma.task.groupBy({
        by: ['projectId', 'status'],
        where: {
          projectId: { in: projectIds },
          deletedAt: null,
          project: { deletedAt: null },
        },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ['projectId'],
        where: {
          projectId: { in: projectIds },
          deletedAt: null,
          project: { deletedAt: null },
          status: { in: [...UNDELIVERED_TASK_STATUSES] },
          dueDate: { lt: now },
        },
        _count: { _all: true },
      }),
    ])

    const totalByProject = new Map<string, number>()
    const completedByProject = new Map<string, number>()
    for (const row of statusCounts) {
      totalByProject.set(
        row.projectId,
        (totalByProject.get(row.projectId) ?? 0) + row._count._all,
      )
      if ((COMPLETED_TASK_STATUSES as readonly string[]).includes(row.status)) {
        completedByProject.set(
          row.projectId,
          (completedByProject.get(row.projectId) ?? 0) + row._count._all,
        )
      }
    }
    const overdueByProject = new Map(
      overdueCounts.map((row) => [row.projectId, row._count._all]),
    )

    return {
      rows: page.items.map((project) => {
        const totalTasks = totalByProject.get(project.id) ?? 0
        const completedTasks = completedByProject.get(project.id) ?? 0
        return {
          projectId: project.id,
          code: project.code,
          name: project.name,
          status: project.status,
          health: project.health.health,
          totalTasks,
          completedTasks,
          overdueTasks: overdueByProject.get(project.id) ?? 0,
          completionPercent:
            totalTasks === 0 ? 0 : round1((completedTasks / totalTasks) * 100),
        }
      }),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Worker performance report
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reads the `PerformanceScore` cache table only, never recomputes — the same
 * figure the worker's own dashboard shows, "as of the last nightly recompute"
 * (SPEC §5.6). Computing a hundred workers' scores on every report open would
 * be exactly the kind of query this phase's own "log anything over 100ms"
 * constraint is warning against.
 */
export async function getWorkerPerformanceReport(): Promise<WorkerPerformanceReportDto> {
  await assertCanViewReports()

  return timed('report.workerPerformance', async () => {
    const workers = await prisma.user.findMany({
      where: { deletedAt: null, isWorker: true, isActive: true },
      select: {
        id: true,
        fullName: true,
        username: true,
        performanceScore: true,
      },
      orderBy: { fullName: 'asc' },
    })

    return {
      rows: workers.map((worker) => ({
        userId: worker.id,
        fullName: worker.fullName,
        username: worker.username,
        score: worker.performanceScore?.score.toFixed(1) ?? null,
        onTimeRate: worker.performanceScore?.onTimeRate.toFixed(1) ?? null,
        qualityScore: worker.performanceScore?.qualityScore.toFixed(1) ?? null,
        volumeScore: worker.performanceScore?.volumeScore.toFixed(1) ?? null,
        estimateAccuracy: worker.performanceScore?.estimateAccuracy.toFixed(1) ?? null,
        taskCount: worker.performanceScore?.taskCount ?? null,
        computedAt: worker.performanceScore?.computedAt ?? null,
      })),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Monthly agency summary
// ─────────────────────────────────────────────────────────────────────────

/**
 * `monthKey` is a Cairo `YYYY-MM`; omitted, it defaults to the current month
 * up to `now` (never counting time that has not happened yet). Composes
 * `getDeductionsReport` for the one figure it already owns (SPEC R4) rather
 * than re-summing the ledger a second way.
 */
export async function getMonthlyAgencySummary(
  monthKey?: string,
  now: Date = new Date(),
): Promise<MonthlyAgencySummaryDto> {
  await assertCanViewReports()

  return timed('report.monthlyAgencySummary', async () => {
    const { from, to } = cairoMonthBounds(monthKey, now)

    const [completed, paidSum, deductions] = await Promise.all([
      prisma.task.findMany({
        where: {
          deletedAt: null,
          project: { deletedAt: null },
          status: { in: [...COMPLETED_TASK_STATUSES] },
          approvedAt: { gte: from, lt: to },
        },
        select: { overdueWorkingDays: true },
      }),
      prisma.ledgerEntry.aggregate({
        where: { type: 'PAYOUT', createdAt: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
      getDeductionsReport({ from, to, groupBy: 'month' }),
    ])

    const completedTasks = completed.length
    const onTimeCount = completed.filter((t) => t.overdueWorkingDays === 0).length

    return {
      from,
      to,
      completedTasks,
      onTimeRate: completedTasks === 0 ? 0 : round1((onTimeCount / completedTasks) * 100),
      // `PAYOUT` ledger rows are negative debits (`modules/ledger/sign.ts`) —
      // absolute value is what "total paid" means to a reader.
      totalPaid: abs(paidSum._sum.amount ?? 0).toFixed(2),
      totalDeductions: deductions.totalPenalties,
    }
  })
}
