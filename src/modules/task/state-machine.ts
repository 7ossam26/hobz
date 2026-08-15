import { DomainError } from '@/lib/errors'

/**
 * modules/task/state-machine.ts — SPEC §5.1, and nothing but SPEC §5.1.
 *
 * ```
 * BACKLOG → ASSIGNED → IN_PROGRESS → SUBMITTED → IN_REVIEW
 * IN_REVIEW → APPROVED → DONE
 * IN_REVIEW → REVISION_REQUESTED → IN_PROGRESS → SUBMITTED …
 * any(active) → BLOCKED → previous
 * any(non-final) → CANCELLED
 * ```
 *
 * Pure: no Prisma, no `next/*`, no clock of its own. The service reads the
 * current row, calls in here, and writes what comes back — which is what makes
 * the whole of `tests/unit/task/state-machine.test.ts` runnable without a
 * database, and what keeps the rule in one place instead of spread across ten
 * service functions that each "know" what they may do next.
 *
 * ── The two readings this file commits to ─────────────────────────────────
 *
 * **"any(active)"** is narrower than "any(non-final)" — the SPEC uses two
 * different words in two adjacent lines, so they are read as two different
 * sets. *Active* is work in flight: BACKLOG through REVISION_REQUESTED. An
 * APPROVED task is finished being worked on; blocking it would say nothing.
 * *Non-final* is everything except DONE and CANCELLED, which is what may be
 * cancelled.
 *
 * **APPROVED → CANCELLED stays legal**, because APPROVED is not final by that
 * definition. It is also the one cancellation that can happen *after* an
 * EARNING exists, so `cancelTask` emits `TaskCancelled` carrying `wasApproved`
 * — Phase 7 subscribes and inserts the REVERSAL. The alternative (quietly
 * making APPROVED uncancellable) would have diverged from the SPEC to paper
 * over a money question rather than answer it.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * There is no `ASSIGNED → BACKLOG`, so there is no "unassign". The phase brief
 * is explicit — "only the transitions in SPEC §5.1 are legal" — and inventing
 * an eleventh edge to support a convenience action would make this file stop
 * being a transcription of the contract. Correcting a wrong assignment is a
 * reassignment (`assignTask`), or a cancellation. Flagged in docs/DECISIONS.md
 * for Phase 5 to raise if the UI genuinely needs the inverse.
 */

export const TASK_STATUSES = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'REVISION_REQUESTED',
  'APPROVED',
  'DONE',
  'BLOCKED',
  'CANCELLED',
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Nothing leaves these. */
export const FINAL_STATUSES = [
  'DONE',
  'CANCELLED',
] as const satisfies readonly TaskStatus[]

/** "any(active)" — work in flight, and therefore blockable. */
export const BLOCKABLE_STATUSES = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'REVISION_REQUESTED',
] as const satisfies readonly TaskStatus[]

/**
 * Statuses in which a task still counts as owned work — the set Phase 1's
 * `OpenTaskLookup` was written against, kept here next to the machine that
 * produces them rather than duplicated in `modules/user`.
 */
export const OPEN_TASK_STATUSES = [
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'REVISION_REQUESTED',
  'APPROVED',
  'BLOCKED',
] as const satisfies readonly TaskStatus[]

/** The linear edges. BLOCKED and CANCELLED are derived below, not listed here. */
const CORE_EDGES: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  BACKLOG: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS'],
  IN_PROGRESS: ['SUBMITTED'],
  SUBMITTED: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'REVISION_REQUESTED'],
  REVISION_REQUESTED: ['IN_PROGRESS'],
  APPROVED: ['DONE'],
  DONE: [],
  BLOCKED: [],
  CANCELLED: [],
}

export function isFinal(status: TaskStatus): boolean {
  return (FINAL_STATUSES as readonly TaskStatus[]).includes(status)
}

export function isBlockable(status: TaskStatus): boolean {
  return (BLOCKABLE_STATUSES as readonly TaskStatus[]).includes(status)
}

export interface TransitionContext {
  /**
   * Only consulted when leaving BLOCKED. The service recovers it from the
   * `TaskActivity` row that recorded the block — which is why that feed is
   * load-bearing rather than decorative, and why there is no
   * `statusBeforeBlock` column to drift out of sync with it.
   */
  previousStatus?: TaskStatus | null
}

