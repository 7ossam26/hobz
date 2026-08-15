import { div, toMoney, type Money } from '@/lib/money'

/**
 * modules/ledger/pay-profile — how a person is paid (SPEC §2, §4, §5.4).
 *
 * The profile attaches to the **user**, never to the role (SPEC §2: "Payment
 * profile attaches to the user, not the role"), so everything here takes the
 * three columns and nothing else. Pure functions, no database, no settings
 * lookup — the divisor is passed in, because `calendar.workingDaysPerMonth` is
 * Settings data and CLAUDE.md invariant 4 keeps business numbers out of service
 * files.
 */

export type PayType = 'SALARY' | 'PER_TASK' | 'HYBRID'

/**
 * Structurally satisfied by a `User` row, a DTO, or a factory-built object.
 * Money arrives as a string or a `Decimal`-alike — never a `number`.
 */
export interface PayProfile {
  payType: PayType
  monthlySalary: string | { toFixed(dp: number): string } | null
  defaultTaskRate: string | { toFixed(dp: number): string } | null
}

const asMoney = (value: PayProfile['monthlySalary']): Money | null =>
  value === null ? null : toMoney(typeof value === 'string' ? value : value.toFixed(2))

/** SALARY or HYBRID: this person accrues a monthly `SALARY` entry per cycle. */
export function isSalaried(profile: PayProfile): boolean {
  return profile.payType === 'SALARY' || profile.payType === 'HYBRID'
}

/** PER_TASK or HYBRID: approving this person's task creates an `EARNING`. */
export function earnsPerTask(profile: PayProfile): boolean {
  return profile.payType === 'PER_TASK' || profile.payType === 'HYBRID'
}

/**
 * The salary, or null when this person does not have one.
 *
 * Gated on `isSalaried` rather than on the column alone: a منفّذ switched from
 * SALARY to PER_TASK may still carry the old figure, and a stale number is a
 * worse answer than no number.
 */
export function monthlySalaryOf(profile: PayProfile): Money | null {
  if (!isSalaried(profile)) return null
  return asMoney(profile.monthlySalary)
}

export function effectiveTaskRate(profile: PayProfile): Money | null {
  if (!earnsPerTask(profile)) return null
  return asMoney(profile.defaultTaskRate)
}

/**
 * SPEC §5.4: `dailyRate(user) = monthlySalary ÷ settings.workingDaysPerMonth`.
 *
 * **Returns null, never zero, when there is no salary.** SPEC §5.4's
 * `PCT_DAILY_RATE_PER_DAY` mode multiplies by this figure, and a zero would
 * silently produce a zero deduction that looks exactly like a correct one —
 * the failure mode Phase 0 flagged when it stubbed `lib/calendar` as throwing
 * rather than returning 0.
 *
 * **Unrounded on purpose.** The result is an intermediate: SPEC §5.4 multiplies
 * it by a percentage and by a day count before anything is persisted, and
 * `lib/money`'s policy is one explicit `round2()` at the end (see the module
 * note there). Rounding here would drift every salaried worker's penalty.
 */
export function dailyRate(
  profile: PayProfile,
  workingDaysPerMonth: number,
): Money | null {
  if (!Number.isFinite(workingDaysPerMonth) || workingDaysPerMonth <= 0) {
    throw new RangeError(
      `workingDaysPerMonth must be a positive number, got ${workingDaysPerMonth}`,
    )
  }

  const salary = monthlySalaryOf(profile)
  if (salary === null) return null

  return div(salary, workingDaysPerMonth)
}
