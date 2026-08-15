import type { Db } from '@/lib/db'

/**
 * modules/project/health.ts — RAG computation (SPEC §5.7).
 *
 *   RED   if any: overdue tasks > threshold, project past `dueDate`,
 *         blocked > N days.
 *   AMBER if approaching.
 *   Manual override wins over both, and requires a reason (`service.ts`).
 *
 * Everything here is a pure function over plain inputs — no Prisma, no
 * `next/*` — so the boundary behaviour the phase brief asks for ("unit for
 * health computation across threshold boundaries") is provable without a
 * database.
 *
 * ── Why plain date subtraction, when CLAUDE.md invariant 5 says never ──────
 *
 * Invariant 5 is about *lateness* and *elapsed working time* — the numbers
 * that feed a penalty, which must exclude weekends, holidays and leave
 * (SPEC §5.2–§5.3, `lib/calendar`, implemented in Phase 6). "Approaching due
 * date" is a different question: a plain calendar countdown against a
 * Settings value that is itself named in calendar days
 * (`health.amberDaysBeforeDue`), not working days. Routing a dashboard hint
 * through the not-yet-implemented Phase 6 calendar would make this feature
 * throw `NotImplementedError` today for no correctness gain — nothing here
 * computes a deduction.
 *
 * ── Task signals are a port, exactly like Phase 1's `OpenTaskLookup` ───────
 *
 * `Task` was a Phase 4 table, so "overdue tasks" and "blocked days" could not
 * be queried in Phase 3. The *rule* shipped then, guarded and unit-tested
 * against a lookup that returns real numbers, with `noTaskHealthSignals` as
 * the honest answer for a database with no tasks.
 *
 * **Phase 4 filled it in** — `taskHealthSignals` below is the real query, and
 * the port it plugs into is unchanged. `noTaskHealthSignals` stays, because
 * the pure-computation tests are better off stating their signals inline than
 * building a project's worth of tasks to imply them.
 */

export type ComputedHealth = 'GREEN' | 'AMBER' | 'RED'

export interface ProjectHealthSignals {
  overdueTaskCount: number
  maxBlockedDays: number
}

export type TaskHealthLookup = (
  db: Db,
  projectId: string,
) => Promise<ProjectHealthSignals>

/** No tasks, nothing overdue or blocked. The baseline for pure-computation tests. */
export const noTaskHealthSignals: TaskHealthLookup = async () => ({
  overdueTaskCount: 0,
  maxBlockedDays: 0,
})

/**
 * Statuses in which a task's due date is still the worker's problem. Time in
 * review never counts against them (SPEC §5.3), so a delivered task is not
 * overdue no matter how long the reviewer sits on it — the same set
 * `modules/task/service.ts` filters `overdueOnly` on.
 */
const UNDELIVERED = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'REVISION_REQUESTED'] as const

/**
 * The real signals, as of Phase 4.
 *
 * `maxBlockedDays` is measured from the `STATUS_CHANGED → BLOCKED` activity row
 * rather than from a column, for the same reason `unblockTask` reads that feed:
 * it is already the record of when the block happened, and a second copy would
 * be a second thing that can be wrong.
 *
 * Plain day arithmetic, deliberately — `health.blockedDaysThreshold` is named
 * in calendar days and feeds a dashboard hint, not a deduction. CLAUDE.md
 * invariant 5 governs lateness and working elapsed time; see the note at the
 * top of this file.
 */
export function taskHealthSignals(now: Date = new Date()): TaskHealthLookup {
  return async (db, projectId) => {
    const [overdueTaskCount, blocked] = await Promise.all([
      db.task.count({
        where: {
          projectId,
          deletedAt: null,
          status: { in: [...UNDELIVERED] },
          dueDate: { lt: now },
        },
      }),
      db.task.findMany({
        where: { projectId, deletedAt: null, status: 'BLOCKED' },
        select: {
          id: true,
          activity: {
            where: { type: 'STATUS_CHANGED', to: 'BLOCKED' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
    ])

    const maxBlockedDays = blocked.reduce((worst, task) => {
      const blockedAt = task.activity[0]?.createdAt
      if (!blockedAt) return worst
      const days = Math.floor((now.getTime() - blockedAt.getTime()) / DAY_MS)
      return Math.max(worst, days)
    }, 0)

    return { overdueTaskCount, maxBlockedDays }
  }
}

export interface HealthThresholds {
  overdueTasksThreshold: number
  blockedDaysThreshold: number
  amberDaysBeforeDue: number
}

/** A finished/abandoned project's health is moot — it no longer needs watching. */
export const TERMINAL_PROJECT_STATUSES = ['COMPLETED', 'CANCELLED', 'ARCHIVED'] as const

const DAY_MS = 24 * 60 * 60 * 1000

export interface ComputeProjectHealthInput {
  status: string
  dueDate: Date
  now: Date
  signals: ProjectHealthSignals
  thresholds: HealthThresholds
}

export function computeProjectHealth(input: ComputeProjectHealthInput): ComputedHealth {
  const { status, dueDate, now, signals, thresholds } = input

  if ((TERMINAL_PROJECT_STATUSES as readonly string[]).includes(status)) return 'GREEN'

  const signalsRed =
    signals.overdueTaskCount > thresholds.overdueTasksThreshold ||
    signals.maxBlockedDays > thresholds.blockedDaysThreshold

  // "Past dueDate" is strict: the instant the deadline lands is not yet past
  // it. That instant is exactly where the AMBER check below picks it up.
  if (signalsRed || now.getTime() > dueDate.getTime()) return 'RED'

  const amberBoundary = dueDate.getTime() - thresholds.amberDaysBeforeDue * DAY_MS
  if (now.getTime() >= amberBoundary) return 'AMBER'

  return 'GREEN'
}

export interface EffectiveHealth {
  /** What actually applies: the override when set, the computed value otherwise. */
  health: ComputedHealth
  computed: ComputedHealth
  overridden: boolean
  reason: string | null
}

export function effectiveProjectHealth(
  computed: ComputedHealth,
  override: ComputedHealth | null,
  reason: string | null,
): EffectiveHealth {
  return {
    health: override ?? computed,
    computed,
    overridden: override !== null,
    reason: override !== null ? reason : null,
  }
}

/**
 * ── Where the `/projects` health facet went (Phase 4) ─────────────────────
 *
 * Phase 3 shipped a `healthWhereFragment()` here that translated a target RAG
 * value into a Prisma `where`, so the facet was an indexed filter. It was
 * correct precisely while `noTaskHealthSignals` was the only lookup: with both
 * signals pinned at zero, RED reduced to "past due date", which SQL can say.
 *
 * `taskHealthSignals` above makes RED also mean "more overdue tasks than the
 * threshold" or "blocked longer than N days" — a per-project aggregate over
 * another table against Settings-driven thresholds, which Prisma cannot put in
 * a `where` without raw SQL. Keeping the fragment would have meant a facet
 * that quietly disagreed with the badge rendered on the row beside it.
 *
 * So the facet now filters on `computeProjectHealth`'s own output in
 * `listProjects`, which is the second of the two options Phase 3's note named.
 * The cost is the one already recorded as a known limitation there: that list
 * path materialises its scoped-and-filtered candidate rows before paginating.
 */
