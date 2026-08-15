import type { Db } from '@/lib/db'

/**
 * modules/task/ports.ts — the two boundaries Phase 4 stops at.
 *
 * The task domain decides *that* someone earned money and *that* a previous
 * assignee is owed a partial amount. It never writes a `LedgerEntry`, because
 * the ledger is Phase 7's and because CLAUDE.md invariant 1 puts every entry
 * behind one append-only path. Both directions are expressed here, and both are
 * no-ops today — the same shape Phase 1 used for `OpenTaskLookup` and Phase 3
 * for `TaskHealthLookup`.
 *
 * ── Why two ports and not one ─────────────────────────────────────────────
 *
 * They point opposite ways, and collapsing them would blur that.
 * `TaskEventBus` is *notification*: "this happened; whoever cares, react."
 * The task does not know or care that an EARNING follows. `LedgerPort` is a
 * *command*: a human answered "pay the previous assignee?" with a number, and
 * that instruction has to reach the ledger intact. An event that must be
 * handled is not an event.
 */

// ─────────────────────────────────────────────────────────────────────────
// Ledger — the SPEC M4 "pay previous assignee?" decision
// ─────────────────────────────────────────────────────────────────────────

/**
 * A manual `ADJUSTMENT` waiting for a ledger to land in.
 *
 * `amount` is a canonical 2dp string from `lib/money`, never a `number`
 * (CLAUDE.md invariant 2) — it crosses a module boundary, and a float here
 * would be a float in someone's payout.
 */
export interface AdjustmentIntent {
  /** The previous assignee — the person being paid for partial work. */
  userId: string
  taskId: string
  /** Positive: a credit to the worker. `lib/money` storage string. */
  amount: string
  note: string
  /** The manager who made the call. */
  createdById: string
  at: Date
}

export interface LedgerPort {
  recordAdjustment(db: Db, intent: AdjustmentIntent): Promise<void>
}

/**
 * Phase 4's implementation: there is no `LedgerEntry` table yet, so there is
 * nothing to insert.
 *
 * Deliberately *not* a `NotImplementedError` — throwing would make mid-task
 * reassignment impossible for four phases, and reassignment is a real need
 * that does not depend on the ledger existing.
 *
 * Nor is the decision lost in the meantime: `assignTask` writes an
 * `task.partialPaymentIntent` AuditLog row carrying the amount, the previous
 * assignee and the deciding manager, *before* calling this. Phase 7 can
 * therefore replay every intent recorded while the port was dark, and no
 * manager's "pay them 300" evaporates because the table was late.
 */
export const noopLedgerPort: LedgerPort = {
  recordAdjustment: async () => {},
}

// ─────────────────────────────────────────────────────────────────────────
// Domain events
// ─────────────────────────────────────────────────────────────────────────

/**
 * SPEC §5.1: "APPROVED is the only event that creates an EARNING ledger entry."
 * Phase 7 subscribes to this; Phase 9 will subscribe for the notification.
 */
export interface TaskApprovedEvent {
  type: 'TaskApproved'
  taskId: string
  projectId: string
  /** Null is possible in principle; Phase 7 has nobody to pay in that case. */
  assigneeId: string | null
  /** `lib/money` storage string — what the EARNING entry will be worth. */
  taskValue: string
  qualityRating: number
  approvedAt: Date
  approvedById: string
}

/**
 * Emitted for every cancellation, with `wasApproved` telling Phase 7 whether an
 * EARNING already exists and therefore needs a `REVERSAL`.
 *
 * SPEC §5.1 makes `APPROVED → CANCELLED` legal (APPROVED is not one of the two
 * final statuses), which means a cancellation can land after the money did.
 * Rather than quietly forbid that transition to dodge the problem, the task
 * domain states the fact and lets the ledger owner correct itself — the
 * append-only way.
 */
export interface TaskCancelledEvent {
  type: 'TaskCancelled'
  taskId: string
  projectId: string
  assigneeId: string | null
  wasApproved: boolean
  cancelledAt: Date
  cancelledById: string
  reason: string
}

export type TaskDomainEvent = TaskApprovedEvent | TaskCancelledEvent

export interface TaskEventBus {
  emit(db: Db, event: TaskDomainEvent): Promise<void>
}

/**
 * Phase 4's bus: nobody is subscribed yet.
 *
 * The emission still happens on the exact code path the real subscriber will
 * sit on, and the integration tests assert on the emitted payload — so Phase 7
 * inherits a proven call site rather than a comment promising one.
 */
export const noopTaskEvents: TaskEventBus = {
  emit: async () => {},
}
