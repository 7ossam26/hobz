import { prisma } from '@/lib/db'
import type { Db } from '@/lib/db'

import { createCalendar, type Calendar } from './calendar'
import { prismaCalendarSource } from './source'

/**
 * `lib/calendar` — the business-day layer (SPEC §4 Calendar, §5.2, §5.3).
 *
 *   cairo.ts          Cairo date keys and the one instant↔date conversion
 *   work-calendar.ts  the Settings group as a value object
 *   calendar.ts       `createCalendar(source)` — all of the arithmetic
 *   source.ts         where the facts come from (Prisma, or a batch snapshot)
 *
 * Phase 0 shipped this as five throwing stubs, with a note that a
 * `workingDaysBetween` quietly returning 0 "would make the penalty engine
 * compute zero deductions and look like it worked — the worst possible failure
 * for this product". Phase 6 fills them in; the contract they were stubbed
 * against is unchanged, and `Calendar` gained exactly one method
 * (`workCalendar()`), because SPEC §5.4's `dailyRate(user) = monthlySalary ÷
 * settings.workingDaysPerMonth` is calendar knowledge and Phase 8 should not
 * have to reach past this module to get it.
 */

export * from './cairo'
export * from './work-calendar'
export * from './calendar'
export { cairoDateKeySchema } from './zod'
export {
  prismaCalendarSource,
  snapshotCalendarSource,
  loadWorkCalendar,
  expandHolidayRows,
  expandLeaveRows,
  dateColumnValue,
  type CalendarSnapshotArgs,
} from './source'

/**
 * A calendar bound to a specific client — the form services and jobs take, so
 * that a calendar read inside a transaction sees that transaction's writes.
 */
export function calendarFor(db: Db): Calendar {
  return createCalendar(prismaCalendarSource(db))
}

// Lazily constructed for the same reason `lib/settings` does it: importing
// anything from here in a unit test must not require a database.
let appCalendar: Calendar | null = null

function app(): Calendar {
  appCalendar ??= calendarFor(prisma)
  return appCalendar
}

/** The app-wide calendar, on the singleton Prisma client. */
export const calendar: Calendar = {
  workCalendar: () => app().workCalendar(),
  isWorkingDay: (date, userId) => app().isWorkingDay(date, userId),
  workingDaysBetween: (from, to, userId) => app().workingDaysBetween(from, to, userId),
  workingMinutesBetween: (from, to, userId) =>
    app().workingMinutesBetween(from, to, userId),
  addWorkingDays: (date, days, userId) => app().addWorkingDays(date, days, userId),
  nextWorkingDay: (date, userId) => app().nextWorkingDay(date, userId),
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
