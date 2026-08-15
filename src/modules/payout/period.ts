import { cairoDateKeyOfParts, cairoInstant, cairoParts } from '@/lib/calendar/cairo'

/**
 * modules/payout/period — where a cycle ends (SPEC §5.5).
 *
 *   > Cycle auto-closes on `settings.payoutCycleDay` (default 28) at 23:59 Cairo.
 *
 * All of it is arithmetic on a Cairo wall clock, so all of it goes through
 * `lib/calendar/cairo` (CLAUDE.md invariant 5). Adding thirty days to a
 * timestamp would be off by an hour for half the year and off by a day every
 * February.
 */

/** 23:59 Cairo, expressed the way `cairoInstant` wants it. */
export const CYCLE_END_MINUTE_OF_DAY = 23 * 60 + 59

/**
 * `payout.cycleDay` is capped at 28 in the settings catalog precisely so that
 * every month has the day and February needs no special case. Re-checked here
 * because this function is also reachable from a test and from an import.
 */
function assertCycleDay(cycleDay: number): void {
  if (!Number.isInteger(cycleDay) || cycleDay < 1 || cycleDay > 28) {
    throw new RangeError(`payout cycle day must be an integer in 1..28, got ${cycleDay}`)
  }
}

/**
 * The first 23:59-Cairo cycle boundary **strictly after** `now`.
 *
 * Strictly, because closing a cycle at its own `periodEnd` must open the next
 * one a month out rather than re-open the one that just ended. That single
 * `>` is what makes the close job idempotent with respect to the calendar.
 */
export function cycleEndAfter(now: Date, cycleDay: number): Date {
  assertCycleDay(cycleDay)

  const { year, month } = cairoParts(now)
  const thisMonth = cairoInstant(
    cairoDateKeyOfParts(year, month, cycleDay),
    CYCLE_END_MINUTE_OF_DAY,
  )
  if (thisMonth.getTime() > now.getTime()) return thisMonth

  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return cairoInstant(
    cairoDateKeyOfParts(nextYear, nextMonth, cycleDay),
    CYCLE_END_MINUTE_OF_DAY,
  )
}
