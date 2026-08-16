import { ar } from '@/i18n/ar'
import { formatDateTime } from '@/lib/datetime'
import { format } from '@/lib/money'
import type { LatenessResult } from '@/modules/lateness/service'

import type { PenaltyCalculation } from './calculate'
import type { ResolvedPenaltyProfile } from './profile'
import type { PenaltyBreakdownDto } from './types'

/**
 * modules/penalty/breakdown — how a deduction explains itself.
 *
 * CLAUDE.md: "Make deductions and payments feel like arithmetic, not like the
 * manager's mood." That sentence has a concrete, testable meaning here: **a
 * منفّذ handed this text and a calculator must arrive at the same number.**
 *
 * Three rules follow from it, and each one rules out an easier alternative:
 *
 *  1. **Every term shown is exact.** No intermediate is displayed, because
 *     intermediates are rounded and rounded intermediates do not multiply back
 *     up: showing "16.67 per day × 3" for a charge of 50.00 invites somebody to
 *     compute 50.01 and conclude the system is wrong. So the formula shows
 *     `basis × value% × days`, never a per-day figure.
 *  2. **A daily rate is shown as its derivation.** `5000.00 ÷ 22`, not
 *     `227.27`, for exactly the same reason — `modules/ledger/pay-profile`
 *     keeps that quotient unrounded on purpose, and printing the rounded one
 *     would print a number the arithmetic did not use.
 *  3. **It is Arabic prose from `i18n/ar`**, not a code-shaped string. The
 *     منفّذ reads this on their statement; it is the product's answer to
 *     "why?", and it is the only answer they get, because SPEC §5.4 gives them
 *     no way to contest it in-system.
 *
 * The same text is written into `LedgerEntry.note` and carried on the
 * notification event, so the statement, the bell and the task sheet cannot
 * disagree about a figure.
 */

export interface BreakdownInput {
  taskId: string
  taskTitle: string
  lateness: LatenessResult
  calculation: PenaltyCalculation
  profile: ResolvedPenaltyProfile
  roundIndex: number
  revisionCount: number
}

/** Money as the منفّذ reads it: `ar-EG`, Western digits, two decimals. */
const money = (value: string): string => format(value)

/**
 * A percentage as a person writes one: `5%`, `7.5%`, `3.33%` — never `5.00%`.
 *
 * `value` is stored at 2dp because it is multiplied by money and
 * `lib/money`'s scale applies to everything that touches an amount. That is
 * right for the column and wrong for the sentence: "١٠٠٠ × 5.00% × 3" reads
 * like a figure that was computed, when 5% is a policy somebody chose. The
 * trailing zeros carry no information and cost the line its plainness, and this
 * line's only job is to be re-checked by hand.
 *
 * A string trim, not `Intl`: the input is always canonical `NN.NN` from
 * `toStorageString`, so there is nothing to localise and nothing to round.
 */
const percent = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value

/**
 * The formula line, composed from **what was actually multiplied** — never from
 * the mode.
 *
 * A mode names the basis it *prefers*; when that figure does not exist for this
 * منفّذ, `basis.ts` multiplies the other one and says so. Keying the template
 * off the mode would then print a sentence describing arithmetic that did not
 * happen: `PCT_TASK_VALUE_PER_DAY` on a salaried منفّذ would render "300.00 ×
 * 5% × 3" with no hint that 300.00 is a daily rate rather than the task's
 * value, and the reader would go looking for a task worth 300.
 *
 * Composing also covers the combinations SPEC §5.4's five modes do not name —
 * a one-off percentage of a daily rate, say — which a fallback can reach even
 * though no operator can configure it directly.
 */
export function formulaFor(calculation: PenaltyCalculation): string {
  const t = ar.penalties.formulas
  const days = String(calculation.lateWorkingDays)

  if (calculation.basis === 'FIXED') {
    const value = money(calculation.value)
    return calculation.perDay
      ? t.fixedPerDay.replace('{value}', value).replace('{days}', days)
      : t.fixedOnce.replace('{value}', value)
  }

  const shape = calculation.perDay ? t.percentPerDay : t.percentOnce
  return shape
    .replace('{basis}', basisTerm(calculation))
    .replace('{value}', percent(calculation.value))
    .replace('{days}', days)
}

