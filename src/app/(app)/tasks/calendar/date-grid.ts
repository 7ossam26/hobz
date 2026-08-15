/**
 * Pure grid maths for the calendar view. Gregorian, week starting Sunday
 * (SPEC §2: Gregorian calendar; Sunday is the first day of the Egyptian work
 * week, which is what makes the default weekend — Friday+Saturday, `lib/
 * settings`'s `calendar.weekendDays` — land at the *end* of a row instead of
 * splitting it). No business-day logic here: `lib/calendar`'s working-day
 * maths is Phase 6's, and this file only answers "which calendar cell does
 * this date belong in" for a grid that is decoration, not a deadline
 * calculation.
 *
 * Every date is a UTC day boundary (`00:00:00.000Z`) so the grid never drifts
 * a cell because of the viewer's local offset — the same reason SPEC §2 says
 * "store UTC, render Cairo" for everything else.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

export function isSameUtcDay(a: Date, b: Date): boolean {
  return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime()
}

/** The Sunday on or before `date`. */
export function startOfWeekUtc(date: Date): Date {
  const day = startOfUtcDay(date)
  return addDays(day, -day.getUTCDay())
}

export function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

/**
 * The 6-row, 42-cell grid a month view draws — always six weeks, so the grid
 * never reflows height between a 4-week and a 6-week month.
 */
export function monthGridRange(reference: Date): {
  from: Date
  to: Date
  weeks: Date[][]
} {
  const monthStart = startOfMonthUtc(reference)
  const from = startOfWeekUtc(monthStart)
  const weeks: Date[][] = []
  let cursor = from

  for (let week = 0; week < 6; week++) {
    const row: Date[] = []
    for (let day = 0; day < 7; day++) {
      row.push(cursor)
      cursor = addDays(cursor, 1)
    }
    weeks.push(row)
  }

  // `cursor` now sits one day past the last cell drawn.
  const to = addDays(cursor, -1)
  return { from, to, weeks }
}

export function weekRange(reference: Date): { from: Date; to: Date; days: Date[] } {
  const from = startOfWeekUtc(reference)
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  return { from, to: addDays(from, 6), days }
}

/** `YYYY-MM-DD`, the calendar's own URL param format — stable across timezones. */
export function toDateParam(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10)
}

export function fromDateParam(raw: string | undefined | null, fallback: Date): Date {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return startOfUtcDay(fallback)
  const parsed = new Date(`${raw}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? startOfUtcDay(fallback) : parsed
}
