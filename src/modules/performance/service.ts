/**
 * modules/performance/service.ts — SPEC §5.6, performance scoring maths.
 *
 * ```
 * on-time delivery rate            50%
 * manual quality rating (1–5)      30%
 * completed task volume vs peers   10%
 * estimate accuracy                10%
 * ```
 *
 * Penalties and bonuses never enter this file — SPEC §5.6: "money only, per
 * G9" — and neither does Prisma or `next/*`: every input arrives as a plain
 * `TaskPerformanceFact`, gathered by `facts.ts`, so the boundaries
 * (`docs/PHASES.md` Phase 10: "no tasks, all late, all on time") are provable
 * without a database.
 *
 * ── What "on time" means here ─────────────────────────────────────────────
 *
 * `TaskPerformanceFact.onTime` is handed in already decided — from
 * `Task.overdueWorkingDays === 0`, the same figure the penalty engine froze at
 * delivery (`modules/lateness/service.ts`, CLAUDE.md invariant 5: business-day
 * math only via `lib/calendar`). Recomputing lateness a second time here would
 * risk a second, drifting answer to "was this task late" for the one number in
 * the product that already has a canonical one.
 *
 * ── Why every component defaults to zero, not to a mid-point ──────────────
 *
 * A brand-new worker with no completed tasks has performed exactly as well as
 * "nothing yet" — zero is the literal, defensible reading, and it is what
 * makes the score rise from a real floor as real work lands rather than drift
 * down from an invented average.
 */

export interface TaskPerformanceFact {
  /** `Task.overdueWorkingDays === 0` at the task's frozen, post-delivery value. */
  onTime: boolean
  /** 1–5, set on approval (SPEC §5.6). Null when never captured. */
  qualityRating: number | null
  /** `Task.estimatedHours`. */
  estimatedHours: number
  /** `Task.elapsedMinutesWorking ÷ 60`. */
  actualWorkingHours: number
}

export interface PerformanceWeights {
  onTime: number
  quality: number
  volume: number
  estimateAccuracy: number
}

export interface PerformanceScoreBreakdown {
  /** The weighted composite, 0–100. */
  score: number
  onTimeRate: number
  qualityScore: number
  volumeScore: number
  estimateAccuracy: number
  taskCount: number
}

const round1 = (value: number): number => Math.round(value * 10) / 10

function onTimeRateOf(facts: readonly TaskPerformanceFact[]): number {
  if (facts.length === 0) return 0
  const onTimeCount = facts.filter((f) => f.onTime).length
  return round1((onTimeCount / facts.length) * 100)
}

/** 1–5 average, rescaled to 0–100. Tasks with no captured rating are excluded. */
function qualityScoreOf(facts: readonly TaskPerformanceFact[]): number {
  const rated = facts.filter((f): f is TaskPerformanceFact & { qualityRating: number } =>
    f.qualityRating !== null,
  )
  if (rated.length === 0) return 0

  const average = rated.reduce((sum, f) => sum + f.qualityRating, 0) / rated.length
  const rescaled = ((average - 1) / 4) * 100
  return round1(Math.min(100, Math.max(0, rescaled)))
}

/**
 * Completed volume against the busiest active worker. `peerMaxVolume` already
 * includes this worker's own count (it is a `MAX` over everyone), so it can
 * only be `0` when `facts.length` is also `0` — the `<= 0` branch below is a
 * defensive fallback for that otherwise-unreachable pairing, not a designed
 * path.
 */
function volumeScoreOf(facts: readonly TaskPerformanceFact[], peerMaxVolume: number): number {
  if (facts.length === 0) return 0
  if (peerMaxVolume <= 0) return 100
  return round1(Math.min(100, (facts.length / peerMaxVolume) * 100))
}

/**
 * Per task: `100 − |estimated − actual| ÷ estimated × 100`, clamped at zero so
 * a wildly blown estimate costs at most the full 100 points rather than going
 * negative. Tasks with no recorded estimate (`estimatedHours <= 0`) are
 * excluded — there is nothing to measure accuracy against.
 */
function estimateAccuracyOf(facts: readonly TaskPerformanceFact[]): number {
  const estimable = facts.filter((f) => f.estimatedHours > 0)
  if (estimable.length === 0) return 0

  const total = estimable.reduce((sum, f) => {
    const ratio = Math.abs(f.estimatedHours - f.actualWorkingHours) / f.estimatedHours
    return sum + Math.max(0, 100 - ratio * 100)
  }, 0)
  return round1(total / estimable.length)
}

/**
 * The weighted composite. Divides by the **actual sum** of the four weights
 * rather than assuming they total 100 — an admin's Settings edit that leaves
 * them at, say, 90 or 110 still produces a score inside `[0, 100]` instead of
 * a silently wrong one.
 */
export function computePerformanceScore(
  facts: readonly TaskPerformanceFact[],
  peerMaxVolume: number,
  weights: PerformanceWeights,
): PerformanceScoreBreakdown {
  const onTimeRate = onTimeRateOf(facts)
  const qualityScore = qualityScoreOf(facts)
  const volumeScore = volumeScoreOf(facts, peerMaxVolume)
  const estimateAccuracy = estimateAccuracyOf(facts)

  const weightSum = weights.onTime + weights.quality + weights.volume + weights.estimateAccuracy
  const weighted =
    onTimeRate * weights.onTime +
    qualityScore * weights.quality +
    volumeScore * weights.volume +
    estimateAccuracy * weights.estimateAccuracy

  return {
    score: weightSum > 0 ? round1(weighted / weightSum) : 0,
    onTimeRate,
    qualityScore,
    volumeScore,
    estimateAccuracy,
    taskCount: facts.length,
  }
}
