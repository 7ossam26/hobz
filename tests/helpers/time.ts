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
  // The formatter reports whole seconds, so the milliseconds have to come off
  // `at` too — otherwise the offset comes back fractional and every `===`
  // comparison against it (the DST bisect below, above all) silently fails.
  return asUtc - (at.getTime() - at.getMilliseconds())
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

/** Cairo's UTC offset at an instant, in minutes. +120 in winter, +180 in summer. */
export function cairoOffsetMinutes(at: Date): number {
  return cairoOffsetMs(at) / MINUTE_MS
}

export interface CairoTransitions {
  /** The instant the clock jumps forward (a 23-hour Cairo day starts here). */
  forward: Date | null
  /** The instant it jumps back (the Cairo day containing this one is 25 hours). */
  back: Date | null
}

/**
 * Find the year's DST transitions **by measurement, not by rule**.
 *
 * docs/TESTING.md §2 was corrected in Phase 4 to say Egypt has DST again
 * (reinstated 2023, forward on the last Friday of April, back on the last
 * Thursday of October) and to "never assume a fixed +02:00". Hardcoding the
 * two dates in a test would break the moment tzdata revises them — which is
 * precisely the class of change these tests exist to survive. So they are
 * derived: scan the year a day at a time for an offset change, then bisect to
 * the hour.
 */
export function findCairoTransitions(year: number): CairoTransitions {
  const start = Date.UTC(year, 0, 1)
  const end = Date.UTC(year + 1, 0, 1)

  let forward: Date | null = null
  let back: Date | null = null

  let previous = new Date(start)
  for (let t = start + DAY_MS; t <= end; t += DAY_MS) {
    const current = new Date(t)
    const before = cairoOffsetMinutes(previous)
    const after = cairoOffsetMinutes(current)
    if (before !== after) {
      const at = bisectTransition(previous, current)
      if (after > before) forward = at
      else back = at
    }
    previous = current
  }

  return { forward, back }
}

/**
 * The exact first instant whose offset differs from `lo`'s.
 *
 * Bisected to the millisecond, not to the minute: callers compare this against
 * `startOfCairoDay`, which returns an exact instant, and a helper that is
 * "within a minute" would fail that comparison for no real reason.
 */
function bisectTransition(lo: Date, hi: Date): Date {
  const target = cairoOffsetMinutes(lo)
  let low = lo.getTime()
  let high = hi.getTime()
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2)
    if (cairoOffsetMinutes(new Date(mid)) === target) low = mid
    else high = mid
  }
  return new Date(high)
}