export function canTransition(
  from: TaskStatus,
  to: TaskStatus,
  context: TransitionContext = {},
): boolean {
  if (from === to) return false
  if (isFinal(from)) return false

  // any(non-final) → CANCELLED
  if (to === 'CANCELLED') return true

  // any(active) → BLOCKED
  if (to === 'BLOCKED') return isBlockable(from)

  // BLOCKED → previous
  if (from === 'BLOCKED') {
    const previous = context.previousStatus
    if (!previous) return false
    // A task can only have been blocked out of a blockable status, so restoring
    // it can only ever land back in one. The guard matters because
    // `previousStatus` arrives from a stored row.
    return isBlockable(previous) && to === previous
  }

  return CORE_EDGES[from].includes(to)
}

export function assertTransition(
  from: TaskStatus,
  to: TaskStatus,
  context: TransitionContext = {},
): void {
  if (!canTransition(from, to, context)) {
    throw new DomainError('tasks.errors.illegalTransition', { from, to })
  }
}

/** Every status reachable from `from` — what a UI draws as available actions. */
export function nextStatuses(
  from: TaskStatus,
  context: TransitionContext = {},
): TaskStatus[] {
  return TASK_STATUSES.filter((to) => canTransition(from, to, context))
}

// ─────────────────────────────────────────────────────────────────────────
// Timestamps (SPEC §5.1)
// ─────────────────────────────────────────────────────────────────────────

export type TaskTimestampField = 'assignedAt' | 'startedAt' | 'submittedAt' | 'approvedAt'

export type TaskTimestamps = Record<TaskTimestampField, Date | null>

export interface TimestampRule {
  field: TaskTimestampField
  /** False means "stamp once, then never again". */
  overwrite: boolean
}

/**
 * Which clock each transition winds, and whether it may be wound twice.
 *
 * `submittedAt` is the only `overwrite: true` entry, and the asymmetry is the
 * SPEC's, not a convenience: lateness for the current revision is measured
 * against the *current* delivery (§5.3, under the T4 rule that a revision sets
 * a new due date), while the original delivery instant survives as the
 * `createdAt` of the first `STATUS_CHANGED → SUBMITTED` activity row.
 *
 * The other three stamp once. Re-entering IN_PROGRESS after a revision does
 * not mean the work started again; a second approval does not re-approve.
 */
const TIMESTAMP_RULES: Partial<Record<TaskStatus, TimestampRule>> = {
  ASSIGNED: { field: 'assignedAt', overwrite: false },
  IN_PROGRESS: { field: 'startedAt', overwrite: false },
  SUBMITTED: { field: 'submittedAt', overwrite: true },
  APPROVED: { field: 'approvedAt', overwrite: false },
}

export function timestampRuleFor(status: TaskStatus): TimestampRule | null {
  return TIMESTAMP_RULES[status] ?? null
}

/**
 * The timestamp patch a transition produces — only the fields that actually
 * change, so a caller can spread it straight into a Prisma `update` without
 * risking an unrelated column being rewritten with its own value.
 *
 * `from` is optional and matters for exactly one edge: `BLOCKED → previous`.
 * Resuming is not an *entry* into a status — the task was already there when it
 * was blocked, and its clock was wound then. The two `overwrite: false` rules
 * would refuse a second stamp on their own, but `submittedAt` overwrites, so
 * without this guard unblocking a task that was blocked while SUBMITTED would
 * move its delivery instant forward to the moment the block was lifted. That is
 * lateness (§5.3) and elapsed time (§5.2) charged to the منفّذ for a wait that
 * was never theirs — the SPEC re-stamps `submittedAt` for *revisions*, not for
 * resumes.
 */
export function stampTimestamps(
  to: TaskStatus,
  current: TaskTimestamps,
  now: Date,
  from?: TaskStatus | null,
): Partial<TaskTimestamps> {
  const rule = timestampRuleFor(to)
  if (!rule) return {}
  if (from === 'BLOCKED') return {}
  if (!rule.overwrite && current[rule.field] !== null) return {}
  return { [rule.field]: now }
}
