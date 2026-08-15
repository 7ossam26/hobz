import type { Db } from '@/lib/db'
import type { WhereFragment } from '@/lib/rbac'

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
 * `Task` is a Phase 4 table, so "overdue tasks" and "blocked days" cannot be
 * queried yet. The *rule* ships now, guarded and unit-tested against a lookup
 * that returns real numbers; `noTaskHealthSignals` is Phase 3's honest answer
 * — there are no tasks, so both signals are zero — and Phase 4 swaps in the
 * real query behind the same port.
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

/** Phase 3's honest answer: no `Task` table exists yet, so nothing is overdue or blocked. */
export const noTaskHealthSignals: TaskHealthLookup = async () => ({
  overdueTaskCount: 0,
  maxBlockedDays: 0,
})

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
 * The `healthWhereFragment` above translated into a Prisma `where` fragment,
 * so the health facet on `/projects` is a real indexed filter rather than a
 * fetch-everything-then-filter-in-JS shortcut (SPEC §9: "every list
 * paginated").
 *
 * This is only valid because Phase 3's task signals are always zero
 * (`noTaskHealthSignals`) — the two RED conditions that depend on them can
 * never fire, so RED here reduces to "past due date". `tests/unit/project/health.test.ts`
 * asserts this fragment agrees with `computeProjectHealth` at zero signals
 * across the same boundary matrix. **Phase 4 must revisit this** once real
 * task signals exist — either by pushing them into the `where` too or by
 * moving this facet to an application-level filter.
 */
export function healthWhereFragment(
  target: ComputedHealth,
  now: Date,
  amberDaysBeforeDue: number,
): WhereFragment {
  const amberCutoff = new Date(now.getTime() + amberDaysBeforeDue * DAY_MS)
  const nonTerminal = { status: { notIn: [...TERMINAL_PROJECT_STATUSES] } }

  const byTarget: Record<ComputedHealth, WhereFragment> = {
    RED: { ...nonTerminal, dueDate: { lt: now } },
    AMBER: { ...nonTerminal, dueDate: { gte: now, lte: amberCutoff } },
    GREEN: {
      OR: [
        { status: { in: [...TERMINAL_PROJECT_STATUSES] } },
        { ...nonTerminal, dueDate: { gt: amberCutoff } },
      ],
    },
  }

  return {
    OR: [{ healthOverride: target }, { healthOverride: null, ...byTarget[target] }],
  }
}
