import type { Db } from '@/lib/db'

import type { TaskPerformanceFact } from './service'

/**
 * modules/performance/facts.ts — where the score's inputs come from.
 *
 * "Completed", for this file, is `APPROVED` or `DONE` — a task that earned an
 * on-approval quality rating and is no longer the worker's open work. Neither
 * `CANCELLED` nor anything still in flight counts toward volume, on-time rate
 * or estimate accuracy; there is nothing to measure on work that was called
 * off or never delivered.
 */
const COMPLETED_STATUSES = ['APPROVED', 'DONE'] as const

/**
 * One worker's facts, straight off already-denormalised columns —
 * `overdueWorkingDays` is `modules/lateness/service.ts`'s frozen figure
 * (`modules/calendar/job.ts` recomputes it nightly for every `APPROVED` task,
 * and it stops moving the moment the task is delivered), so this is a plain
 * indexed read, never a second lateness computation.
 */
export async function taskFactsForUser(
  db: Db,
  userId: string,
): Promise<TaskPerformanceFact[]> {
  const rows = await db.task.findMany({
    where: {
      assigneeId: userId,
      deletedAt: null,
      project: { deletedAt: null },
      status: { in: [...COMPLETED_STATUSES] },
    },
    select: {
      overdueWorkingDays: true,
      qualityRating: true,
      estimatedHours: true,
      elapsedMinutesWorking: true,
    },
  })

  return rows.map((row) => ({
    onTime: row.overdueWorkingDays === 0,
    qualityRating: row.qualityRating,
    estimatedHours: Number(row.estimatedHours),
    actualWorkingHours: row.elapsedMinutesWorking / 60,
  }))
}

/** Completed task count per worker, in one indexed `groupBy` for the whole set. */
export async function completedVolumeByUserId(
  db: Db,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map()

  const grouped = await db.task.groupBy({
    by: ['assigneeId'],
    where: {
      assigneeId: { in: [...userIds] },
      deletedAt: null,
      project: { deletedAt: null },
      status: { in: [...COMPLETED_STATUSES] },
    },
    _count: { _all: true },
  })

  const byUserId = new Map<string, number>()
  for (const row of grouped) {
    if (row.assigneeId) byUserId.set(row.assigneeId, row._count._all)
  }
  return byUserId
}

/** The busiest completed-task count among a set of workers — "vs peers". */
export async function peerMaxVolume(
  db: Db,
  activeWorkerIds: readonly string[],
): Promise<number> {
  const counts = await completedVolumeByUserId(db, activeWorkerIds)
  let max = 0
  for (const count of counts.values()) {
    if (count > max) max = count
  }
  return max
}

export async function activeWorkerIds(db: Db): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { deletedAt: null, isWorker: true, isActive: true },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}
