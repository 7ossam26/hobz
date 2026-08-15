import type { Calendar } from '@/lib/calendar'
import { addHours } from '@/lib/calendar/cairo'
import type { Db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import type { TaskStatus } from '@/modules/task/state-machine'

/**
 * modules/lateness/service.ts — SPEC §5.3, and nothing else.
 *
 * ```
 * lateWorkingDays = workingDaysBetween(dueDate + grace, min(now, submittedAt))
 * Grace: project override → global default.
 * Time sitting in review NEVER counts against the worker.
 * Approved leave never generates lateness.
 * ```
 *
 * Pure over an injected `Calendar`: no clock of its own, no Prisma in the
 * computation, no Settings lookup inside the arithmetic. That is what lets the
 * whole of `tests/unit/lateness/lateness.test.ts` pin every boundary in the
 * SPEC without a database, and it is what Phase 8's penalty engine will call.
 *
 * ── The three readings this file commits to ───────────────────────────────
 *
 * **1. What stops the clock is delivery, not review.** SPEC §5.3 says time in
 * review never counts against the منفّذ, and §5.4 says accrual "freezes the
 * moment the task reaches SUBMITTED". So the measurement endpoint is
 * `submittedAt` exactly while the task is *delivered* — SUBMITTED, IN_REVIEW,
 * APPROVED, DONE — and `now` otherwise. This is the same `DELIVERED_STATUSES`
 * set `modules/task/service.ts` computes `isOverdue` from, deliberately: a
 * task that shows an "overdue" flag in the list and a zero in the penalty
 * breakdown would be a support ticket every week.
 *
 * **2. REVISION_REQUESTED restarts the clock.** A revision sets a new due date
 * (SPEC T4) and the revision accrues against it. The previous `submittedAt` is
 * still on the row — it is the *last* delivery, not a delivery of this
 * revision — so freezing on it would make every revision costless. Falling out
 * of the delivered set is what handles that, with no special case.
 *
 * **3. CANCELLED is zero.** A cancelled task is not late; it is gone. Nothing
 * else in the product would ever act on a lateness figure for one, and
 * returning a positive number invites Phase 8 to deduct for work that was
 * called off.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * **BLOCKED does not pause the clock.** SPEC §5.4 computes from
 * `lateWorkingDays` and the user's profile, "nothing else", and SPEC §4 says
 * `delayAttribution` is recorded for reporting and explicitly does not feed
 * the penalty engine. Pausing on BLOCKED would be a new rule — a defensible
 * one, and arguably a fairer one when the block is the agency's fault — but it
 * is a policy change and belongs in docs/SPEC.md §5.3 before it belongs here.
 * Raised in docs/DECISIONS.md rather than decided quietly.
 */

/** The worker's clock has stopped: they delivered, and review time is not theirs. */
const DELIVERED_STATUSES: readonly TaskStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'DONE',
]

export interface LatenessTaskInput {
  id: string
  status: TaskStatus
  /** The deadline in force now — moved by an approved extension or a revision. */
  dueDate: Date
  /** The deadline the task was first given. Never moves (SPEC §5.3). */
  originalDueDate: Date
  submittedAt: Date | null
  /** Narrows the calendar by this person's approved leave. */
  assigneeId: string | null
}

export interface LatenessInput {
  task: LatenessTaskInput
  graceHours: number
  now: Date
}

/**
 * Everything the worker's notification needs to show (SPEC §8: "the full
 * calculation breakdown: due date, grace, working days late, formula,
 * amount"). Phase 8 supplies the last two; the first three are here.
 */
export interface LatenessResult {
  taskId: string
  lateWorkingDays: number
  dueDate: Date
  originalDueDate: Date
  graceHours: number
  /** `dueDate + grace` — where lateness actually starts counting. */
  effectiveDueDate: Date
  /** `min(now, submittedAt)` when delivered, `now` otherwise. */
  measuredAt: Date
  /** True when the clock has stopped, i.e. the number can no longer grow. */
  frozen: boolean
  /** True when an extension or a revision has moved the deadline. */
  extended: boolean
}

/**
 * SPEC §5.3: "Grace: project override → global default."
 *
 * `??`, never `||`. A project configured with **zero** grace has made a
 * decision, and `||` would silently overwrite it with the agency default —
 * turning "this client accepts no slippage" into "24 hours are fine".
 */
