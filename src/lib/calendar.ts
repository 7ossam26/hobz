import { NotImplementedError } from '@/lib/errors'

/**
 * lib/calendar — business-day mathematics. CLAUDE.md invariant 5: lateness and
 * elapsed working time NEVER come from subtracting two Dates.
 *
 * Phase 0 fixes the interface only. Phase 6 implements it against the
 * Settings-driven work calendar, the Holiday table and approved Leave.
 *
 * Every function is stubbed with a throwing `NotImplementedError` rather than a
 * plausible default. A `workingDaysBetween` that quietly returned 0 would make
 * the penalty engine compute zero deductions and look like it worked — the worst
 * possible failure for this product.
 *
 * Contract that Phase 6 must hold:
 *  - All inputs are UTC `Date`s; all reasoning happens in Africa/Cairo.
 *  - Weekend days, workday bounds and workingDaysPerMonth come from
 *    `lib/settings`, never from constants here.
 *  - Ranges are half-open [from, to): a task due and submitted at the same
 *    instant is 0 days late, not 1.
 *  - `userId` narrows the calendar by that user's APPROVED leave. Omitting it
 *    means "agency calendar only".
 */

export const CAIRO_TIMEZONE = 'Africa/Cairo'

export type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT'

export interface CalendarContext {
  /** Non-working days of the week. Default [FRI, SAT] from Settings. */
  weekendDays: readonly Weekday[]
  /** Public/agency holidays, as Cairo calendar dates. */
  holidays: readonly Date[]
  /** Approved leave ranges for the user being measured, if any. */
  leaveRanges: readonly { start: Date; end: Date }[]
  workdayStart: string
  workdayEnd: string
}

export interface Calendar {
  isWorkingDay(date: Date, userId?: string): Promise<boolean>
  /** Half-open [from, to). Excludes weekends, holidays and approved leave. */
  workingDaysBetween(from: Date, to: Date, userId?: string): Promise<number>
  /** Working minutes inside the configured workday bounds. */
  workingMinutesBetween(from: Date, to: Date, userId?: string): Promise<number>
  addWorkingDays(date: Date, days: number, userId?: string): Promise<Date>
  nextWorkingDay(date: Date, userId?: string): Promise<Date>
}

const unimplemented = (fn: string): never => {
  throw new NotImplementedError(`calendar.${fn}`, 'Phase 6')
}

export const calendar: Calendar = {
  isWorkingDay: async () => unimplemented('isWorkingDay'),
  workingDaysBetween: async () => unimplemented('workingDaysBetween'),
  workingMinutesBetween: async () => unimplemented('workingMinutesBetween'),
  addWorkingDays: async () => unimplemented('addWorkingDays'),
  nextWorkingDay: async () => unimplemented('nextWorkingDay'),
}

export const isWorkingDay: Calendar['isWorkingDay'] = (date, userId) =>
  calendar.isWorkingDay(date, userId)
export const workingDaysBetween: Calendar['workingDaysBetween'] = (from, to, userId) =>
  calendar.workingDaysBetween(from, to, userId)
export const workingMinutesBetween: Calendar['workingMinutesBetween'] = (
  from,
  to,
  userId,
) => calendar.workingMinutesBetween(from, to, userId)
export const addWorkingDays: Calendar['addWorkingDays'] = (date, days, userId) =>
  calendar.addWorkingDays(date, days, userId)
export const nextWorkingDay: Calendar['nextWorkingDay'] = (date, userId) =>
  calendar.nextWorkingDay(date, userId)
