import type { Db } from '@/lib/db'
import { getSettings } from '@/lib/settings'

import { activeWorkerIds, peerMaxVolume, taskFactsForUser } from './facts'
import {
  computePerformanceScore,
  type PerformanceScoreBreakdown,
  type PerformanceWeights,
} from './service'

/**
 * modules/performance/compute.ts — the orchestration shared by the cache-miss
 * read (`queries.ts`, one worker) and the nightly sweep (`job.ts`, every
 * worker), so the two can never compute the same score two different ways.
 */

export async function loadPerformanceWeights(): Promise<PerformanceWeights> {
  const settings = await getSettings([
    'performance.weightOnTime',
    'performance.weightQuality',
    'performance.weightVolume',
    'performance.weightEstimateAccuracy',
  ])
  return {
    onTime: settings['performance.weightOnTime'],
    quality: settings['performance.weightQuality'],
    volume: settings['performance.weightVolume'],
    estimateAccuracy: settings['performance.weightEstimateAccuracy'],
  }
}

export interface UserScoreBreakdown {
  userId: string
  breakdown: PerformanceScoreBreakdown
}

/**
 * Every active worker's score, sharing one peer-volume ceiling — computing it
 * once per worker instead of once for the whole batch would make "vs peers"
 * answer a different question for whoever happened to be scored first.
 */
export async function computeAllActiveWorkerScores(
  db: Db,
  weights: PerformanceWeights,
): Promise<UserScoreBreakdown[]> {
  const ids = await activeWorkerIds(db)
  const maxVolume = await peerMaxVolume(db, ids)

  const results: UserScoreBreakdown[] = []
  for (const userId of ids) {
    const facts = await taskFactsForUser(db, userId)
    results.push({ userId, breakdown: computePerformanceScore(facts, maxVolume, weights) })
  }
  return results
}

/** One worker's score against the current peer ceiling — the cache-miss path. */
export async function computeScoreForOneUser(
  db: Db,
  userId: string,
  weights: PerformanceWeights,
): Promise<PerformanceScoreBreakdown> {
  const ids = await activeWorkerIds(db)
  const maxVolume = await peerMaxVolume(db, ids.includes(userId) ? ids : [...ids, userId])
  const facts = await taskFactsForUser(db, userId)
  return computePerformanceScore(facts, maxVolume, weights)
}