export function resolveGraceHours(
  projectOverride: number | null | undefined,
  globalDefault: number,
): number {
  return projectOverride ?? globalDefault
}

/**
 * The delivery that stopped the worker's clock, or `null` while it is still
 * running. One predicate, because `measurementEnd` and `frozen` disagreeing
 * about whether a task has been delivered is exactly the bug this prevents.
 */
function deliveredAt(task: LatenessTaskInput): Date | null {
  return task.submittedAt !== null && DELIVERED_STATUSES.includes(task.status)
    ? task.submittedAt
    : null
}

/** Where the measurement stops. Exported because the escalation job reasons
 *  about it too, and two copies of this rule would be one too many. */
export function measurementEnd(task: LatenessTaskInput, now: Date): Date {
  const delivered = deliveredAt(task)
  if (delivered === null) return now
  // `min(now, submittedAt)`, stated literally from the SPEC. Clock skew
  // between two containers must never manufacture days of lateness.
  return delivered.getTime() < now.getTime() ? delivered : now
}

export async function computeLateness(
  calendar: Calendar,
  input: LatenessInput,
): Promise<LatenessResult> {
  const { task, graceHours, now } = input

  const effectiveDueDate = addHours(task.dueDate, graceHours)
  const measuredAt = measurementEnd(task, now)
  // Read off the delivery, not off `measuredAt !== now`. At the instant
  // `submittedAt === now` the endpoint has already reached its cap — the count
  // cannot move again — but the identity comparison returns the very same
  // `now` object and reports the clock still running, for one instant, with no
  // change in the number the منفّذ is shown.
  const delivered = deliveredAt(task)
  const frozen = delivered !== null && delivered.getTime() <= now.getTime()

  const base = {
    taskId: task.id,
    dueDate: task.dueDate,
    originalDueDate: task.originalDueDate,
    graceHours,
    effectiveDueDate,
    measuredAt,
    frozen,
    extended: task.dueDate.getTime() !== task.originalDueDate.getTime(),
  }

  if (task.status === 'CANCELLED') {
    return { ...base, lateWorkingDays: 0 }
  }

  const lateWorkingDays = await calendar.workingDaysBetween(
    effectiveDueDate,
    measuredAt,
    task.assigneeId ?? undefined,
  )

  return { ...base, lateWorkingDays }
}

// ─────────────────────────────────────────────────────────────────────────
// The database-facing wrapper
// ─────────────────────────────────────────────────────────────────────────

/**
 * Exactly the columns lateness needs, and the project's grace override with
 * them. Exported so the nightly job selects the same shape rather than
 * inventing a second one that drifts.
 */
export const LATENESS_TASK_SELECT = {
  id: true,
  status: true,
  dueDate: true,
  originalDueDate: true,
  submittedAt: true,
  assigneeId: true,
  project: { select: { gracePeriodHours: true } },
} as const

export interface LatenessRow {
  id: string
  status: string
  dueDate: Date
  originalDueDate: Date
  submittedAt: Date | null
  assigneeId: string | null
  project: { gracePeriodHours: number | null }
}

export function latenessInputFromRow(
  row: LatenessRow,
  defaultGraceHours: number,
  now: Date,
): LatenessInput {
  return {
    task: {
      id: row.id,
      status: row.status as TaskStatus,
      dueDate: row.dueDate,
      originalDueDate: row.originalDueDate,
      submittedAt: row.submittedAt,
      assigneeId: row.assigneeId,
    },
    graceHours: resolveGraceHours(row.project.gracePeriodHours, defaultGraceHours),
    now,
  }
}

export interface LatenessForTaskArgs {
  taskId: string
  calendar: Calendar
  /** From `getSetting('penalty.defaultGraceHours')`, passed in by the caller. */
  defaultGraceHours: number
  now: Date
}

/** One task's lateness, read through the same soft-delete guard everything else uses. */
export async function latenessForTask(
  db: Db,
  args: LatenessForTaskArgs,
): Promise<LatenessResult> {
  const row = await db.task.findFirst({
    where: { id: args.taskId, deletedAt: null, project: { deletedAt: null } },
    select: LATENESS_TASK_SELECT,
  })
  if (!row) throw new NotFoundError('Task', args.taskId)

  return computeLateness(
    args.calendar,
    latenessInputFromRow(row as LatenessRow, args.defaultGraceHours, args.now),
  )
}
