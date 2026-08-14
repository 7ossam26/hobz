import { ar } from '@/i18n/ar'
import type { Weekday } from '@/lib/calendar'

/**
 * lib/datetime — how a moment is *shown*.
 *
 * Strictly display. Business-day arithmetic — lateness, elapsed working time,
 * anything that decides money — belongs to `lib/calendar` and never to this
 * file (CLAUDE.md invariant 5). Nothing here subtracts two dates for any
 * purpose other than choosing a phrase for a human to read.
 *
 * Three decisions, all from SPEC §2 and CLAUDE.md:
 *
 *  - **Cairo, always.** Timestamps are stored UTC and rendered in
 *    `Africa/Cairo`, so a manager and a worker looking at the same deadline
 *    read the same hour regardless of where the server runs.
 *  - **Gregorian calendar, Arabic month names, Western digits.** The month
 *    names come from `src/i18n/ar.ts` rather than from ICU: month names are
 *    display copy, they belong with the rest of it, and hardcoding them makes
 *    the output identical on every Node build instead of dependent on the
 *    bundled ICU version.
 *  - **Explicit assembly.** `Intl` supplies the calendar arithmetic (which is
 *    genuinely hard) and this module supplies the wording (which is not).
 */

export const CAIRO_TIMEZONE = 'Africa/Cairo'

/**
 * `en-US` with an explicit `timeZone` is used only to *extract* numbers. The
 * locale never reaches the screen; it is here because a numeric formatter with
 * a fixed locale is the one reliable way to ask "what is the wall-clock date in
 * Cairo for this instant".
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
  weekday: 'short',
})

/** `Weekday` is `lib/calendar`'s type, imported rather than restated: the two
    modules must agree on what "Friday" is called, and one of them owns it. */
const WEEKDAY_BY_SHORT: Record<string, Weekday> = {
  Sun: 'SUN',
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
}

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

export function cairoParts(date: Date): CairoParts {
  const parts = CAIRO_PARTS.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  // `hour12: false` renders midnight as 24 in some ICU builds. Folding it here
  // keeps every downstream comparison on a 0–23 clock.
  const hour = Number(get('hour')) % 24

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_BY_SHORT[get('weekday')] ?? 'SUN',
  }
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

/** `14 أغسطس 2026` — Gregorian, Arabic month, Western digits. */
export function formatDate(date: Date): string {
  const { year, month, day } = cairoParts(date)
  return `${day} ${ar.months[month - 1] ?? ''} ${year}`
}

/** `14 أغسطس` — for ranges and columns where the year is implied. */
export function formatDateShort(date: Date): string {
  const { month, day } = cairoParts(date)
  return `${day} ${ar.months[month - 1] ?? ''}`
}

/** `15:30`, 24-hour. Egypt reads clock time in 24h in an operational tool. */
export function formatTime(date: Date): string {
  const { hour, minute } = cairoParts(date)
  return `${pad2(hour)}:${pad2(minute)}`
}

/** `14 أغسطس 2026، 15:30`. */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)}${ar.common.listSeparator}${formatTime(date)}`
}

/** `2026-08-14` — machine form, for `<time dateTime>` and date inputs. */
export function toCairoDateInput(date: Date): string {
  const { year, month, day } = cairoParts(date)
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** `2026-08-14T15:30` — the value a `datetime-local` input expects. */
export function toCairoDateTimeInput(date: Date): string {
  const { hour, minute } = cairoParts(date)
  return `${toCairoDateInput(date)}T${pad2(hour)}:${pad2(minute)}`
}

export function isSameCairoDay(a: Date, b: Date): boolean {
  return toCairoDateInput(a) === toCairoDateInput(b)
}

export const cairoWeekday = (date: Date): Weekday => cairoParts(date).weekday

/**
 * Arabic counts inflect in four bands, not two, and getting it wrong is the
 * fastest way to make a product read as machine-translated:
 *
 *   1        دقيقة        (singular)
 *   2        دقيقتين      (dual — a separate word, not "2 دقيقة")
 *   3–10     3 دقائق      (plural of paucity)
 *   11+      11 دقيقة     (singular again, accusative)
 *
 * The forms live in `ar.time.units`; this function only picks between them.
 */
function countPhrase(unit: keyof typeof ar.time.units, count: number): string {
  const forms = ar.time.units[unit]
  if (count === 1) return forms.one
  if (count === 2) return forms.two
  const template = count >= 3 && count <= 10 ? forms.few : forms.many
  return template.replace('{n}', String(count))
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

interface RelativeParts {
  unit: keyof typeof ar.time.units
  count: number
}

/**
 * Choose the coarsest unit that still says something useful. Months and years
 * are approximated from days on purpose: "منذ 3 أشهر" does not need to know
 * which months they were, and pretending otherwise would put calendar
 * arithmetic in a display helper.
 */
function pickUnit(absMs: number): RelativeParts {
  const minutes = Math.floor(absMs / MINUTE)
  if (minutes < 60) return { unit: 'minute', count: Math.max(minutes, 1) }

  const hours = Math.floor(absMs / HOUR)
  if (hours < 24) return { unit: 'hour', count: hours }

  const days = Math.floor(absMs / DAY)
  if (days < 7) return { unit: 'day', count: days }
  if (days < 30) return { unit: 'week', count: Math.floor(days / 7) }
  if (days < 365) return { unit: 'month', count: Math.max(Math.floor(days / 30), 1) }
  return { unit: 'year', count: Math.max(Math.floor(days / 365), 1) }
}

/** Below this, "الآن" is more honest than a number. */
const NOW_THRESHOLD_MS = 45_000

/**
 * `منذ 5 دقائق` / `خلال 3 أيام` / `الآن`.
 *
 * `now` is a required argument rather than a `new Date()` inside: a component
 * that renders on the server and hydrates in the browser would otherwise
 * produce two different strings and warn, and a test could not pin the result
 * (docs/TESTING.md §5).
 */
export function formatRelative(date: Date, now: Date): string {
  const deltaMs = date.getTime() - now.getTime()
  const absMs = Math.abs(deltaMs)

  if (absMs < NOW_THRESHOLD_MS) return ar.time.now

  const { unit, count } = pickUnit(absMs)
  const phrase = countPhrase(unit, count)
  const template = deltaMs < 0 ? ar.time.ago : ar.time.within
  return template.replace('{value}', phrase)
}

/**
 * `3 ساعات و20 دقيقة` — for elapsed work, which is read as a quantity rather
 * than as a point in time.
 */
export function formatDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes))
  if (safe === 0) return countPhrase('minute', 0)

  const hours = Math.floor(safe / 60)
  const minutes = safe % 60

  if (hours === 0) return countPhrase('minute', minutes)
  if (minutes === 0) return countPhrase('hour', hours)
  return `${countPhrase('hour', hours)} ${ar.time.and}${countPhrase('minute', minutes)}`
}
