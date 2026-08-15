import { DomainError } from '@/lib/errors'

/**
 * The civil-date layer under `lib/calendar`.
 *
 * CLAUDE.md invariant 5 — "never subtract two dates for lateness or elapsed
 * working time" — is not a style rule. Two things break when you do:
 *
 *  1. **Days are not 86 400 000 ms.** Egypt reinstated summer time in 2023, so
 *     a Cairo year contains one 23-hour day (the last Friday of April) and one
 *     25-hour day (the last Thursday of October). `(to - from) / DAY_MS` is
 *     wrong twice a year, and both times it lands on the Friday/Thursday pair
 *     the default weekend is built around.
 *  2. **A UTC day is not a Cairo day.** 22:30Z on the 14th is already the 15th
 *     in Cairo. A deadline read in the wrong zone is a dispute about a
 *     deduction.
 *
 * So the unit of arithmetic here is the **Cairo date key** — `YYYY-MM-DD`, the
 * calendar day a Cairo wall clock would show — and all of it runs on integer
 * civil fields, never on millisecond deltas. The only place an instant and a
 * date key meet is `cairoInstant()`, which asks the platform's timezone
 * database rather than assuming an offset.
 */

export const CAIRO_TIMEZONE = 'Africa/Cairo'

export type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT'

export const WEEKDAYS: readonly Weekday[] = [
  'SUN',
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
]

/** A Cairo calendar date, `YYYY-MM-DD`. Ordered lexicographically, on purpose. */
export type CairoDateKey = string

/**
 * `en-US` with an explicit `timeZone` is used only to *extract* numbers. The
 * locale never reaches the screen; a numeric formatter with a fixed locale is
 * the one reliable way to ask "what is the wall clock in Cairo at this
 * instant".
 */
const CAIRO_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TIMEZONE,
  calendar: 'gregory',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export interface CairoParts {
  year: number
  /** 1–12. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: Weekday
}

/**
 * The Cairo wall clock at an instant.
 *
 * Lives here rather than in `lib/datetime` (which re-exports it) because it is
 * the primitive both the display layer and the business-day layer are built
 * on, and the business-day layer is the one that must not be able to disagree
 * with it. One implementation, one place to be wrong.
 */
export function cairoParts(date: Date): CairoParts {
  const parts = CAIRO_PARTS.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  // `hour12: false` renders midnight as 24 in some ICU builds. Folding it here
  // keeps every downstream comparison on a 0–23 clock; the *date* part is
  // already the correct day in those builds, so nothing else needs adjusting.
  const hour = Number(get('hour')) % 24

  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))

  return {
    year,
    month,
    day,
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    // Derived from the civil date rather than read from the formatter: it is
    // the same answer, it costs nothing, and it means `weekdayOfKey` and
    // `cairoParts` cannot drift apart across ICU versions.
    weekday: weekdayOfDayNumber(daysFromCivil(year, month, day)),
  }
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

export function cairoDateKey(at: Date): CairoDateKey {
  const { year, month, day } = cairoParts(at)
  return `${year}-${pad2(month)}-${pad2(day)}`
}

// ─────────────────────────────────────────────────────────────────────────
// Civil-date arithmetic — integers only, no `Date` anywhere in here
// ─────────────────────────────────────────────────────────────────────────

/**
 * Days since 1970-01-01, from a proleptic-Gregorian civil date.
 *
 * Howard Hinnant's `days_from_civil`, which is exact for every year including
 * the century rules a naive `% 4` gets wrong (1900 was not a leap year; 2000
 * was). Integer arithmetic throughout, so a 23-hour day cannot perturb it.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** The inverse of `daysFromCivil`. */
function civilFromDays(dayNumber: number): { year: number; month: number; day: number } {
  const z = dayNumber + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) /
      365,
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  return { year: y + (month <= 2 ? 1 : 0), month, day }
}

/** 1970-01-01 was a Thursday, so day number 0 is THU. */
const WEEKDAY_FROM_EPOCH: readonly Weekday[] = [
  'THU',
  'FRI',
  'SAT',
  'SUN',
  'MON',
  'TUE',
  'WED',
]

function weekdayOfDayNumber(dayNumber: number): Weekday {
  const index = ((dayNumber % 7) + 7) % 7
  return WEEKDAY_FROM_EPOCH[index] as Weekday
}

const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

interface KeyParts {
  year: number
  month: number
  day: number
}

