import { DomainError } from '@/lib/errors'

import {
  addCairoDays,
  cairoDateKey,
  cairoDaysBetweenKeys,
  cairoInstant,
  cairoParts,
  endOfCairoDay,
  startOfCairoDay,
  weekdayOfKey,
  type CairoDateKey,
} from './cairo'
import type { WorkCalendar } from './work-calendar'

/**
 * `lib/calendar` — business-day mathematics (SPEC §4 Calendar, §5.2, §5.3).
 *
 * ── The contract, restated from the Phase 0 stub and now honoured ─────────
 *
 *  - All inputs are UTC `Date`s; all reasoning happens in Africa/Cairo.
 *  - Weekend days, workday bounds and `workingDaysPerMonth` come from
 *    `lib/settings`, never from constants here.
 *  - Ranges are **half-open `[from, to)`**: a task due and submitted at the
 *    same instant is 0 days late, not 1.
 *  - `userId` narrows the calendar by that user's APPROVED leave. Omitting it
 *    means "agency calendar only".
 *
 * ── What "a working day between two instants" means ───────────────────────
 *
 * A Cairo day counts when **its own start** falls inside `[from, to)` and it
 * is a working day for the person being measured. Every consequence the SPEC
 * asks for falls out of that one rule, with no special cases:
 *
 *  - Same instant → 0. One minute later → still 0.
 *  - Each further midnight crossed into a working day → exactly one more.
 *  - **SPEC §5.2 T2**: moving a submission anywhere inside a weekend, a
 *    holiday or approved leave changes nothing, because those days contribute
 *    no boundary. Working voluntarily on a day off never hurts and never
 *    helps — it is not a rule bolted on, it is the absence of one.
 *
 * ── Why the counting is arithmetic, not a loop ────────────────────────────
 *
 * Full weeks contribute `weekendDays.size` non-working days each, so the
 * weekend cost of a span is computed rather than walked. Holidays and leave
 * are subtracted from the *rows that exist*, which the database bounds. A
 * year-long span therefore costs the same as a one-day span, and the nightly
 * job over every open task stays a handful of queries.
 * `tests/unit/calendar/working-days.test.ts` walks a year a day at a time and
 * demands the same answer, so the shortcut cannot quietly diverge.
 */

export interface CalendarSource {
  workCalendar(): Promise<WorkCalendar>
  /**
   * Holiday date keys covering `[from, to]` **inclusive**, with recurring
   * holidays already expanded across the years in the range.
   */
  holidays(from: CairoDateKey, to: CairoDateKey): Promise<ReadonlySet<CairoDateKey>>
  /** APPROVED leave date keys for one user covering `[from, to]` inclusive. */
  leaveDays(
    userId: string,
    from: CairoDateKey,
    to: CairoDateKey,
  ): Promise<ReadonlySet<CairoDateKey>>
}

export interface Calendar {
  /** The Settings-driven work calendar (SPEC §4, §7). */
  workCalendar(): Promise<WorkCalendar>
  isWorkingDay(date: Date, userId?: string): Promise<boolean>
  /** Half-open [from, to). Excludes weekends, holidays and approved leave. */
  workingDaysBetween(from: Date, to: Date, userId?: string): Promise<number>
  /** Working minutes inside the configured workday bounds. */
  workingMinutesBetween(from: Date, to: Date, userId?: string): Promise<number>
  addWorkingDays(date: Date, days: number, userId?: string): Promise<Date>
  nextWorkingDay(date: Date, userId?: string): Promise<Date>
}

/**
 * How far `addWorkingDays`/`nextWorkingDay` will search before giving up.
 *
 * Not a business number — it is the point past which "there is no next working
 * day" is the only honest answer, and refusing beats returning a plausible
 * date. Ten years is far beyond any deadline this product will ever set.
 */
const SEARCH_HORIZON_DAYS = 3_660

/** How much calendar `addWorkingDays` loads per query while it walks. */
const WINDOW_DAYS = 30

/**
 * Holidays and leave, loaded one window at a time.
 *
 * The window is **replaced** when a request falls outside it, not widened.
 * Widening looks kinder but is quadratic: `addWorkingDays` walking forward a
 * month at a time would re-fetch and re-expand everything it had already seen
 * on every step. Callers here always walk monotonically, so a replaced window
 * is never asked for again.
 */
interface DayExclusions {
  ensure(from: CairoDateKey, to: CairoDateKey): Promise<void>
  /** Holiday or approved leave — everything except the weekly weekend. */
  isExcluded(key: CairoDateKey): boolean
  excludedNonWeekendCount(
    from: CairoDateKey,
    to: CairoDateKey,
    weekend: ReadonlySet<string>,
  ): number
}

const EMPTY: ReadonlySet<string> = new Set()

