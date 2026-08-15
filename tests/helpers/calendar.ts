import {
  buildWorkCalendar,
  type CalendarSource,
  type Calendar,
  type Weekday,
  type WorkCalendar,
} from '@/lib/calendar'

import { cairo, cairoWeekday } from './time'

/**
 * Test doubles for `lib/calendar`.
 *
 * Phase 4 consumes the calendar (elapsed working time, SPEC §5.2) but does not
 * implement it — Phase 6 does. So the contract is exercised here against two
 * doubles, chosen deliberately:
 *
 *  - `stubCalendar()` answers with whatever the test hands it. Used to prove
 *    *wiring*: that `computeElapsed` passes the real instants and the real
 *    assignee id through, and returns what the calendar said.
 *  - `businessDayCalendar()` is a small, honest weekend/holiday/leave model.
 *    Used to prove *semantics* that belong to Phase 4's side of the boundary —
 *    above all SPEC §5.2's T2 edge case: working on a day off never increases
 *    and never decreases working time.
 *
 * Neither is a preview of Phase 6's implementation, and neither should grow
 * into one. When `lib/calendar` lands for real, its own tests are what prove it
 * correct; these two only have to be predictable.
 */

const DEFAULT_WEEKEND: readonly Weekday[] = ['FRI', 'SAT']
const MINUTE_MS = 60_000

/** Cairo calendar date of an instant, as `YYYY-MM-DD`. */
export function cairoDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

function addCairoDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const stepped = new Date(Date.UTC(y, m - 1, d + days))
  return stepped.toISOString().slice(0, 10)
}

export interface LeaveRange {
  userId: string
  /** Inclusive Cairo dates, `YYYY-MM-DD`. */
  start: string
  end: string
}

export interface BusinessDayCalendarOptions {
  weekendDays?: readonly Weekday[]
  /** Cairo dates, `YYYY-MM-DD`. */
  holidays?: readonly string[]
  leave?: readonly LeaveRange[]
  /** `HH:mm`, Cairo wall clock. */
  workdayStart?: string
  workdayEnd?: string
}

/**
 * A calendar that knows about weekends, holidays and per-user approved leave,
 * and nothing else. Working minutes accrue only inside the workday window of a
 * working day, which is what makes "submitted at 22:00 on a Friday" contribute
 * exactly zero.
 */
