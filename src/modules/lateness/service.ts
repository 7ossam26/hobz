import type { Prisma } from '@prisma/client'

import type { Calendar } from '@/lib/calendar'
import { addHours } from '@/lib/calendar/cairo'
import type { Db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import type { TaskStatus } from '@/modules/task/state-machine'

import {
  blockedIntervalsFromActivity,
  blockedIntervalsIn,
  type BlockedInterval,
  type StatusChangeRow,
} from './blocked'

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
 * **4. BLOCKED time does not accrue lateness.** The operator's decision, taken
 * after Phase 6 raised the question. A منفّذ who cannot work cannot be late for
 * not working, and this product exists to make deductions defensible.
 *
 * The exclusion is by **interval**, never by current status — see
 * `blocked.ts`, which explains why the naive reading is wrong in both
 * directions. Mechanically it is a subtraction: count the working days in the
 * window as before, then take out the working days inside the blocked stretches
 * that fall in the same window. Everything else survives untouched, because
 * both halves go through the *same* `workingDaysBetween` with the *same*
 * assignee — a blocked Friday, a blocked holiday and a blocked day of approved
 * leave are all worth zero on both sides of the subtraction, so none of them
 * can be excused twice.
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
  /**
   * Every stretch this task spent BLOCKED, from its activity feed.
   *
   * **Required, not optional with an empty default.** A task's blocked history
   * is an input to a deduction, and a caller that forgot to pass it would
   * silently get the pre-decision answer — a higher penalty, with nothing to
   * show anyone why. `[]` is a claim ("this task was never blocked"), so it has
   * to be made rather than assumed.
   */
  blockedIntervals: readonly BlockedInterval[]
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
  /**
   * Working days inside the window that were excused because the task was
   * BLOCKED. Already subtracted from `lateWorkingDays`; carried separately so
   * the breakdown SPEC §8 shows the منفّذ can say "five days late, two of them
   * excused" instead of quietly showing three.
   */
  blockedWorkingDays: number
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
 * What the task would be doing if it were not suspended.
 *
 * BLOCKED is not a phase of the work; it is a pause in whatever phase the task
 * was already in, which is why SPEC §5.1 resumes it to `previous` rather than
 * to a fixed status. For lateness that distinction decides whether the clock is
 * even running: a task blocked while SUBMITTED is still *delivered*, and review
 * time is not the worker's (SPEC §5.3). Reading the current status literally
 * would restart their clock the moment a manager blocked a task sitting in
 * review — the opposite of what the rule says.
 *
 * The pre-block status comes from the open interval's `from`, i.e. from the
 * same activity row the state machine reads to unblock.
 */
export function effectiveStatus(task: LatenessTaskInput): TaskStatus {
  if (task.status !== 'BLOCKED') return task.status
  const open = task.blockedIntervals.find((interval) => interval.end === null)
  return open?.from ?? task.status
}

/**
 * The delivery that stopped the worker's clock, or `null` while it is still
 * running. One predicate, because `measurementEnd` and `frozen` disagreeing
 * about whether a task has been delivered is exactly the bug this prevents.
 */
function deliveredAt(task: LatenessTaskInput): Date | null {
  return task.submittedAt !== null && DELIVERED_STATUSES.includes(effectiveStatus(task))
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
    return { ...base, lateWorkingDays: 0, blockedWorkingDays: 0 }
  }

  const userId = task.assigneeId ?? undefined
  const total = await calendar.workingDaysBetween(effectiveDueDate, measuredAt, userId)
  const blockedWorkingDays = await countBlockedWorkingDays(calendar, {
    intervals: task.blockedIntervals,
    from: effectiveDueDate,
    to: measuredAt,
    userId,
  })

  return {
    ...base,
    // `max(0, …)` cannot fire: the clipped blocked stretches live inside
    // `[effectiveDueDate, measuredAt)`, so the days they contribute are a
    // subset of the days `total` counted, and merging stops any of them being
    // taken out twice. It is here so that a calendar answering inconsistently
    // produces a zero rather than a negative deduction.
    lateWorkingDays: Math.max(0, total - blockedWorkingDays),
    blockedWorkingDays,
  }
}

export interface BlockedWorkingDaysArgs {
  intervals: readonly BlockedInterval[]
  from: Date
  to: Date
  userId: string | undefined
}

/**
 * Working days inside `[from, to)` that the task spent blocked.
 *
 * Deliberately measured with the **same** `workingDaysBetween` and the **same**
 * assignee as the total it will be subtracted from. That is what keeps every
 * other rule intact for free: a blocked Saturday, a blocked عيد and a blocked
 * day of approved leave are each worth zero on both sides, so none of them is
 * excused twice and none of them turns a real day of lateness into a negative.
 */
export async function countBlockedWorkingDays(
  calendar: Calendar,
  args: BlockedWorkingDaysArgs,
): Promise<number> {
  let days = 0
  for (const interval of blockedIntervalsIn(args.intervals, args.from, args.to)) {
    days += await calendar.workingDaysBetween(interval.start, interval.end, args.userId)
  }
  return days
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
  /**
   * The block/unblock rows, and only those. `TaskActivity` is where SPEC §5.1
   * already keeps the fact that a task was blocked and what it was blocked out
   * of, so lateness reads it rather than asking for a column of its own.
   *
   * Ordered `[createdAt, id]` — the tiebreak Phase 4 added because a frozen
   * clock in a test writes two rows at the same instant, and pairing an entry
   * with an exit depends on their order.
   */
  activity: {
    where: {
      type: 'STATUS_CHANGED',
      OR: [{ to: 'BLOCKED' }, { from: 'BLOCKED' }],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { from: true, to: true, createdAt: true },
  },
  // `satisfies`, not `as const`: the nested `where`/`orderBy` need Prisma's own
  // contextual types to narrow `'asc'` to `SortOrder`, and `as const` would
  // freeze them into readonly tuples Prisma's mutable input types reject.
} satisfies Prisma.TaskSelect

export interface LatenessRow {
  id: string
  status: string
  dueDate: Date
  originalDueDate: Date
  submittedAt: Date | null
  assigneeId: string | null
  project: { gracePeriodHours: number | null }
  activity: readonly StatusChangeRow[]
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
      blockedIntervals: blockedIntervalsFromActivity(row.activity),
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
