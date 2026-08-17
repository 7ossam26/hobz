/**
 * Every numeric field is a fixed-1dp string, the same reason `modules/payout`
 * DTOs stringify `Decimal` — not because a score is money (SPEC §5.6 is
 * explicit that it is not, CLAUDE.md invariant 2 does not apply here), but so
 * a component renders `"87.5"` rather than risking a raw float artefact like
 * `87.49999999999999` on the one screen a منفّذ reads about their own standing.
 */
export interface PerformanceScoreDto {
  userId: string
  score: string
  onTimeRate: string
  qualityScore: string
  volumeScore: string
  estimateAccuracy: string
  taskCount: number
  computedAt: Date
}