export function businessDayCalendar(options: BusinessDayCalendarOptions = {}): Calendar {
  const weekendDays = options.weekendDays ?? DEFAULT_WEEKEND
  const holidays = new Set(options.holidays ?? [])
  const leave = options.leave ?? []
  const workdayStart = options.workdayStart ?? '09:00'
  const workdayEnd = options.workdayEnd ?? '17:00'

  const onLeave = (date: string, userId?: string): boolean =>
    userId !== undefined &&
    leave.some((l) => l.userId === userId && date >= l.start && date <= l.end)

  const isWorkingDate = (date: string, userId?: string): boolean => {
    const weekday = cairoWeekday(cairo(`${date}T12:00`)) as Weekday
    if (weekendDays.includes(weekday)) return false
    if (holidays.has(date)) return false
    return !onLeave(date, userId)
  }

  /** Every Cairo date touched by [from, to), in order. Bounded for safety. */
  const datesBetween = (from: Date, to: Date): string[] => {
    const dates: string[] = []
    const last = cairoDate(to)
    let cursor = cairoDate(from)
    for (let guard = 0; guard < 4_000; guard += 1) {
      dates.push(cursor)
      if (cursor >= last) break
      cursor = addCairoDays(cursor, 1)
    }
    return dates
  }

  return {
    workCalendar: async () =>
      buildWorkCalendar({
        weekendDays,
        workdayStart,
        workdayEnd,
        workingDaysPerMonth: 22,
      }),

    isWorkingDay: async (date, userId) => isWorkingDate(cairoDate(date), userId),

    workingDaysBetween: async (from, to, userId) => {
      if (to.getTime() <= from.getTime()) return 0
      // Half-open [from, to): the day `to` falls on only counts if `to` is past
      // its start of day, which for whole-day boundaries means it does not.
      return datesBetween(from, to).filter(
        (date) =>
          cairo(`${date}T00:00`).getTime() >= from.getTime() - 1 &&
          cairo(`${date}T00:00`).getTime() < to.getTime() &&
          isWorkingDate(date, userId),
      ).length
    },

    workingMinutesBetween: async (from, to, userId) => {
      if (to.getTime() <= from.getTime()) return 0

      let minutes = 0
      for (const date of datesBetween(from, to)) {
        if (!isWorkingDate(date, userId)) continue

        const windowStart = cairo(`${date}T${workdayStart}`).getTime()
        const windowEnd = cairo(`${date}T${workdayEnd}`).getTime()

        const overlapStart = Math.max(windowStart, from.getTime())
        const overlapEnd = Math.min(windowEnd, to.getTime())
        if (overlapEnd > overlapStart) {
          minutes += Math.floor((overlapEnd - overlapStart) / MINUTE_MS)
        }
      }
      return minutes
    },

    addWorkingDays: async (date, days, userId) => {
      let cursor = cairoDate(date)
      let remaining = days
      for (let guard = 0; guard < 4_000 && remaining > 0; guard += 1) {
        cursor = addCairoDays(cursor, 1)
        if (isWorkingDate(cursor, userId)) remaining -= 1
      }
      return cairo(`${cursor}T${workdayStart}`)
    },

    nextWorkingDay: async (date, userId) => {
      let cursor = addCairoDays(cairoDate(date), 1)
      for (let guard = 0; guard < 4_000; guard += 1) {
        if (isWorkingDate(cursor, userId)) break
        cursor = addCairoDays(cursor, 1)
      }
      return cairo(`${cursor}T${workdayStart}`)
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6 — the real `lib/calendar`, fed from memory instead of Postgres
// ─────────────────────────────────────────────────────────────────────────────

export interface InMemoryCalendarOptions {
  weekendDays?: readonly Weekday[]
  /** `HH:mm`, Cairo wall clock. */
  workdayStart?: string
  workdayEnd?: string
  workingDaysPerMonth?: number
  /** One-off holidays, as Cairo date keys (`YYYY-MM-DD`). */
  holidays?: readonly string[]
  /** Yearly holidays, as `MM-DD`. Expanded across whatever range is asked for. */
  recurringHolidays?: readonly string[]
  /** APPROVED leave only — a source never sees the pending or rejected rows. */
  leave?: readonly LeaveRange[]
}

/**
 * A `CalendarSource` with no database behind it.
 *
 * This is what the `lib/calendar` unit suite runs against: the *real*
 * implementation, given holidays and leave directly. `businessDayCalendar()`
 * above is a different thing entirely — a hand-rolled model of a calendar,
 * written in Phase 4 to exercise code that only *consumed* the interface. The
 * two must not be confused: one proves `lib/calendar`, the other stands in for
 * it.
 */
export function inMemoryCalendarSource(
  options: InMemoryCalendarOptions = {},
): CalendarSource & { holidayCalls: number; leaveCalls: number } {
  const work = buildWorkCalendar({
    weekendDays: options.weekendDays ?? DEFAULT_WEEKEND,
    workdayStart: options.workdayStart ?? '09:00',
    workdayEnd: options.workdayEnd ?? '17:00',
    workingDaysPerMonth: options.workingDaysPerMonth ?? 22,
  })

  const oneOff = options.holidays ?? []
  const recurring = options.recurringHolidays ?? []
  const leave = options.leave ?? []

  const source = {
    holidayCalls: 0,
    leaveCalls: 0,

    async workCalendar(): Promise<WorkCalendar> {
      return work
    },

    async holidays(from: string, to: string): Promise<ReadonlySet<string>> {
      source.holidayCalls += 1
      const keys = new Set<string>()
      for (const key of oneOff) {
        if (key >= from && key <= to) keys.add(key)
      }
      const firstYear = Number(from.slice(0, 4))
      const lastYear = Number(to.slice(0, 4))
      for (let year = firstYear; year <= lastYear; year += 1) {
        for (const monthDay of recurring) {
          const key = `${year}-${monthDay}`
          if (key >= from && key <= to) keys.add(key)
        }
      }
      return keys
    },

    async leaveDays(
      userId: string,
      from: string,
      to: string,
    ): Promise<ReadonlySet<string>> {
      source.leaveCalls += 1
      const keys = new Set<string>()
      for (const range of leave) {
        if (range.userId !== userId) continue
        let cursor = range.start > from ? range.start : from
        const last = range.end < to ? range.end : to
        for (let guard = 0; guard < 4_000 && cursor <= last; guard += 1) {
          keys.add(cursor)
          cursor = addCairoDayKey(cursor, 1)
        }
      }
      return keys
    },
  }

  return source
}

/** Local `YYYY-MM-DD` + n, kept independent of the implementation under test. */
function addCairoDayKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export interface StubCalendarOptions {
  workingMinutesBetween?: Calendar['workingMinutesBetween']
  workingDaysBetween?: Calendar['workingDaysBetween']
  isWorkingDay?: Calendar['isWorkingDay']
}

/**
 * Answers exactly what the test says, and records what it was asked. The
 * fixed-value default is intentionally *not* derived from the inputs — a stub
 * that quietly computed the right answer could not tell a passing wiring test
 * from a passing accident.
 */
export function stubCalendar(options: StubCalendarOptions = {}): Calendar & {
  calls: Array<{ from: Date; to: Date; userId: string | undefined }>
} {
  const calls: Array<{ from: Date; to: Date; userId: string | undefined }> = []

  return {
    calls,
    workCalendar: async () =>
      buildWorkCalendar({
        weekendDays: DEFAULT_WEEKEND,
        workdayStart: '09:00',
        workdayEnd: '17:00',
        workingDaysPerMonth: 22,
      }),
    isWorkingDay: options.isWorkingDay ?? (async () => true),
    workingDaysBetween: options.workingDaysBetween ?? (async () => 0),
    workingMinutesBetween: async (from, to, userId) => {
      calls.push({ from, to, userId })
      return options.workingMinutesBetween
        ? options.workingMinutesBetween(from, to, userId)
        : 0
    },
    addWorkingDays: async (date) => date,
    nextWorkingDay: async (date) => date,
  }
}
