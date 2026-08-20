/**
 * modules/penalty/mode — SPEC §5.4's five formulas, as a closed set.
 *
 * SPEC R2 settled the shape: "a `PenaltyProfile` (mode + value + grace) …
 * without a formula parser". An enum is what that sentence buys — every
 * formula the product can ever compute is visible in one place, each one has a
 * branch in `calculate.ts`, and adding a sixth is a code change with a test
 * rather than a string somebody typed into a settings box at midnight.
 *
 * Two facts about a mode are read all over the module, so both are functions
 * here rather than conditionals repeated at each call site: whether it
 * multiplies by days, and which figure its percentage applies to.
 */

export const PENALTY_MODES = [
  'FIXED_PER_DAY',
  'PCT_TASK_VALUE_PER_DAY',
  'PCT_DAILY_RATE_PER_DAY',
  'FIXED_ONCE',
  'PCT_TASK_VALUE_ONCE',
] as const

export type PenaltyMode = (typeof PENALTY_MODES)[number]

export function isPenaltyMode(value: string): value is PenaltyMode {
  return (PENALTY_MODES as readonly string[]).includes(value)
}

/**
 * Which money figure the percentage is taken of. `FIXED` means the mode's
 * `value` is already an amount and no basis is consulted.
 */
export type PenaltyBasis = 'FIXED' | 'TASK_VALUE' | 'DAILY_RATE'

const BASIS: Readonly<Record<PenaltyMode, PenaltyBasis>> = {
  FIXED_PER_DAY: 'FIXED',
  FIXED_ONCE: 'FIXED',
  PCT_TASK_VALUE_PER_DAY: 'TASK_VALUE',
  PCT_TASK_VALUE_ONCE: 'TASK_VALUE',
  PCT_DAILY_RATE_PER_DAY: 'DAILY_RATE',
}

/**
 * The basis the mode *asks* for. What it actually gets may differ — see
 * `basis.ts`, which is where an organization-wide default mode meets a منفّذ whose
 * pay type does not carry that figure.
 */
export function preferredBasis(mode: PenaltyMode): PenaltyBasis {
  return BASIS[mode]
}

/**
 * SPEC §5.4: the `_PER_DAY` modes multiply by `lateWorkingDays`, the `_ONCE`
 * modes do not. This is the whole difference between "every day you are late
 * costs you" and "being late costs you".
 */
export function isPerDay(mode: PenaltyMode): boolean {
  return mode.endsWith('_PER_DAY')
}

/** True when `value` is a currency amount rather than a percentage. */
export function isFixedAmount(mode: PenaltyMode): boolean {
  return preferredBasis(mode) === 'FIXED'
}
