/**
 * modules/workload/service.ts — SPEC/phase brief §"Workload/capacity":
 * `utilisation = Σ estimatedHours of active tasks ÷ weeklyCapacityHours`.
 *
 * Pure: no Prisma, no `next/*`. `data.ts` supplies the two inputs from the
 * database; this file is only the division, which is exactly what
 * `tests/unit/workload/utilisation.test.ts` pins at its boundaries.
 */

export interface UtilisationInput {
  /** Σ `estimatedHours` over this worker's active tasks. */
  activeEstimatedHours: number
  weeklyCapacityHours: number
}

export interface UtilisationResult extends UtilisationInput {
  /** Rounded to 1dp — a workload bar has no use for more precision than that. */
  utilisationPercent: number
  overCapacity: boolean
}

/**
 * `weeklyCapacityHours <= 0` is unreachable through the validated write path
 * (`modules/user/schema.ts` requires `1..168`), but this stays total rather
 * than throwing: a workload bar is a dashboard hint, not a deduction, and
 * CLAUDE.md's "never a silent wrong answer" concern is about money. Zero
 * capacity with zero assigned hours is simply zero utilisation.
 */
export function computeUtilisation(input: UtilisationInput): UtilisationResult {
  const { activeEstimatedHours, weeklyCapacityHours } = input
  const utilisationPercent =
    weeklyCapacityHours > 0
      ? Math.round((activeEstimatedHours / weeklyCapacityHours) * 1000) / 10
      : 0

  return {
    activeEstimatedHours,
    weeklyCapacityHours,
    utilisationPercent,
    overCapacity: utilisationPercent > 100,
  }
}