/**
 * A daily rate is shown as its **derivation**, not as its quotient.
 *
 * `modules/ledger/pay-profile` keeps `monthlySalary ÷ workingDaysPerMonth`
 * unrounded on purpose, so printing the rounded 227.27 would print a number the
 * arithmetic never used — and a منفّذ checking 227.27 × 5% × 3 would get 34.09
 * here but 33.99 somewhere else, for reasons nobody could explain at the desk.
 * `(5,000.00 ÷ 22)` is exact, and so is everything downstream of it.
 *
 * The fallback to the rounded figure is only reachable when a caller did not
 * supply the derivation; showing the rate is still better than showing nothing.
 */
function basisTerm(calculation: PenaltyCalculation): string {
  const derivation = calculation.basisDerivation
  if (calculation.basis === 'DAILY_RATE' && derivation) {
    return ar.penalties.basisTerms.dailyRate
      .replace('{salary}', money(derivation.monthlySalary))
      .replace('{perMonth}', String(derivation.workingDaysPerMonth))
  }
  return calculation.basisAmount === null ? '' : money(calculation.basisAmount)
}

/** `التسليم الأصلي` or `المراجعة رقم 2` — SPEC T4's "separately labelled". */
export function roundLabel(roundIndex: number): string {
  return roundIndex === 0
    ? ar.penalties.originalDelivery
    : ar.penalties.revisionRound.replace('{n}', String(roundIndex))
}

export function buildBreakdown(input: BreakdownInput): PenaltyBreakdownDto {
  const { lateness, calculation, profile } = input

  return {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    dueDate: lateness.dueDate,
    originalDueDate: lateness.originalDueDate,
    graceHours: lateness.graceHours,
    effectiveDueDate: lateness.effectiveDueDate,
    measuredAt: lateness.measuredAt,
    lateWorkingDays: calculation.lateWorkingDays,
    blockedWorkingDays: lateness.blockedWorkingDays,
    frozen: lateness.frozen,
    mode: calculation.mode,
    value: calculation.value,
    basis: calculation.basis,
    basisAmount: calculation.basisAmount,
    basisFallback: calculation.basisFallback,
    formula: formulaFor(calculation),
    amount: calculation.amount,
    profileId: profile.profileId,
    profileName: profile.profileName,
    roundIndex: input.roundIndex,
    revisionCount: input.revisionCount,
  }
}

/**
 * The Arabic prose persisted onto the `LedgerEntry`.
 *
 * SPEC §4 makes `note` required and says why: "an entry that cannot explain
 * itself is exactly what this product exists to abolish". So it carries the
 * whole calculation — the due date, the grace, the working days, the formula
 * and the result — and not an id pair a support ticket would have to decode.
 *
 * A revised delivery gets its own wording, naming the round, so a statement
 * showing two deductions on one task says which delivery each belongs to
 * without the reader having to compare timestamps (SPEC T4).
 */
export function penaltyNote(breakdown: PenaltyBreakdownDto): string {
  const template =
    breakdown.roundIndex > 0 ? ar.penalties.notes.autoRevision : ar.penalties.notes.auto

  return template
    .replace('{task}', breakdown.taskTitle)
    .replace('{round}', roundLabel(breakdown.roundIndex))
    .replace('{due}', formatDateTime(breakdown.dueDate))
    .replace('{grace}', String(breakdown.graceHours))
    .replace('{days}', String(breakdown.lateWorkingDays))
    .replace('{formula}', breakdown.formula)
    .replace('{amount}', money(breakdown.amount))
}

/** The note on the `REVERSAL` a recomputation writes before the new figure. */
export function recalculationNote(
  taskTitle: string,
  cause: keyof typeof ar.penalties.causes,
): string {
  return ar.penalties.notes.recalculated
    .replace('{task}', taskTitle)
    .replace('{cause}', ar.penalties.causes[cause])
}
