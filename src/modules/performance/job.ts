import type { Db } from '@/lib/db'
import { registerJob, type JobDefinition } from '@/lib/scheduler'

import { computeAllActiveWorkerScores, loadPerformanceWeights } from './compute'

/**
 * modules/performance/job.ts — the daily recompute (phase brief §5.6:
 * "Computed on demand with a cached daily recomputation").
 *
 * **04:00 Cairo, not 03:00.** `modules/calendar/job.ts` and
 * `modules/penalty/job.ts` both run at 03:00 and are what freeze
 * `Task.overdueWorkingDays` for the day — this job's on-time component reads
 * that column (`facts.ts`), so it runs after the two that write it rather than
 * racing them for whatever value happened to land first.
 *
 * Idempotent by construction (CLAUDE.md invariant 6): every run overwrites
 * each worker's one `PerformanceScore` row with a value computed fresh from
 * the same facts, so running it twice in a row produces the same numbers, not
 * an accumulation.
 */

export const PERFORMANCE_RECOMPUTE_JOB_NAME = 'performance.recompute'

const PERFORMANCE_RECOMPUTE_CRON = '0 4 * * *'

export interface PerformanceJobResult {
  scored: number
  failed: number
}

export async function runPerformanceRecompute(
  db: Db,
  now: Date,
): Promise<PerformanceJobResult> {
  const weights = await loadPerformanceWeights()
  const scores = await computeAllActiveWorkerScores(db, weights)

  const result: PerformanceJobResult = { scored: 0, failed: 0 }

  for (const { userId, breakdown } of scores) {
    try {
      await db.performanceScore.upsert({
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
      result.scored += 1
    } catch (error) {
      // One unscoreable worker must not stop the rest of the agency from
      // getting a fresh number tonight.
      result.failed += 1
      console.error(`[${PERFORMANCE_RECOMPUTE_JOB_NAME}] user ${userId} failed`, error)
    }
  }

  return result
}

export const performanceRecomputeJob: JobDefinition = {
  name: PERFORMANCE_RECOMPUTE_JOB_NAME,
  schedule: PERFORMANCE_RECOMPUTE_CRON,
  handler: async (ctx) => {
    const outcome = await runPerformanceRecompute(ctx.db, ctx.runAt)
    console.info(
      `[${PERFORMANCE_RECOMPUTE_JOB_NAME}] scored=${outcome.scored} failed=${outcome.failed}`,
    )
  },
}

/** Called once, from `src/instrumentation.ts`. */
export function registerPerformanceJobs(): void {
  registerJob(performanceRecomputeJob)
}
