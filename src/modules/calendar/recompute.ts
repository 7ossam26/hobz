import { recordAudit } from '@/lib/audit'
import {
  cairoDateKey,
  addCairoDays,
  createCalendar,
  snapshotCalendarSource,
  type Calendar,
} from '@/lib/calendar'
import type { Db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import {
  escalationLevelFor,
  nextEscalationLevel,
  type EscalationLevel,
  type EscalationThresholds,
} from '@/modules/lateness/escalation'
import { noopLatenessEvents, type LatenessEventBus } from '@/modules/lateness/ports'
import {
  computeLateness,
  latenessInputFromRow,
  LATENESS_TASK_SELECT,
  type LatenessRow,
} from '@/modules/lateness/service'
import { recomputeElapsed } from '@/modules/task/service'

/**
 * modules/calendar/recompute.ts — the 03:00 Cairo recomputation (phase brief §8).
 *
 * The *work*. `./job.ts` holds the cron entry that runs it, and holds it alone,
 * so that a caller who needs the recomputation — `modules/extension/actions.ts`
 * after an approved extension — does not have to import `node-cron` to get it.
 * See the note in `./job.ts` for what that cost before Phase 12 split them.
 *
 *   > Scheduled job (03:00 Cairo) recomputing elapsed working time and overdue
 *   > flags, running under the advisory lock, idempotent.
 *
 * ── What "idempotent" means here, concretely ──────────────────────────────
 *
 * Everything this job writes is a **pure function of data it did not write**:
 * `assignedAt`, `submittedAt`, the task's status, the calendar, and the
 * Settings thresholds. Running it ten times therefore produces the same three
 * columns ten times. Two further rules keep the *side effects* idempotent too,
 * which is the half that a naive "just recompute" gets wrong:
 *
 *  - A row is written only when a value actually changed, so a quiet night
 *    leaves no `updatedAt` churn and no activity-feed spam.
 *  - A `TaskEscalated` event fires only on a level **change**, so ten runs
 *    send one notification rather than ten (CLAUDE.md invariant 6).
 *
 * ── Why it does not compute penalties ─────────────────────────────────────
 *
 * SPEC §5.4's daily penalty job is Phase 8's, and it is a separate job on the
 * same schedule for a reason: this one writes derived columns, that one writes
 * to the append-only ledger. Sharing a handler would put a ledger insert
 * behind a lock held for the duration of a whole-table recompute.
 */

export const SCHEDULE_RECOMPUTE_JOB_NAME = 'calendar.recomputeSchedule'

/** 03:00 Cairo, per SPEC §5.4 and the phase brief. Evaluated in Africa/Cairo. */
export const SCHEDULE_RECOMPUTE_CRON = '0 3 * * *'

/**
 * Rows per query. Small enough that one bad batch is cheap to retry, large
 * enough that an agency-sized backlog is a handful of round trips.
 */
const BATCH_SIZE = 200

/**
 * A backstop, not a business number: past this the job stops and *says so*
 * rather than running until the lock times out. A silent truncation would read
 * as "everything is up to date" when it is not.
 */
const MAX_TASKS_PER_RUN = 20_000

/** Statuses whose derived numbers can still move. DONE and CANCELLED are final. */
const RECOMPUTABLE_STATUSES = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'REVISION_REQUESTED',
  'APPROVED',
  'BLOCKED',
] as const

const TASK_SELECT = {
  ...LATENESS_TASK_SELECT,
  projectId: true,
  title: true,
  assignedAt: true,
  overdueWorkingDays: true,
  escalationLevel: true,
} as const

interface ScheduleRow extends LatenessRow {
  projectId: string
  title: string
  assignedAt: Date | null
  overdueWorkingDays: number
  escalationLevel: string
}

/** Statuses a due-soon reminder makes sense for — work still ahead of delivery. */
const PRE_DELIVERY_STATUSES: readonly string[] = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'REVISION_REQUESTED',
  'BLOCKED',
]

export interface TaskScheduleResult {
  taskId: string
  elapsedMinutesRaw: number
  elapsedMinutesWorking: number
  lateWorkingDays: number
  escalationLevel: EscalationLevel
  /** True when the level moved, and therefore when an event was emitted. */
  escalationChanged: boolean
}

