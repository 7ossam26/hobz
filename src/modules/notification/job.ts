import { cairoParts } from '@/lib/calendar/cairo'
import { registerJob, type JobDefinition } from '@/lib/scheduler'
import { getSettings } from '@/lib/settings'

import { deliverManagerDigest } from './digest'

/**
 * modules/notification/job — the phase brief's "daily manager digest at 08:00
 * Cairo (scheduler)".
 *
 * Same shape as `modules/payout/job.ts`'s cycle-day check and for the same
 * reason (CLAUDE.md invariant 4): `notifications.digestHourCairo` is a
 * Setting, and a cron expression is compiled once at startup, so the cron
 * fires every hour and the handler asks Settings whether this is the hour. An
 * operator moving the digest from 08:00 to 09:00 takes effect on the next
 * tick, not on the next redeploy.
 */

export const MANAGER_DIGEST_JOB_NAME = 'notifications.managerDigest'

/** Every hour, on the hour, evaluated in Africa/Cairo by `lib/scheduler`. */
const MANAGER_DIGEST_CRON = '0 * * * *'

export const managerDigestJob: JobDefinition = {
  name: MANAGER_DIGEST_JOB_NAME,
  schedule: MANAGER_DIGEST_CRON,
  handler: async (ctx) => {
    const settings = await getSettings([
      'notifications.digestHourCairo',
      'health.overdueTasksThreshold',
      'health.blockedDaysThreshold',
      'health.amberDaysBeforeDue',
    ])

    if (cairoParts(ctx.runAt).hour !== settings['notifications.digestHourCairo']) return

    const outcome = await deliverManagerDigest(ctx.db, {
      now: ctx.runAt,
      healthThresholds: {
        overdueTasksThreshold: settings['health.overdueTasksThreshold'],
        blockedDaysThreshold: settings['health.blockedDaysThreshold'],
        amberDaysBeforeDue: settings['health.amberDaysBeforeDue'],
      },
    })

    console.info(
      `[${MANAGER_DIGEST_JOB_NAME}] recipients=${outcome.recipients} delivered=${outcome.delivered} overdue=${outcome.summary.overdueCount} awaiting=${outcome.summary.awaitingApprovalCount} atRisk=${outcome.summary.atRiskProjectCount}`,
    )
  },
}

/** Called once, from `src/instrumentation.ts`. */
export function registerNotificationJobs(): void {
  registerJob(managerDigestJob)
}
