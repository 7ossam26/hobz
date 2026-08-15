import { cairoParts } from '@/lib/calendar/cairo'
import type { DbClient } from '@/lib/db'
import { registerJob, withAdvisoryLock, type JobDefinition } from '@/lib/scheduler'
import { getSettings } from '@/lib/settings'

import { closeCycle, type CloseCycleArgs } from './service'
import type { CloseCycleResult } from './types'

/**
 * modules/payout/job — the automatic close (SPEC §5.5).
 *
 *   > Cycle auto-closes on `settings.payoutCycleDay` (default 28) at 23:59 Cairo.
 *
 * ── Why the cron fires nightly and the day is checked in the handler ──────
 *
 * The day is a Setting (CLAUDE.md invariant 4), and a cron expression is
 * compiled once at startup. Encoding `28` into `59 23 28 * *` would mean an
 * operator changing the cycle day in Settings changes nothing until somebody
 * redeploys — the exact failure invariant 4 exists to prevent. So the schedule
 * is "every night at 23:59 Cairo" and the handler asks Settings whether tonight
 * is the night. A no-op tick costs one indexed read.
 */

export const CLOSE_CYCLE_JOB_NAME = 'payout.closeCycle'

/** 23:59, evaluated in Africa/Cairo by `lib/scheduler`. */
const CLOSE_CYCLE_CRON = '59 23 * * *'

export interface GuardedCloseResult {
  acquired: boolean
  result: CloseCycleResult | null
}

/**
 * Close under the same advisory lock the scheduled job takes.
 *
 * The manual "close early" action goes through here too, and deliberately
 * contends for the *same* key — a manager clicking the button at 23:59 on the
 * 28th must not race the scheduler into two closes. Whichever arrives second is
 * told the lock was held and does nothing, which is the correct outcome rather
 * than an error: the cycle it wanted closed is being closed.
 */
export async function closeCycleUnderLock(
  client: DbClient,
  args: CloseCycleArgs,
): Promise<GuardedCloseResult> {
  const outcome = await withAdvisoryLock(
    client,
    CLOSE_CYCLE_JOB_NAME,
    (tx) => closeCycle(tx, args),
    { timeoutMs: CLOSE_CYCLE_TIMEOUT_MS },
  )

  return outcome.acquired
    ? { acquired: true, result: outcome.result }
    : { acquired: false, result: null }
}

/** A close over ~100 workers is a handful of grouped queries and N inserts. */
const CLOSE_CYCLE_TIMEOUT_MS = 10 * 60_000

export const closeCycleJob: JobDefinition = {
  name: CLOSE_CYCLE_JOB_NAME,
  schedule: CLOSE_CYCLE_CRON,
  timeoutMs: CLOSE_CYCLE_TIMEOUT_MS,
  handler: async (ctx) => {
    const settings = await getSettings(['payout.cycleDay'])
    const cycleDay = settings['payout.cycleDay']

    // `runJob` already holds the lock, so the handler closes directly rather
    // than through `closeCycleUnderLock` — taking the same key twice inside one
    // transaction is at best pointless and at worst a deadlock.
    const today = cairoParts(ctx.runAt).day
    if (today !== cycleDay) return

    const result = await closeCycle(ctx.db, {
      // Null actor: the scheduler is not a person (lib/audit).
      actor: null,
      now: ctx.runAt,
      cycleDay,
    })

    console.info(
      `[${CLOSE_CYCLE_JOB_NAME}] closed=${result.closed} cycle=${result.cycleId ?? '-'} payouts=${result.payoutsCreated} salaries=${result.salaryEntries}`,
    )
  },
}

/** Called once, from `src/instrumentation.ts`. */
export function registerPayoutJobs(): void {
  registerJob(closeCycleJob)
}
