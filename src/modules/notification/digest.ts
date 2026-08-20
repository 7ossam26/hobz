import { cairoDateKey } from '@/lib/calendar'
import type { Db } from '@/lib/db'
import {
  computeProjectHealth,
  effectiveProjectHealth,
  taskHealthSignals,
  TERMINAL_PROJECT_STATUSES,
  type ComputedHealth,
  type HealthThresholds,
} from '@/modules/project/health'

import { managerDigestMessage, type ManagerDigestSummary } from './messages'
import { managerIds } from './recipients'
import { deliverNotification } from './service'

/**
 * modules/notification/digest.ts — the phase brief's item 4:
 *
 *   > Daily manager digest at 08:00 Cairo (scheduler): overdue tasks, tasks
 *   > awaiting approval, at-risk projects. Delivered as a single in-app
 *   > notification with a summary view.
 *
 * "Single" is load-bearing twice over: one notification per manager (not one
 * per overdue task — SPEC §8 already covers that individually), and the
 * counts are computed **once** and reused for every recipient rather than
 * re-queried per person, since the answer does not depend on who is reading
 * it.
 */

export interface BuildManagerDigestArgs {
  now: Date
  healthThresholds: HealthThresholds
}

/** "In review" is the state between a delivery and a decision (SPEC §5.1) — the SPEC's "awaiting approval". */
async function awaitingApprovalCount(db: Db): Promise<number> {
  return db.task.count({
    where: { deletedAt: null, project: { deletedAt: null }, status: 'IN_REVIEW' },
  })
}

/** Mirrors `Task.overdueWorkingDays`, the same job-maintained column the board reads. */
async function overdueTaskCount(db: Db): Promise<number> {
  return db.task.count({
    where: {
      deletedAt: null,
      project: { deletedAt: null },
      status: { notIn: ['DONE', 'CANCELLED'] },
      overdueWorkingDays: { gt: 0 },
    },
  })
}

/**
 * Not GREEN, override included — the same computation `/projects` renders per
 * row (`modules/project/service.ts.toSummaryDto`), counted rather than listed.
 * O(projects) round trips, which is the project list's own shape; an organization
 * capped at ~100 people (SPEC §2) does not accumulate enough live projects for
 * that to matter on a once-daily job.
 */
async function atRiskProjectCount(
  db: Db,
  now: Date,
  thresholds: HealthThresholds,
): Promise<number> {
  const projects = await db.project.findMany({
    where: { deletedAt: null, status: { notIn: [...TERMINAL_PROJECT_STATUSES] } },
    select: {
      id: true,
      status: true,
      dueDate: true,
      healthOverride: true,
      healthReason: true,
    },
  })

  const lookup = taskHealthSignals(now)
  let atRisk = 0

  for (const project of projects) {
    const signals = await lookup(db, project.id)
    const computed = computeProjectHealth({
      status: project.status,
      dueDate: project.dueDate,
      now,
      signals,
      thresholds,
    })
    const health = effectiveProjectHealth(
      computed,
      project.healthOverride as ComputedHealth | null,
      project.healthReason,
    )
    if (health.health !== 'GREEN') atRisk += 1
  }

  return atRisk
}

export async function buildManagerDigest(
  db: Db,
  args: BuildManagerDigestArgs,
): Promise<ManagerDigestSummary> {
  const [overdue, awaiting, atRisk] = await Promise.all([
    overdueTaskCount(db),
    awaitingApprovalCount(db),
    atRiskProjectCount(db, args.now, args.healthThresholds),
  ])

  return {
    overdueCount: overdue,
    awaitingApprovalCount: awaiting,
    atRiskProjectCount: atRisk,
  }
}

export interface DeliverManagerDigestResult {
  recipients: number
  delivered: number
  summary: ManagerDigestSummary
}

/**
 * One summary, computed once, delivered to every SPEC §8 manager
 * (`recipients.ts`'s `managerIds`). `dedupeKey` is the Cairo date, so a job
 * that fires twice on the same day — a redeploy, a manual trigger — sends
 * nothing twice (CLAUDE.md invariant 6).
 */
export async function deliverManagerDigest(
  db: Db,
  args: BuildManagerDigestArgs,
): Promise<DeliverManagerDigestResult> {
  const summary = await buildManagerDigest(db, args)
  const message = managerDigestMessage(summary)
  const recipients = await managerIds(db)
  const dedupeKey = cairoDateKey(args.now)

  let delivered = 0
  for (const userId of recipients) {
    const result = await deliverNotification(db, {
      userId,
      type: 'MANAGER_DIGEST',
      message,
      dedupeKey,
    })
    if (result) delivered += 1
  }

  return { recipients: recipients.length, delivered, summary }
}
