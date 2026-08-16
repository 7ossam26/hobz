import type { Db } from '@/lib/db'

import type { EscalationLevel } from './escalation'

/**
 * modules/lateness/ports.ts — the two boundaries Phase 6 stops at.
 *
 * The same shape Phase 4 used for `TaskEventBus`/`LedgerPort`, and for the
 * same reason: this phase knows *that* a deduction needs recalculating and
 * *that* somebody should be told a task has slipped, but writing a
 * `LedgerEntry` belongs to the append-only path Phase 8 owns, and delivering a
 * notification belongs to Phase 9.
 *
 * They point opposite ways, which is why there are two of them.
 * `PenaltyPort` is a **command**: an extension was approved, the deduction is
 * now wrong, and that instruction has to arrive. `LatenessEventBus` is a
 * **notification**: this task crossed a threshold; whoever cares, react.
 */

// ─────────────────────────────────────────────────────────────────────────
// Penalty recomputation — the command
// ─────────────────────────────────────────────────────────────────────────

export interface PenaltyRecomputeRequest {
  taskId: string
  /**
   * Why the recomputation is owed. Carried through to Phase 8's audit trail so
   * a `REVERSAL` can say what caused it rather than appearing unexplained.
   */
  cause: 'extensionApproved' | 'statusChanged' | 'scheduled'
  at: Date
  /** The person whose decision triggered it. Null for the scheduler. */
  requestedById: string | null
}

export interface PenaltyPort {
  recompute(db: Db, request: PenaltyRecomputeRequest): Promise<void>
}

/**
 * Phase 6's implementation: there is no `LedgerEntry` table and no penalty
 * engine yet, so there is nothing to recompute.
 *
 * Deliberately *not* a `NotImplementedError` — throwing would make extension
 * approval impossible for two phases, and moving a deadline is a real need
 * that does not depend on the penalty engine existing.
 *
 * Nor is the request lost in the meantime: `decideExtension` writes an
 * `extension.penaltyRecomputeRequested` AuditLog row carrying the task and the
 * deciding manager *before* calling this, exactly as Phase 4 did for the
 * partial-payment intent. Phase 8 can replay every request raised while the
 * port was dark.
 */
export const noopPenaltyPort: PenaltyPort = {
  recompute: async () => {},
}

// ─────────────────────────────────────────────────────────────────────────
// Escalation — the notification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emitted the moment a task's escalation level *changes*, and never on a
 * nightly run that finds it unchanged. That is what makes the job idempotent
 * in the way that matters to a human: running it ten times sends one message,
 * not ten (CLAUDE.md invariant 6).
 */
export interface TaskEscalatedEvent {
  type: 'TaskEscalated'
  taskId: string
  projectId: string
  assigneeId: string | null
  from: EscalationLevel
  to: EscalationLevel
  lateWorkingDays: number
  dueDate: Date
  at: Date
}

/**
 * SPEC §8's "due soon" — fired once per `dueDate` (via `Notification`'s
 * `dedupeKey`, not a column here), for a task not yet late but due within
 * `settings.notifications.dueSoonHours`.
 */
export interface TaskDueSoonEvent {
  type: 'TaskDueSoon'
  taskId: string
  projectId: string
  taskTitle: string
  assigneeId: string | null
  dueDate: Date
  at: Date
}

/**
 * SPEC §8's "overdue" — fired on the transition into lateness (0 → >0 working
 * days late), not on every recompute of an already-overdue task. The nightly
 * job already computes exactly this comparison for `overdueWorkingDays`;
 * `modules/calendar/job.ts` reuses it rather than tracking a second flag.
 */
export interface TaskOverdueEvent {
  type: 'TaskOverdue'
  taskId: string
  projectId: string
  taskTitle: string
  assigneeId: string | null
  dueDate: Date
  lateWorkingDays: number
  at: Date
}

export type LatenessDomainEvent = TaskEscalatedEvent | TaskDueSoonEvent | TaskOverdueEvent

export interface LatenessEventBus {
  emit(db: Db, event: LatenessDomainEvent): Promise<void>
}

/**
 * Phase 6's bus: nobody is subscribed yet. The emission still happens on the
 * exact code path Phase 9's subscriber will sit on, and the integration tests
 * assert on the payload — so Phase 9 inherits a proven call site rather than a
 * comment promising one.
 */
export const noopLatenessEvents: LatenessEventBus = {
  emit: async () => {},
}
