import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import type { Db } from '@/lib/db'
import { assertCan } from '@/lib/rbac'
import { OPEN_TASK_STATUSES } from '@/modules/task/state-machine'

import { computeUtilisation, type UtilisationResult } from './service'

/**
 * modules/workload/queries.ts — SPEC/phase brief "Workload/capacity".
 *
 * There is no `workload.view` key in SPEC §6's catalog, and inventing one
 * would be inventing a permission (the same reasoning SPEC §6 already applies
 * to holidays and leave). `user.view` is the closest existing key that means
 * "see workforce-wide facts about people", so the manager dashboard's heatmap
 * is gated on it, the same way `getUsers` is.
 */

/**
 * Σ `estimatedHours` per assignee, over their **active** tasks — reusing
 * `OPEN_TASK_STATUSES` (`modules/task/state-machine.ts`), the same set Phase 1's
 * `OpenTaskLookup` already treats as "still counts as owned work". A task still
 * in BACKLOG has no assignee to charge; one already APPROVED is no longer
 * consuming anyone's week.
 *
 * One indexed `groupBy` regardless of how many workers are asked for — the
 * `[assigneeId, status]` index on `tasks` is exactly this query's shape.
 */
export async function activeHoursByUserId(
  db: Db,
  userIds?: readonly string[],
): Promise<Map<string, number>> {
  const grouped = await db.task.groupBy({
    by: ['assigneeId'],
    where: {
      deletedAt: null,
      project: { deletedAt: null },
      status: { in: [...OPEN_TASK_STATUSES] },
      assigneeId: userIds ? { in: [...userIds] } : { not: null },
    },
    _sum: { estimatedHours: true },
  })

  const byUserId = new Map<string, number>()
  for (const row of grouped) {
    if (!row.assigneeId) continue
    byUserId.set(row.assigneeId, Number(row._sum.estimatedHours ?? 0))
  }
  return byUserId
}

export interface WorkerWorkloadDto extends UtilisationResult {
  userId: string
  fullName: string
}

/**
 * Every active worker's utilisation — the manager dashboard's heatmap, and the
 * over-capacity warning's data source on the assignment screen.
 *
 * Not paginated: SPEC §2 caps an agency at ~100 users, and a heatmap that only
 * shows page one of the workforce would misrepresent who is actually free.
 */
export async function getWorkloadSnapshot(): Promise<WorkerWorkloadDto[]> {
  const actor = await requireActor()
  assertCan(actor, 'user.view')

  const workers = await prisma.user.findMany({
    where: { deletedAt: null, isWorker: true, isActive: true },
    select: { id: true, fullName: true, weeklyCapacityHours: true },
    orderBy: { fullName: 'asc' },
  })

  const activeHours = await activeHoursByUserId(
    prisma,
    workers.map((w) => w.id),
  )

  return workers
    .map((worker) => ({
      userId: worker.id,
      fullName: worker.fullName,
      ...computeUtilisation({
        activeEstimatedHours: activeHours.get(worker.id) ?? 0,
        weeklyCapacityHours: worker.weeklyCapacityHours,
      }),
    }))
    .sort((a, b) => b.utilisationPercent - a.utilisationPercent)
}