function splitKey(key: CairoDateKey): KeyParts {
  const match = KEY_PATTERN.exec(key)
  if (!match) throw new DomainError('calendar.errors.invalidDate', { key })

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  // Round-trip through the day number: this is what rejects 2026-02-30 and
  // 2026-02-29 (not a leap year) without a month-length table.
  const round = civilFromDays(daysFromCivil(year, month, day))
  if (round.year !== year || round.month !== month || round.day !== day) {
    throw new DomainError('calendar.errors.invalidDate', { key })
  }

  return { year, month, day }
}

export function isCairoDateKey(value: string): boolean {
  try {
    splitKey(value)
    return true
  } catch {
    return false
  }
}

export function cairoDateKeyOfParts(
  year: number,
  month: number,
  day: number,
): CairoDateKey {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function partsOfKey(key: CairoDateKey): KeyParts {
  return splitKey(key)
}

export function dayNumberOfKey(key: CairoDateKey): number {
  const { year, month, day } = splitKey(key)
  return daysFromCivil(year, month, day)
}

export function keyOfDayNumber(dayNumber: number): CairoDateKey {
  const { year, month, day } = civilFromDays(dayNumber)
  return cairoDateKeyOfParts(year, month, day)
}

export function addCairoDays(key: CairoDateKey, days: number): CairoDateKey {
  return keyOfDayNumber(dayNumberOfKey(key) + days)
}

/** Signed count of calendar days from `from` to `to`. Never a ms division. */
export function cairoDaysBetweenKeys(from: CairoDateKey, to: CairoDateKey): number {
  return dayNumberOfKey(to) - dayNumberOfKey(from)
}

export function weekdayOfKey(key: CairoDateKey): Weekday {
  return weekdayOfDayNumber(dayNumberOfKey(key))
}

/** The Cairo weekday of an instant. */
export function cairoWeekdayOf(at: Date): Weekday {
  return cairoParts(at).weekday
}

// ─────────────────────────────────────────────────────────────────────────
// Instants
// ─────────────────────────────────────────────────────────────────────────

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `HH:mm` → minutes since midnight. Throws rather than guessing. */
export function parseTimeOfDay(value: string): number {
  const match = TIME_PATTERN.exec(value)
  if (!match) throw new DomainError('calendar.errors.invalidTime', { value })
  return Number(match[1]) * 60 + Number(match[2])
}

/** Cairo's offset from UTC at an instant, in milliseconds. Never assumed. */
export function cairoOffsetMs(at: Date): number {
  const p = cairoParts(at)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // `at` carries milliseconds the formatter does not report; drop them from
  // both sides so the difference is a whole-second offset and nothing else.
  return asUtc - (at.getTime() - at.getMilliseconds())
}

/**
 * The UTC instant at which a Cairo wall clock reads `key` + `minutesOfDay`.
 *
 * Two passes, because the offset at the *guessed* instant can differ from the
 * offset at the *correct* one when the two sit on opposite sides of a
 * transition. The second pass is measured from the first pass's answer, which
 * is always within an hour of the truth.
 *
 * On the one day a year where the requested wall clock does not exist — 00:00
 * on the last Friday of April, which Egypt skips straight to 01:00 — the two
 * passes land on the first instant that *does* exist on that date, which is
 * exactly what "the start of that day" means. `tests/unit/calendar/cairo.test.ts`
 * asserts that property for every day of a year rather than trusting this
 * paragraph.
 */
export function cairoInstant(key: CairoDateKey, minutesOfDay: number): Date {
  const { year, month, day } = splitKey(key)
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesOfDay * 60_000
  const firstPass = new Date(naive - cairoOffsetMs(new Date(naive)))
  return new Date(naive - cairoOffsetMs(firstPass))
}

export function startOfCairoDay(key: CairoDateKey): Date {
  return cairoInstant(key, 0)
}

/** Exclusive: the instant the *next* Cairo day begins. */
export function endOfCairoDay(key: CairoDateKey): Date {
  return startOfCairoDay(addCairoDays(key, 1))
}

/**
 * Shift an instant by a fixed number of hours.
 *
 * This is a *duration*, not calendar arithmetic — "24 hours of grace" is 24
 * hours of real time on both sides of a DST transition, which is what a grace
 * period means (SPEC §5.3) and what makes it identical for every worker
 * regardless of which day it lands on. It lives here so that lateness code
 * never has to reach for raw millisecond maths of its own.
 */
export function addHours(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * 3_600_000)
}
