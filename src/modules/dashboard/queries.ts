import { requireActor } from '@/lib/auth/session'
import { cairoDateKeyOfParts, cairoInstant, cairoParts } from '@/lib/calendar/cairo'
import { sub } from '@/lib/money'
import { timed } from '@/lib/perf'
import { can, type Actor } from '@/lib/rbac'
import { getPayoutCycles } from '@/modules/payout/queries'
import { getDeductionsReport } from '@/modules/penalty/queries'
import { getMyPerformanceScore } from '@/modules/performance/queries'
import type { PerformanceScoreDto } from '@/modules/performance/types'
import { getProjects } from '@/modules/project/queries'
import type { ProjectSummaryDto } from '@/modules/project/types'
import { getTasks } from '@/modules/task/queries'
import { OPEN_TASK_STATUSES } from '@/modules/task/state-machine'
import type { TaskSummaryDto } from '@/modules/task/types'
import { getWorkloadSnapshot, type WorkerWorkloadDto } from '@/modules/workload/queries'

/**
 * modules/dashboard/queries.ts — PHASES.md Phase 10: "Composition over
 * existing data." Every widget here calls a query another module already
 * ships and RBAC-gates; nothing new is queried from Prisma directly except
 * the two small aggregates (`currentCyclePending`, `monthDeductionsTotal`)
 * that have no existing single-purpose query to reuse.
 *
 * Every call is wrapped in `timed()` (phase brief: "log query times... report
 * anything over 100ms") — a dashboard is exactly the page where five slow
 * queries in parallel still feel like one slow page load.
 */

const WIDGET_PREVIEW_SIZE = 5

/**
 * The manager/worker routing signal. SPEC §6, as Phase 1 settled it: a project
 * owner without `task.view.all` does not see every task in their project —
 * "in practice such a manager holds `task.view.all`." That sentence is read
 * literally here too: holding either whole-company view permission *is* what
 * this product means by "a manager", and every widget below reuses
 * `scopeTasks`/`scopeProjects` through the queries it calls, so a true
 * manager's widgets are company-wide for free and nothing here has to encode
 * a second, parallel notion of "who counts as a manager".
 */
export function isManagerAudience(actor: Actor): boolean {
  return can(actor, 'task.view.all') || can(actor, 'project.view.all')
}

function startOfCairoMonth(now: Date): Date {
  const { year, month } = cairoParts(now)
  return cairoInstant(cairoDateKeyOfParts(year, month, 1), 0)
}

export interface DashboardTaskListDto {
  total: number
  items: TaskSummaryDto[]
}

export interface DashboardProjectListDto {
  total: number
  items: ProjectSummaryDto[]
}

export interface PendingPayoutsDto {
  payoutCount: number
  totalNet: string
  totalPaid: string
  /** `totalNet − totalPaid` — what is still owed this cycle. */
  pending: string
}

export interface MonthDeductionsDto {
  amount: string
}

export interface ManagerDashboardDto {
  overdueTasks: DashboardTaskListDto
  projectsAtRisk: DashboardProjectListDto
  awaitingApproval: DashboardTaskListDto
  /** `null` when the actor lacks `user.view` — omitted, not an empty list. */
  workload: WorkerWorkloadDto[] | null
  /** `null` when the actor lacks `payout.view`. */
  pendingPayouts: PendingPayoutsDto | null
  /** `null` when the actor lacks `report.view`. */
  monthDeductions: MonthDeductionsDto | null
}

async function currentCyclePending(): Promise<PendingPayoutsDto | null> {
  const [cycle] = await getPayoutCycles(1)
  if (!cycle) return null
  return {
    payoutCount: cycle.payoutCount,
    totalNet: cycle.totalNet,
    totalPaid: cycle.totalPaid,
    pending: sub(cycle.totalNet, cycle.totalPaid).toFixed(2),
  }
}

async function monthDeductionsTotal(now: Date): Promise<MonthDeductionsDto> {
  const report = await getDeductionsReport({
    from: startOfCairoMonth(now),
    to: now,
    groupBy: 'month',
  })
  return { amount: report.totalPenalties }
}

/**
 * The three primary widgets, plus three permission-gated secondary ones. A
 * secondary widget the actor cannot see is `null` on the DTO — the page
 * renders one fewer card, never a forbidden error on the one route every
 * signed-in user lands on after login.
 */
