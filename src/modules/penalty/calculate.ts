import {
  isPositive,
  mul,
  pct,
  toMoney,
  toStorageString,
  zero,
  type Money,
  type MoneyInput,
} from '@/lib/money'

import { resolveBasis, type DailyRateDerivation, type PayBases } from './basis'
import { isPerDay, type PenaltyBasis, type PenaltyMode } from './mode'

/**
 * modules/penalty/calculate — SPEC §5.4's formula table, and nothing else.
 *
 * ```
 * amount = switch profile.mode
 *   FIXED_PER_DAY            → value × lateWorkingDays
 *   PCT_TASK_VALUE_PER_DAY   → task.taskValue × value% × lateWorkingDays
 *   PCT_DAILY_RATE_PER_DAY   → dailyRate(user) × value% × lateWorkingDays
 *   FIXED_ONCE               → value
 *   PCT_TASK_VALUE_ONCE      → task.taskValue × value%
 * ```
 *
 * Pure. No clock, no database, no Settings lookup — `lateWorkingDays` arrives
 * already computed by `modules/lateness` (SPEC §5.3) and the pay figures
 * already resolved by `basis.ts`. That is what lets every number in
 * `tests/unit/penalty/calculate.test.ts` be a hand-computed literal.
 *
 * ── Two rules that decide every remaining question here ───────────────────
 *
 * **One rounding, at the end.** `lib/money`'s policy, and it is load-bearing
 * rather than stylistic: rounding the per-day charge first and multiplying
 * after would turn 0.10 × 33% × 3 into 0.09 instead of 0.10, and a منفّذ who
 * checks the arithmetic and finds it a piastre out has been given a reason to
 * doubt the whole figure. So the intermediate product stays at `Decimal`'s 34
 * significant digits and `round2` is applied exactly once.
 *
 * **The breakdown never shows an intermediate.** For the same reason: what the
 * منفّذ is shown is `basis × value% × days = amount`, every term of which is
 * exact, so reproducing it by hand lands on the same number. A per-day figure
 * would be a rounded intermediate that does not multiply back up. The one
 * apparent exception — a daily rate of `5000 ÷ 22` — is handled by carrying the
 * *derivation* (`basisDerivation`) rather than the rounded quotient, so the
 * displayed arithmetic is still exact.
 *
 * **There is no cap.** SPEC §5.4: "No cap. A payout may reach zero but never
 * goes negative — surplus deduction carries to the next cycle as a debit
 * balance." Flooring a deduction at the task's value, or at a month's pay,
 * would be this file quietly making a policy decision that belongs to the
 * payout close. It does not.
 */

export type PenaltyStatus =
  /** A real deduction, with a positive amount. */
  | 'DUE'
  /** `lateWorkingDays <= 0`. SPEC §5.4: "no entry (reverse any existing auto entry)". */
  | 'NOT_LATE'
  /** The profile's `value` is zero — "no deductions for this person". */
  | 'ZERO'
  /** A percentage mode with neither a task value nor a daily rate. See `basis.ts`. */
  | 'NO_BASIS'

export interface PenaltyCalculationInput extends PayBases {
  mode: PenaltyMode
  /** Currency for `FIXED_*`, a percentage for `PCT_*`. Never negative. */
  value: MoneyInput
  /** From `modules/lateness` (SPEC §5.3). Already excludes BLOCKED time. */
  lateWorkingDays: number
}

/**
 * Everything SPEC §8 asks a penalty notification to show, minus the two facts
 * that belong to lateness (`dueDate`, `graceHours`) and are joined on in
 * `assess.ts`. Every money field is a canonical 2dp string, never a `number`
 * (CLAUDE.md invariant 2).
 */