function createExclusions(source: CalendarSource, userId?: string): DayExclusions {
  let loadedFrom: CairoDateKey | null = null
  let loadedTo: CairoDateKey | null = null
  let holidays: ReadonlySet<CairoDateKey> = EMPTY
  let leave: ReadonlySet<CairoDateKey> = EMPTY

  return {
    async ensure(from, to) {
      if (
        loadedFrom !== null &&
        loadedTo !== null &&
        from >= loadedFrom &&
        to <= loadedTo
      ) {
        return
      }

      holidays = await source.holidays(from, to)
      // A missing `userId` means "agency calendar only" — no user, no query.
      leave = userId === undefined ? EMPTY : await source.leaveDays(userId, from, to)

      loadedFrom = from
      loadedTo = to
    },

    isExcluded(key) {
      return holidays.has(key) || leave.has(key)
    },

    excludedNonWeekendCount(from, to, weekend) {
      let count = 0
      // Union of the two sets, minus anything the weekend already removed —
      // a holiday that lands on a Friday must not be subtracted twice, and a
      // leave day that lands on a holiday must not be either.
      const seen = new Set<string>()
      for (const key of holidays) {
        if (key < from || key > to) continue
        if (weekend.has(weekdayOfKey(key))) continue
        if (seen.has(key)) continue
        seen.add(key)
        count += 1
      }
      for (const key of leave) {
        if (key < from || key > to) continue
        if (weekend.has(weekdayOfKey(key))) continue
        if (seen.has(key)) continue
        seen.add(key)
        count += 1
      }
      return count
    },
  }
}

/** Weekend days in the inclusive key range `[from, to]`, counted arithmetically. */
function weekendDaysInRange(
  from: CairoDateKey,
  to: CairoDateKey,
  weekend: ReadonlySet<string>,
): number {
  if (weekend.size === 0) return 0

  const total = cairoDaysBetweenKeys(from, to) + 1
  const fullWeeks = Math.floor(total / 7)
  let count = fullWeeks * weekend.size

  // The 0–6 day remainder, walked. Bounded by six iterations, always.
  let key = addCairoDays(from, fullWeeks * 7)
  for (let i = fullWeeks * 7; i < total; i += 1) {
    if (weekend.has(weekdayOfKey(key))) count += 1
    key = addCairoDays(key, 1)
  }

  return count
}

const MINUTES_PER_DAY = 24 * 60

/**
 * Where `at` sits on `key`'s **wall clock**, in minutes since that day's
 * midnight, clamped to `[0, 1440]` for instants outside the day.
 *
 * Wall clock, not elapsed milliseconds — and on the two days a year that are
 * not 24 hours long those are different numbers. `workdayMinutes` is a
 * wall-clock length (17:00 − 09:00 = 480, whatever the tz database does at
 * midnight) and the interior of a span is counted by multiplying it, so the
 * clipped ends have to be measured on the same clock. Measured in real
 * milliseconds instead, a 00:00–23:59 window made the *same* Cairo day worth
 * 1379 minutes as an endpoint and 1439 as an interior day, and
 * `workingMinutesBetween(a, c)` stopped equalling `(a, b) + (b, c)` — the same
 * task returning two different elapsed times depending on where a job happened
 * to slice the span. The منفّذ works the window their clock shows; that is the
 * reading the whole module commits to (SPEC §5.2).
 *
 * The repeated hour on the 25-hour day therefore counts once, and the skipped
 * hour on the 23-hour day is not deducted. Both follow from the same rule.
 */
function wallMinutesOn(key: CairoDateKey, at: Date): number {
  if (at.getTime() <= startOfCairoDay(key).getTime()) return 0
  if (at.getTime() >= endOfCairoDay(key).getTime()) return MINUTES_PER_DAY

  const { hour, minute } = cairoParts(at)
  return hour * 60 + minute
}