export interface RecomputeTaskScheduleArgs {
  taskId: string
  calendar: Calendar
  defaultGraceHours: number
  thresholds: EscalationThresholds
  /** Settings `notifications.dueSoonHours` (CLAUDE.md invariant 4). */
  dueSoonHours: number
  now: Date
  events?: LatenessEventBus
}

/**
 * One task's derived schedule columns. Exported because approving an extension
 * should not leave a stale red flag on the board until 03:00 — the extension
 * action calls this for the one task it touched.
 */
export async function recomputeTaskSchedule(
  db: Db,
  args: RecomputeTaskScheduleArgs,
): Promise<TaskScheduleResult> {
  const events = args.events ?? noopLatenessEvents

  // Elapsed stays `modules/task`'s to write — one owner for those two columns
  // (SPEC §4), and it is already idempotent and already writes its own
  // activity row only when a value moved.
  const elapsed = await recomputeElapsed(db, {
    taskId: args.taskId,
    calendar: args.calendar,
    actor: null,
    now: args.now,
  })

  const row = (await db.task.findFirstOrThrow({
    where: { id: args.taskId, deletedAt: null, project: { deletedAt: null } },
    select: TASK_SELECT,
  })) as unknown as ScheduleRow

  const lateness = await computeLateness(
    args.calendar,
    latenessInputFromRow(row, args.defaultGraceHours, args.now),
  )

  const current = row.escalationLevel as EscalationLevel
  const level = nextEscalationLevel(
    current,
    escalationLevelFor(lateness.lateWorkingDays, args.thresholds),
  )

  const escalationChanged = level !== current
  const daysChanged = lateness.lateWorkingDays !== row.overdueWorkingDays

  if (daysChanged || escalationChanged) {
    await db.task.update({
      where: { id: row.id },
      data: {
        overdueWorkingDays: lateness.lateWorkingDays,
        ...(escalationChanged
          ? {
              escalationLevel: level,
              // Cleared when the flag drops, so "escalated since" never
              // outlives the escalation it describes.
              escalatedAt: level === 'NONE' ? null : args.now,
            }
          : {}),
      },
    })
  }

  if (escalationChanged) {
    await recordAudit(db, {
      // Null actor: the scheduler is not a person (lib/audit).
      actor: null,
      action: 'task.escalated',
      entity: 'Task',
      entityId: row.id,
      before: { escalationLevel: current },
      after: {
        escalationLevel: level,
        lateWorkingDays: lateness.lateWorkingDays,
        dueDate: row.dueDate,
      },
    })

    await events.emit(db, {
      type: 'TaskEscalated',
      taskId: row.id,
      projectId: row.projectId,
      assigneeId: row.assigneeId,
      from: current,
      to: level,
      lateWorkingDays: lateness.lateWorkingDays,
      dueDate: row.dueDate,
      at: args.now,
    })
  }

  // SPEC §8's "overdue" — fired on the transition into lateness, never on an
  // already-overdue task's nightly recompute. Mirrors the escalation rule
  // immediately above: an edge, not a level, is what makes ten runs send one
  // notification (CLAUDE.md invariant 6).
  if (row.overdueWorkingDays === 0 && lateness.lateWorkingDays > 0) {
    await events.emit(db, {
      type: 'TaskOverdue',
      taskId: row.id,
      projectId: row.projectId,
      taskTitle: row.title,
      assigneeId: row.assigneeId,
      dueDate: row.dueDate,
      lateWorkingDays: lateness.lateWorkingDays,
      at: args.now,
    })
  }

  // SPEC §8's "due soon" — a task not yet late, due within
  // `notifications.dueSoonHours`, and not yet delivered. `Notification`'s
  // `dedupeKey` (keyed on the due date) is what stops this firing every night
  // for the same deadline — there is no column here tracking "already told".
  const hoursUntilDue = (row.dueDate.getTime() - args.now.getTime()) / (60 * 60 * 1000)
  if (
    PRE_DELIVERY_STATUSES.includes(row.status) &&
    lateness.lateWorkingDays === 0 &&
    hoursUntilDue > 0 &&
    hoursUntilDue <= args.dueSoonHours
  ) {
    await events.emit(db, {
      type: 'TaskDueSoon',
      taskId: row.id,
      projectId: row.projectId,
      taskTitle: row.title,
      assigneeId: row.assigneeId,
      dueDate: row.dueDate,
      at: args.now,
    })
  }

  return {
    taskId: row.id,
    elapsedMinutesRaw: elapsed.raw,
    elapsedMinutesWorking: elapsed.working,
    lateWorkingDays: lateness.lateWorkingDays,
    escalationLevel: level,
    escalationChanged,
  }
}

