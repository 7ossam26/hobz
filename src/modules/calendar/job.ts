import { registerJob, type JobDefinition } from '@/lib/scheduler'
import { notificationLatenessEvents } from '@/modules/notification/bus'

import {
  SCHEDULE_RECOMPUTE_CRON,
  SCHEDULE_RECOMPUTE_JOB_NAME,
  runScheduleRecompute,
} from './recompute'

/**
 * modules/calendar/job — the *schedule*. The work lives in `./recompute`.
 *
 * The split is not tidiness. `lib/scheduler` imports `node-cron`, which reaches
 * for `child_process` and `path`; `modules/extension/actions.ts` calls
 * `recomputeTaskSchedule` after approving an extension, and Phase 12 put an
 * extensions tab on the task sheet — a **client** component. Importing the
 * action from there dragged `node-cron` into the client module graph, and Next
 * stopped emitting server references for that chunk: every action in it became
 * a plain function that resolved to `undefined` without ever reaching the
 * server. The symptom was silent and total — "اعتماد المهمة" closed its dialog,
 * showed no error, and approved nothing.
 *
 * So: a job's work must never require the thing that schedules it. Only
 * `src/instrumentation.ts` imports this file, and it does so behind a
 * `NEXT_RUNTIME === 'nodejs'` guard.
 */

export const scheduleRecomputeJob: JobDefinition = {
  name: SCHEDULE_RECOMPUTE_JOB_NAME,
  schedule: SCHEDULE_RECOMPUTE_CRON,
  // A whole-table recompute on a slow night should not lose the lock halfway.
  timeoutMs: 10 * 60_000,
  handler: async (ctx) => {
    const outcome = await runScheduleRecompute(ctx.db, {
      now: ctx.runAt,
      events: notificationLatenessEvents,
    })
    console.info(
      `[${SCHEDULE_RECOMPUTE_JOB_NAME}] scanned=${outcome.scanned} changed=${outcome.changed} escalated=${outcome.escalated} failed=${outcome.failed}`,
    )
  },
}

/** Called once, from `src/instrumentation.ts`. */
export function registerCalendarJobs(): void {
  registerJob(scheduleRecomputeJob)
}
