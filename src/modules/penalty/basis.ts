import {
  isPositive,
  toMoney,
  toStorageString,
  type Money,
  type MoneyInput,
} from '@/lib/money'
import {
  dailyRate,
  earnsPerTask,
  monthlySalaryOf,
  type PayProfile,
} from '@/modules/ledger/pay-profile'

import { preferredBasis, type PenaltyBasis, type PenaltyMode } from './mode'

/**
 * modules/penalty/basis — which figure the percentage is taken of.
 *
 * ── The problem this file exists to solve ─────────────────────────────────
 *
 * SPEC §5.4 gives each mode its own basis, and SPEC §7 gives the organization **one**
 * default mode. Those two sentences collide the moment an organization employs both
 * salaried and per-task منفّذين, which is exactly what `PayType.HYBRID` exists
 * for. With the shipped default of `PCT_TASK_VALUE_PER_DAY`, every salaried
 * منفّذ's deduction would be a percentage of a `taskValue` their work does not
 * carry — and would come out as zero.
 *
 * A silent zero is the worst answer this product can give. Phase 0 said so when
 * it stubbed `lib/calendar` as *throwing* rather than returning 0, because a
 * working-day count of zero "would make the penalty engine compute zero
 * deductions and look like it worked". The same reasoning applies one layer up.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A basis is **available** or it is not, and availability is decided by rules
 * this codebase already committed to in `modules/ledger/pay-profile`:
 *
 *  - `taskValue` is a basis only for somebody who `earnsPerTask`. A salaried
 *    منفّذ is not paid per task, so the number on the task is not money they
 *    earn, and it must not be money they are docked.
 *  - `dailyRate` is a basis only for somebody who `isSalaried` — which
 *    `dailyRate()` already enforces by returning `null` rather than zero.
 *  - **Zero is not a basis.** A percentage of nothing is nothing, and "nothing"
 *    here means the figure is absent rather than that the deduction is fair.
 *
 * The mode states a preference. Where the preference is unavailable and the
 * other basis is, the other one is used and the result says `fallback: true`,
 * so the breakdown the منفّذ reads names the number that was actually
 * multiplied instead of leaving them to guess.
 *
 * Where **neither** is available there is no deduction and the reason is
 * `NO_BASIS` — reported, audited, and never rendered as a correct zero.
 */

/** How a daily rate was arrived at, so a breakdown can show exact arithmetic. */
export interface DailyRateDerivation {
  /** 2dp storage string. */
  monthlySalary: string
  workingDaysPerMonth: number
}

export interface PayBases {
  /** The task's value, if this person earns per task and it is non-zero. */
  taskValue: Money | null
  /** `monthlySalary ÷ workingDaysPerMonth`, unrounded, if this person is salaried. */
  dailyRate: Money | null
  /**
   * The two numbers `dailyRate` came from — carried **beside it, in the same
   * object**, so the two cannot be separated.
   *
   * `modules/penalty/breakdown` shows a daily rate as `5,000.00 ÷ 22` rather
   * than as `227.27`, because the quotient is deliberately unrounded and
   * printing the rounded form would print a number the arithmetic never used:
   * a منفّذ re-checking `227.27 × 5% × 3` gets 34.09 where the ledger says
   * 34.09 today and 33.99 on the next salary that divides less kindly.
   *
   * It lived on the calculation's input as a separate optional field until the
   * axis-8 money sweep pointed out that any caller could supply one without the
   * other and quietly write a note that does not add up — into an append-only
   * ledger. Putting it here means `{ ...bases }` carries it automatically and
   * there is nothing to forget.
   */
  dailyRateDerivation: DailyRateDerivation | null
}

/**
 * The two figures a منفّذ actually has, from their pay profile and one task.
 *
 * `workingDaysPerMonth` is injected, never read here: it is
 * `calendar.workingDaysPerMonth` in Settings and CLAUDE.md invariant 4 keeps
 * business numbers out of service files.
 */
export function payBasesFor(
  profile: PayProfile,
  taskValue: MoneyInput | null | undefined,
  workingDaysPerMonth: number,
): PayBases {
  const perTask =
    earnsPerTask(profile) && taskValue !== null && taskValue !== undefined
      ? toMoney(taskValue)
      : null

  // Already `null` unless the person is salaried and has a salary recorded.
  const rate = dailyRate(profile, workingDaysPerMonth)
  const salary = monthlySalaryOf(profile)

  return {
    taskValue: perTask !== null && isPositive(perTask) ? perTask : null,
    dailyRate: rate,
    // Non-null exactly when `dailyRate` is: both are gated on `isSalaried` and
    // a recorded salary, so the pair cannot come apart.
    dailyRateDerivation:
      rate !== null && salary !== null
        ? { monthlySalary: toStorageString(salary), workingDaysPerMonth }
        : null,
  }
}

export interface ResolvedBasis {
  /** What was actually used. `FIXED` when the mode needs no basis at all. */
  basis: PenaltyBasis
  /** The figure the percentage applies to. Null for `FIXED`, and when unavailable. */
  amount: Money | null
  /** False only when the mode wanted a percentage and neither figure existed. */
  available: boolean
  /** True when the mode's preferred basis was missing and the other was used. */
  fallback: boolean
  /** What the mode asked for. Named even when unavailable, so the audit can say. */
  wanted: PenaltyBasis
}

/**
 * "Zero is not a basis" is enforced **here** and not only in `payBasesFor`.
 *
 * The two produce different-looking but equally wrong answers otherwise: a
 * zero basis multiplies out to `ZERO`, which reads as "this person has no
 * deductions configured", when the truth is "this task carries no figure to
 * take a percentage of". Conflating those sends somebody to edit the wrong
 * screen. Every entry point into this file gets the same rule.
 */
const usable = (amount: Money | null): amount is Money =>
  amount !== null && isPositive(amount)

export function resolveBasis(mode: PenaltyMode, bases: PayBases): ResolvedBasis {
  const wanted = preferredBasis(mode)

  if (wanted === 'FIXED') {
    return { basis: 'FIXED', amount: null, available: true, fallback: false, wanted }
  }

  const preferred = wanted === 'TASK_VALUE' ? bases.taskValue : bases.dailyRate
  if (usable(preferred)) {
    return { basis: wanted, amount: preferred, available: true, fallback: false, wanted }
  }

  const other: PenaltyBasis = wanted === 'TASK_VALUE' ? 'DAILY_RATE' : 'TASK_VALUE'
  const alternative = other === 'TASK_VALUE' ? bases.taskValue : bases.dailyRate
  if (usable(alternative)) {
    return { basis: other, amount: alternative, available: true, fallback: true, wanted }
  }

  return { basis: wanted, amount: null, available: false, fallback: false, wanted }
}