export async function getManagerDashboard(
  now: Date = new Date(),
): Promise<ManagerDashboardDto> {
  const actor = await requireActor()

  const [overdueTasks, projectsAtRisk, awaitingApproval] = await Promise.all([
    timed('dashboard.manager.overdueTasks', async () => {
      const page = await getTasks(
        { overdueOnly: true, sort: 'dueDate', dir: 'asc', pageSize: WIDGET_PREVIEW_SIZE },
        now,
      )
      return { total: page.total, items: page.items }
    }),
    timed('dashboard.manager.projectsAtRisk', async () => {
      const page = await getProjects(
        { health: ['RED'], pageSize: WIDGET_PREVIEW_SIZE },
        now,
      )
      return { total: page.total, items: page.items }
    }),
    timed('dashboard.manager.awaitingApproval', async () => {
      const page = await getTasks(
        {
          status: ['IN_REVIEW'],
          sort: 'dueDate',
          dir: 'asc',
          pageSize: WIDGET_PREVIEW_SIZE,
        },
        now,
      )
      return { total: page.total, items: page.items }
    }),
  ])

  const [workload, pendingPayouts, monthDeductions] = await Promise.all([
    can(actor, 'user.view')
      ? timed('dashboard.manager.workload', getWorkloadSnapshot)
      : Promise.resolve(null),
    can(actor, 'payout.view')
      ? timed('dashboard.manager.pendingPayouts', currentCyclePending)
      : Promise.resolve(null),
    can(actor, 'report.view')
      ? timed('dashboard.manager.monthDeductions', () => monthDeductionsTotal(now))
      : Promise.resolve(null),
  ])

  return {
    overdueTasks,
    projectsAtRisk,
    awaitingApproval,
    workload,
    pendingPayouts,
    monthDeductions,
  }
}

/** Ball is in the منفّذ's court — nobody else can move this task forward. */
const AWAITING_SUBMISSION_STATUSES = [
  'ASSIGNED',
  'IN_PROGRESS',
  'REVISION_REQUESTED',
] as const
/** Delivered — waiting on a reviewer, not on the منفّذ. */
const AWAITING_REVIEW_STATUSES = ['SUBMITTED', 'IN_REVIEW'] as const

export interface WorkerDashboardDto {
  activeTasks: DashboardTaskListDto
  dueNext: TaskSummaryDto[]
  awaitingMySubmission: DashboardTaskListDto
  awaitingReview: DashboardTaskListDto
  performance: PerformanceScoreDto
}

/**
 * Deliberately carries no money — SPEC §2's B6-vs-J3 decision, restated by the
 * phase brief itself: earnings live on `مستحقاتي` and nowhere else.
 */
export async function getWorkerDashboard(
  now: Date = new Date(),
): Promise<WorkerDashboardDto> {
  const actor = await requireActor()
  const mine = { assigneeId: [actor.id] }

  const [activeTasks, dueNext, awaitingMySubmission, awaitingReview, performance] =
    await Promise.all([
      timed('dashboard.worker.activeTasks', async () => {
        const page = await getTasks(
          { ...mine, status: [...OPEN_TASK_STATUSES], pageSize: WIDGET_PREVIEW_SIZE },
          now,
        )
        return { total: page.total, items: page.items }
      }),
      timed('dashboard.worker.dueNext', async () => {
        const page = await getTasks(
          {
            ...mine,
            status: [...OPEN_TASK_STATUSES],
            sort: 'dueDate',
            dir: 'asc',
            pageSize: WIDGET_PREVIEW_SIZE,
          },
          now,
        )
        return page.items
      }),
      timed('dashboard.worker.awaitingMySubmission', async () => {
        const page = await getTasks(
          {
            ...mine,
            status: [...AWAITING_SUBMISSION_STATUSES],
            pageSize: WIDGET_PREVIEW_SIZE,
          },
          now,
        )
        return { total: page.total, items: page.items }
      }),
      timed('dashboard.worker.awaitingReview', async () => {
        const page = await getTasks(
          {
            ...mine,
            status: [...AWAITING_REVIEW_STATUSES],
            pageSize: WIDGET_PREVIEW_SIZE,
          },
          now,
        )
        return { total: page.total, items: page.items }
      }),
      timed('dashboard.worker.performance', () => getMyPerformanceScore(now)),
    ])

  return { activeTasks, dueNext, awaitingMySubmission, awaitingReview, performance }
}