export interface PenaltyCalculation {
  status: PenaltyStatus
  mode: PenaltyMode
  /** The configured number, as configured: `150.00` currency or `5.00` percent. */
  value: string
  /** What was actually multiplied. */
  basis: PenaltyBasis
  /** The basis figure at 2dp, or null for `FIXED` and for `NO_BASIS`. */
  basisAmount: string | null
  /** Present for `DAILY_RATE`, so `5000.00 ÷ 22` is shown instead of `227.27`. */
  basisDerivation: DailyRateDerivation | null
  /** True when the mode's own basis was missing and the other one was used. */
  basisFallback: boolean
  /** What the mode asked for. Set even when nothing was available. */
  wantedBasis: PenaltyBasis
  perDay: boolean
  /** Clamped at zero — a negative lateness is never a credit. */
  lateWorkingDays: number
  /** The magnitude, 2dp, never negative. `0.00` unless `status` is `DUE`. */
  amount: string
}

const NO_AMOUNT = '0.00'

export function calculatePenalty(input: PenaltyCalculationInput): PenaltyCalculation {
  const mode = input.mode
  const value = toMoney(input.value)
  const perDay = isPerDay(mode)
  // Clamped, not trusted. `modules/lateness` already returns `max(0, …)`, and a
  // second guard here costs nothing and makes a negative multiplicand — which
  // would flip a deduction into a credit — impossible rather than unlikely.
  const days = Math.max(0, Math.trunc(input.lateWorkingDays))

  const resolved = resolveBasis(mode, input)

  const base = {
    mode,
    value: toStorageString(value),
    basis: resolved.basis,
    basisAmount: resolved.amount === null ? null : toStorageString(resolved.amount),
    // Only meaningful for the basis that was actually multiplied. A task-value
    // charge that happens to belong to a salaried منفّذ must not print their
    // salary beside a figure it had no part in.
    basisDerivation: resolved.basis === 'DAILY_RATE' ? input.dailyRateDerivation : null,
    basisFallback: resolved.fallback,
    wantedBasis: resolved.wanted,
    perDay,
    lateWorkingDays: days,
  }

  // Order matters, and it is the order a human would explain it in: were they
  // late at all, is this person penalised at all, and only then — can the
  // formula be evaluated. Reporting `NO_BASIS` for an on-time task would send
  // somebody to fix a pay profile over a deduction that was never owed.
  if (days <= 0) return { ...base, status: 'NOT_LATE', amount: NO_AMOUNT }
  if (!isPositive(value)) return { ...base, status: 'ZERO', amount: NO_AMOUNT }
  if (!resolved.available) return { ...base, status: 'NO_BASIS', amount: NO_AMOUNT }

  const charge: Money =
    resolved.basis === 'FIXED' ? value : pct(resolved.amount as Money, value)

  // The single rounding, on the product — see the module note.
  const total = perDay ? mul(charge, days) : charge
  const amount = toStorageString(total)

  /**
   * The verdict is taken on the **rounded** figure, not the exact one.
   *
   * `40.00 × 0.01%` is 0.004 — genuinely positive, and genuinely nothing once
   * it reaches a `Decimal(12,2)` column. Reading `isPositive` on the exact
   * product would report `DUE` with an amount of `0.00`, and the service would
   * hand that to `appendEntry`, which refuses zero ("a movement of zero is not
   * a movement") — so the nightly job would count that task as *failed*, every
   * night, for as long as the configuration stood.
   *
   * Sub-piastre deductions are therefore `ZERO`: not owed, not written, and not
   * an error. The rounded amount is the only figure that can exist in the
   * ledger, so it is the only one worth deciding on. Found by the axis-1
   * boundary sweep (docs/TESTING.md §4).
   */
  const chargeable = toMoney(amount)

  return {
    ...base,
    status: isPositive(chargeable) ? 'DUE' : 'ZERO',
    amount: isPositive(chargeable) ? amount : toStorageString(zero()),
  }
}

/** The one predicate callers should branch on before writing to the ledger. */
export function isChargeable(calculation: PenaltyCalculation): boolean {
  return calculation.status === 'DUE'
}
