import { vi } from 'vitest'

/**
 * Time helpers — docs/TESTING.md §5: "Freeze time with helpers/time.ts, never
 * `new Date()` inside a test assertion."
 *
 * Everything is Africa/Cairo. The runner's TZ is pinned in tests/setup/unit.ts,
 * so `cairo()` below builds the instant a Cairo wall-clock reading refers to.
 */

export const CAIRO = 'Africa/Cairo'

/**
 * Build a UTC `Date` from a Cairo wall-clock reading.
 *
 * `cairo('2026-03-01T09:00')` is 09:00 in Cairo, i.e. 07:00Z in winter.
 * Computed from the actual zone offset rather than a hardcoded +02:00, so this
 * stays correct if Egypt reinstates DST (it did, in 2023).
 */
export function cairo(wallClock: string): Date {
  const naive = new Date(`${wallClock.replace(' ', 'T')}Z`)
  const offsetMs = cairoOffsetMs(naive)
  // Two passes: the offset at the guessed instant may differ from the offset at
  // the corrected instant across a transition boundary.
  const firstPass = new Date(naive.getTime() - offsetMs)
  return new Date(naive.getTime() - cairoOffsetMs(firstPass))
}

function cairoOffsetMs(at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((p) => [p.type, p.value]),
  ) as Record<string, string>

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - at.getTime()
}

/** Freeze the clock at a Cairo wall-clock reading. Remember `unfreezeTime()`. */
export function freezeTime(wallClock: string): Date {
  const at = cairo(wallClock)
  vi.useFakeTimers()
  vi.setSystemTime(at)
  return at
}

export function unfreezeTime(): void {
  vi.useRealTimers()
}

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export function advanceDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS)
}

export function advanceHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * HOUR_MS)
}

export function advanceMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * MINUTE_MS)
}

/** The Cairo weekday of an instant — the thing weekend logic actually cares about. */
export function cairoWeekday(at: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: CAIRO, weekday: 'short' })
    .format(at)
    .toUpperCase()
}
