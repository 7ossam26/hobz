import {
  addCairoDays,
  cairoDateKey,
  createCalendar,
  snapshotCalendarSource,
} from '@/lib/calendar'
import type { Db } from '@/lib/db'
import { registerJob, type JobDefinition } from '@/lib/scheduler'

import { PENALTY_STATUSES } from './assess'
import { noopMoneyEvents, type MoneyEventBus } from './ports'
import { recomputeTaskPenalty } from './service'
import { loadPenaltySettings } from './settings'
import type { PenaltyJobResult } from './types'

/**
 * modules/penalty/job — SPEC §5.4's "Runs daily (03:00 Cairo)".
 *
 * ── Why this is a second job at the same time, and not a bigger first one ──
 *
 * `modules/calendar/job.ts` already sweeps every task at 03:00 Cairo, and Phase
 * 6 recorded why this one is separate rather than folded into it: that job
 * writes *derived columns* on `tasks`, this one writes to the *append-only
 * ledger*. Sharing a handler would hold one advisory lock across a whole-table
 * recompute and a run of money writes, so a slow scan would block the
 * deductions and a failing deduction would roll back the scan.
 *
 * They also fail differently, and should. A task whose elapsed time cannot be
 * recomputed leaves a stale number on a dashboard. A task whose deduction
 * cannot be computed is somebody's pay — it is counted, logged and left alone,
 * never guessed at.
 *
 * ── Idempotency ───────────────────────────────────────────────────────────
 *
 * None of it lives here. `recomputeTaskPenalty` writes only when the target
 * differs from what the ledger holds, so this job is idempotent because every
 * task it touches is (CLAUDE.md invariant 6). Running it ten times in a row
 * produces one `PENALTY` per late task and zero reversals — see
 * `tests/integration/penalty/idempotency.test.ts`.
 */

export const PENALTY_RECOMPUTE_JOB_NAME = 'penalty.recompute'

/** 03:00 Cairo, per SPEC §5.4. Evaluated in Africa/Cairo by `lib/scheduler`. */
const PENALTY_RECOMPUTE_CRON = '0 3 * * *'

/** Money writes are heavier than column updates, so the batch is smaller. */
const BATCH_SIZE = 100

/**
 * A backstop, not a business number: past this the job stops and *says so*
 * rather than running until the lock times out. Silent truncation would read as
 * "every deduction is up to date" when it is not.
 */
const MAX_TASKS_PER_RUN = 20_000

const emptyResult = (): PenaltyJobResult => ({
  scanned: 0,
  applied: 0,
  recalculated: 0,
  cleared: 0,
  unchanged: 0,
  skipped: 0,
  locked: 0,
  failed: 0,
  truncated: false,
})

export interface RunPenaltyRecomputeArgs {
  now: Date
  events?: MoneyEventBus
  /** Test seam: the whole run in one batch, or many. */
  batchSize?: number
}

/**
 * The nightly sweep.
 *
 * Batched by id cursor rather than `skip`, so a write during the run cannot
 * make the pager step over a task — the same choice `modules/calendar/job.ts`
 * makes, and it matters more here: a skipped task is a deduction that silently
 * did not happen.
 *
 * **DONE and CANCELLED are not scanned**, and that is not an omission. Both are
 * reached through `transitionTask`, which calls this same recomputation on the
 * way in (SPEC §5.4: "and on every task status change"). A cancelled task's
 * lateness is zero by SPEC §5.3, so that transition is what reverses its
 * accrued penalty to zero; scanning them again every night would re-derive the
 * same answer for tasks that can no longer move.
 */
export async function runPenaltyRecompute(
  db: Db,
  args: RunPenaltyRecomputeArgs,
): Promise<PenaltyJobResult> {
  const batchSize = args.batchSize ?? BATCH_SIZE
  const settings = await loadPenaltySettings()
  const events = args.events ?? noopMoneyEvents
  const result = emptyResult()

  let cursor: string | undefined

  for (;;) {
    const batch = await db.task.findMany({
      where: {
        deletedAt: null,
        project: { deletedAt: null },
        status: { in: [...PENALTY_STATUSES] },
      },
      select: { id: true, assigneeId: true, dueDate: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    if (batch.length === 0) break

    if (result.scanned + batch.length > MAX_TASKS_PER_RUN) {
      result.truncated = true
      console.warn(
        `[${PENALTY_RECOMPUTE_JOB_NAME}] stopped at ${MAX_TASKS_PER_RUN} tasks; more remain`,
      )
      break
    }

    // One holiday query and one leave query for the whole batch — the calendar
    // is the expensive dependency, and asking it per task would turn a hundred
    // deductions into two hundred round trips. The window is widened past the
    // batch's own dates so a deadline last quarter and one next month are both
    // inside it.
    const keys = [...batch.map((t) => t.dueDate), args.now].map(cairoDateKey).sort()
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
        const outcome = await recomputeTaskPenalty(db, {
          taskId: task.id,
          calendar,
          settings,
          cycleDay: settings.cycleDay,
          cause: 'scheduled',
          now: args.now,
          // Null actor: the scheduler is not a person (lib/audit). This is what
          // makes "the system decided this, not your manager" literally true in
          // the audit trail a منفّذ can be shown.
          actor: null,
          events,
        })

        if (outcome.outcome === 'applied') result.applied += 1
        else if (outcome.outcome === 'recalculated') result.recalculated += 1
        else if (outcome.outcome === 'cleared') result.cleared += 1
        else if (outcome.outcome === 'unchanged') result.unchanged += 1
        else if (outcome.outcome === 'skipped') result.skipped += 1
        else if (outcome.outcome === 'locked') result.locked += 1
      } catch (error) {
        // One unreadable task must not abort the night — and must not silently
        // vanish either. Counted and logged, so a deduction that did not happen
        // is visible in the morning.
        result.failed += 1
        console.error(`[${PENALTY_RECOMPUTE_JOB_NAME}] task ${task.id} failed`, error)
      }
    }

    cursor = batch[batch.length - 1]?.id
    if (batch.length < batchSize) break
  }

  return result
}

export const penaltyRecomputeJob: JobDefinition = {
  name: PENALTY_RECOMPUTE_JOB_NAME,
  schedule: PENALTY_RECOMPUTE_CRON,
  // A ledger write per late task, over an agency-sized backlog.
  timeoutMs: 10 * 60_000,
  handler: async (ctx) => {
    const outcome = await runPenaltyRecompute(ctx.db, { now: ctx.runAt })
    console.info(
      `[${PENALTY_RECOMPUTE_JOB_NAME}] scanned=${outcome.scanned} applied=${outcome.applied} recalculated=${outcome.recalculated} cleared=${outcome.cleared} unchanged=${outcome.unchanged} skipped=${outcome.skipped} locked=${outcome.locked} failed=${outcome.failed}`,
    )
  },
}

/** Called once, from `src/instrumentation.ts`. */
export function registerPenaltyJobs(): void {
  registerJob(penaltyRecomputeJob)
}