export function createCalendar(source: CalendarSource): Calendar {
  /**
   * The first and last Cairo days whose *start* falls inside `[from, to)`.
   * Null when the range contains no day boundary at all — which is the common
   * case for a task submitted a few hours late, and correctly answers zero.
   */
  function boundaryDays(
    from: Date,
    to: Date,
  ): { first: CairoDateKey; last: CairoDateKey } | null {
    if (to.getTime() <= from.getTime()) return null

    const fromKey = cairoDateKey(from)
    const first =
      startOfCairoDay(fromKey).getTime() >= from.getTime()
        ? fromKey
        : addCairoDays(fromKey, 1)

    const toKey = cairoDateKey(to)
    const last =
      startOfCairoDay(toKey).getTime() < to.getTime() ? toKey : addCairoDays(toKey, -1)

    return cairoDaysBetweenKeys(first, last) < 0 ? null : { first, last }
  }

  async function countWorkingDays(
    from: Date,
    to: Date,
    work: WorkCalendar,
    exclusions: DayExclusions,
  ): Promise<number> {
    const span = boundaryDays(from, to)
    if (!span) return 0

    await exclusions.ensure(span.first, span.last)

    const total = cairoDaysBetweenKeys(span.first, span.last) + 1
    const weekend = weekendDaysInRange(span.first, span.last, work.weekendDays)
    const excluded = exclusions.excludedNonWeekendCount(
      span.first,
      span.last,
      work.weekendDays,
    )

    return Math.max(0, total - weekend - excluded)
  }

  async function isWorking(
    key: CairoDateKey,
    work: WorkCalendar,
    exclusions: DayExclusions,
  ): Promise<boolean> {
    if (work.weekendDays.has(weekdayOfKey(key))) return false
    await exclusions.ensure(key, key)
    return !exclusions.isExcluded(key)
  }

  /** Minutes of the workday window on `key` that fall inside `[from, to)`. */
  function windowOverlapMinutes(
    key: CairoDateKey,
    from: Date,
    to: Date,
    work: WorkCalendar,
  ): number {
    if (work.workdayMinutes === 0) return 0

    const start = Math.max(work.workdayStartMinutes, wallMinutesOn(key, from))
    const end = Math.min(work.workdayEndMinutes, wallMinutesOn(key, to))
    return end > start ? end - start : 0
  }

  async function addWorkingDays(
    date: Date,
    days: number,
    userId?: string,
  ): Promise<Date> {
    const work = await source.workCalendar()
    const exclusions = createExclusions(source, userId)

    const step = days < 0 ? -1 : 1
    let remaining = Math.abs(days)
    let key = cairoDateKey(date)

    // The loaded window is tracked here rather than inferred from
    // `exclusions.ensure`, and the distinction is not cosmetic: asking for
    // `[key, key + 30]` on *every* step means the requested range always ends
    // one day past what is loaded, so the window is replaced on every single
    // day walked — a query per day, which is exactly what loading a month at a
    // time was supposed to avoid. Re-loading only when the cursor actually
    // leaves the window turns a 40-working-day count from 116 round trips into
    // four. Found by the axis-5 sweep, which counted them.
    let windowFrom: CairoDateKey | null = null
    let windowTo: CairoDateKey | null = null

    for (let guard = 0; remaining > 0; guard += 1) {
      if (guard >= SEARCH_HORIZON_DAYS) {
        throw new DomainError('calendar.errors.noWorkingDay', {
          from: cairoDateKey(date),
          days,
        })
      }
      key = addCairoDays(key, step)

      if (
        windowFrom === null ||
        windowTo === null ||
        key < windowFrom ||
        key > windowTo
      ) {
        const far = addCairoDays(key, step * WINDOW_DAYS)
        windowFrom = step > 0 ? key : far
        windowTo = step > 0 ? far : key
        await exclusions.ensure(windowFrom, windowTo)
      }

      if (await isWorking(key, work, exclusions)) remaining -= 1
    }

    return cairoInstant(key, work.workdayStartMinutes)
  }

  return {
    async workCalendar() {
      return source.workCalendar()
    },

    async isWorkingDay(date, userId) {
      const work = await source.workCalendar()
      return isWorking(cairoDateKey(date), work, createExclusions(source, userId))
    },

    async workingDaysBetween(from, to, userId) {
      const work = await source.workCalendar()
      return countWorkingDays(from, to, work, createExclusions(source, userId))
    },

    async workingMinutesBetween(from, to, userId) {
      if (to.getTime() <= from.getTime()) return 0

      const work = await source.workCalendar()
      if (work.workdayMinutes === 0) return 0

      const exclusions = createExclusions(source, userId)
      const firstKey = cairoDateKey(from)
      const lastKey = cairoDateKey(to)
      await exclusions.ensure(firstKey, lastKey)

      // One day: a single clipped window, and nothing else to add.
      if (firstKey === lastKey) {
        return (await isWorking(firstKey, work, exclusions))
          ? windowOverlapMinutes(firstKey, from, to, work)
          : 0
      }

      let minutes = 0
      if (await isWorking(firstKey, work, exclusions)) {
        minutes += windowOverlapMinutes(firstKey, from, to, work)
      }
      if (await isWorking(lastKey, work, exclusions)) {
        minutes += windowOverlapMinutes(lastKey, from, to, work)
      }

      // Whole days in between contribute a whole workday each. Counting them
      // rather than walking them is what keeps a months-long span cheap; the
      // half-open boundary rule makes `[start of first+1, start of last)`
      // exactly the interior.
      const interior = await countWorkingDays(
        startOfCairoDay(addCairoDays(firstKey, 1)),
        startOfCairoDay(lastKey),
        work,
        exclusions,
      )

      return minutes + interior * work.workdayMinutes
    },

    addWorkingDays,

    async nextWorkingDay(date, userId) {
      return addWorkingDays(date, 1, userId)
    },
  }
}
