import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { ForbiddenError } from '@/lib/errors'
import { can } from '@/lib/rbac'

import { computeScoreForOneUser, loadPerformanceWeights } from './compute'
import type { PerformanceScoreDto } from './types'

/**
 * modules/performance/queries.ts — SPEC §5.6: "Computed on demand with a
 * cached daily recomputation. Visible to the worker."
 *
 * The cache-or-compute split: a cache **hit** is returned as-is, however old —
 * freshness is the nightly job's job (`job.ts`). A cache **miss** (a worker
 * who has never been scored — brand new, or scored for the first time before
 * their first 03:xx sweep) computes once, on this request, and persists the
 * result, so the worker's first visit shows a real number instead of a blank
 * "no score yet" state.
 */

function toDto(row: {
  userId: string
  score: { toFixed(dp: number): string }
  onTimeRate: { toFixed(dp: number): string }
  qualityScore: { toFixed(dp: number): string }
  volumeScore: { toFixed(dp: number): string }
  estimateAccuracy: { toFixed(dp: number): string }
  taskCount: number
  computedAt: Date
}): PerformanceScoreDto {
  return {
    userId: row.userId,
    score: row.score.toFixed(1),
    onTimeRate: row.onTimeRate.toFixed(1),
    qualityScore: row.qualityScore.toFixed(1),
    volumeScore: row.volumeScore.toFixed(1),
    estimateAccuracy: row.estimateAccuracy.toFixed(1),
    taskCount: row.taskCount,
    computedAt: row.computedAt,
  }
}

async function computeAndCache(userId: string, now: Date): Promise<PerformanceScoreDto> {
  const weights = await loadPerformanceWeights()
  const breakdown = await computeScoreForOneUser(prisma, userId, weights)

  const saved = await prisma.performanceScore.upsert({
    where: { userId },
    create: {
      userId,
      computedAt: now,
      score: breakdown.score,
      onTimeRate: breakdown.onTimeRate,
      qualityScore: breakdown.qualityScore,
      volumeScore: breakdown.volumeScore,
      estimateAccuracy: breakdown.estimateAccuracy,
      taskCount: breakdown.taskCount,
    },
    update: {
      computedAt: now,
      score: breakdown.score,
      onTimeRate: breakdown.onTimeRate,
      qualityScore: breakdown.qualityScore,
      volumeScore: breakdown.volumeScore,
      estimateAccuracy: breakdown.estimateAccuracy,
      taskCount: breakdown.taskCount,
    },
  })

  return toDto(saved)
}

/** The signed-in worker's own score — always their own, never parameterised by id. */
export async function getMyPerformanceScore(
  now: Date = new Date(),
): Promise<PerformanceScoreDto> {
  const actor = await requireActor()

  const cached = await prisma.performanceScore.findUnique({ where: { userId: actor.id } })
  if (cached) return toDto(cached)

  return computeAndCache(actor.id, now)
}

/**
 * One worker's score for a manager/report reader. Gated on `report.view` — a
 * منفّذ's own component breakdown is theirs to see on their own dashboard, but
 * seeing *another* worker's breakdown is a reporting privilege, not a general
 * one; there is no `performance.view` key in SPEC §6 to invent for it.
 *
 * Reads the cache only, never computes — a manager opening one worker's
 * detail should see "as of the last nightly recompute", the same figure the
 * worker performance report shows, not a third number that happened to be
 * fresher because this page was opened after 03:00.
 */
export async function getPerformanceScoreForUser(
  userId: string,
): Promise<PerformanceScoreDto | null> {
  const actor = await requireActor()
  if (!can(actor, 'report.view')) throw new ForbiddenError('report.view')

  const row = await prisma.performanceScore.findUnique({ where: { userId } })
  return row ? toDto(row) : null
}