export interface RecomputeScheduleRunArgs {
  now: Date
  events?: LatenessEventBus
  /** Test seam: the whole run in one batch, or many. */
  batchSize?: number
}

export interface RecomputeScheduleRunResult {
  scanned: number
  changed: number
  escalated: number
  failed: number
  /** True when `MAX_TASKS_PER_RUN` stopped the run before the work ran out. */
  truncated: boolean
}

/**
 * The whole sweep. Batched by id cursor rather than `skip`, so a write during
 * the run cannot make the pager skip a row.
 */
export async function runScheduleRecompute(
  db: Db,
  args: RecomputeScheduleRunArgs,
): Promise<RecomputeScheduleRunResult> {
  const batchSize = args.batchSize ?? BATCH_SIZE

  const settings = await getSettings([
    'penalty.defaultGraceHours',
    'notifications.escalateToPmAfterDays',
    'notifications.escalateToAdminAfterDays',
    'notifications.dueSoonHours',
  ])
  const thresholds: EscalationThresholds = {
    pmAfterDays: settings['notifications.escalateToPmAfterDays'],
    adminAfterDays: settings['notifications.escalateToAdminAfterDays'],
  }

  const result: RecomputeScheduleRunResult = {
    scanned: 0,
    changed: 0,
    escalated: 0,
    failed: 0,
    truncated: false,
  }

  let cursor: string | undefined

  for (;;) {
    const batch = await db.task.findMany({
      where: {
        deletedAt: null,
        project: { deletedAt: null },
        status: { in: [...RECOMPUTABLE_STATUSES] },
      },
      select: {
        id: true,
        assigneeId: true,
        assignedAt: true,
        dueDate: true,
        overdueWorkingDays: true,
        escalationLevel: true,
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    if (batch.length === 0) break

    if (result.scanned + batch.length > MAX_TASKS_PER_RUN) {
      result.truncated = true
      console.warn(
        `[${SCHEDULE_RECOMPUTE_JOB_NAME}] stopped at ${MAX_TASKS_PER_RUN} tasks; more remain`,
      )
      break
    }

    // One holiday query and one leave query for the whole batch. The window is
    // widened past the batch's own dates so that a task assigned last year and
    // a deadline next month are both inside it; anything outside falls through
    // to a live query rather than to a wrong answer.
    const dates = batch.flatMap((task) =>
      [task.assignedAt, task.dueDate].filter((d): d is Date => d !== null),
    )
    const keys = [...dates, args.now].map(cairoDateKey).sort()
    const source = await snapshotCalendarSource(db, {
      from: addCairoDays(keys[0] as string, -30),
      to: addCairoDays(keys[keys.length - 1] as string, 30),
      userIds: [
        ...new Set(
          batch.map((t) => t.assigneeId).filter((id): id is string => id !== null),
        ),
      ],
    })
    const calendar = createCalendar(source)

    for (const task of batch) {
      result.scanned += 1
      try {
        const outcome = await recomputeTaskSchedule(db, {
          taskId: task.id,
          calendar,
          defaultGraceHours: settings['penalty.defaultGraceHours'],
          thresholds,
          dueSoonHours: settings['notifications.dueSoonHours'],
          now: args.now,
          ...(args.events ? { events: args.events } : {}),
        })
        if (
          outcome.escalationChanged ||
          outcome.lateWorkingDays !== task.overdueWorkingDays
        ) {
          result.changed += 1
        }
        if (outcome.escalationChanged) result.escalated += 1
      } catch (error) {
        // One unreadable task must not abort the night. Counted and logged so
        // the failure is visible rather than absorbed.
        result.failed += 1
        console.error(`[${SCHEDULE_RECOMPUTE_JOB_NAME}] task ${task.id} failed`, error)
      }
    }

    cursor = batch[batch.length - 1]?.id
    if (batch.length < batchSize) break
  }

  return result
}
