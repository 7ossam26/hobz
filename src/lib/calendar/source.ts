import type { Db } from '@/lib/db'
import { getSettings } from '@/lib/settings'

import {
  addCairoDays,
  cairoDaysBetweenKeys,
  isCairoDateKey,
  type CairoDateKey,
} from './cairo'
import type { CalendarSource } from './calendar'
import { buildWorkCalendar, type WorkCalendar } from './work-calendar'

/**
 * Where `lib/calendar` gets its facts.
 *
 * ── Why there is no cache in here ─────────────────────────────────────────
 *
 * `lib/settings` caches with a TTL, and that is right for a grace period that
 * changes twice a year. Leave changes daily and is approved minutes before
 * somebody's deduction is recomputed, so a stale answer here is a wrong
 * penalty — the one failure this product exists to prevent. Every read is
 * therefore a query.
 *
 * The nightly job, which would otherwise issue two queries per task, uses
 * `snapshotCalendarSource()` instead: one holiday query, one leave query, then
 * everything in memory for the whole run. Fresh *and* cheap, without a cache
 * that can go stale between two unrelated callers.
 */

/**
 * `@db.Date` columns come back as UTC midnight — Prisma's representation of a
 * bare calendar date. The key is therefore the UTC date, and deliberately NOT
 * a Cairo conversion: converting would be applying a timezone to a value that
 * never had a time in it.
 */
function dateColumnKey(value: Date): CairoDateKey {
  return value.toISOString().slice(0, 10)
}

/** The instant a `@db.Date` column comparison expects for a given key. */
export function dateColumnValue(key: CairoDateKey): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

/** Every key in `[from, to]` inclusive, bounded so a bad range cannot hang. */
function expandRange(from: CairoDateKey, to: CairoDateKey): CairoDateKey[] {
  const span = cairoDaysBetweenKeys(from, to)
  if (span < 0) return []

  const keys: CairoDateKey[] = []
  let key = from
  for (let i = 0; i <= span && i < MAX_EXPANSION_DAYS; i += 1) {
    keys.push(key)
    key = addCairoDays(key, 1)
  }
  return keys
}

/** Twenty years. Past this a leave range is data corruption, not a holiday. */
const MAX_EXPANSION_DAYS = 7_400

export async function loadWorkCalendar(): Promise<WorkCalendar> {
  const settings = await getSettings([
    'calendar.weekendDays',
    'calendar.workdayStart',
    'calendar.workdayEnd',
    'calendar.workingDaysPerMonth',
  ])

  return buildWorkCalendar({
    weekendDays: settings['calendar.weekendDays'],
    workdayStart: settings['calendar.workdayStart'],
    workdayEnd: settings['calendar.workdayEnd'],
    workingDaysPerMonth: settings['calendar.workingDaysPerMonth'],
  })
}

/**
 * Recurring holidays are stored with the year of their first occurrence and
 * matched on month/day, so 7 January is a holiday in every year the range
 * touches. One-off rows (the Islamic calendar's, which move) match exactly.
 */
export function expandHolidayRows(
  rows: readonly { date: Date; isRecurring: boolean }[],
  from: CairoDateKey,
  to: CairoDateKey,
): Set<CairoDateKey> {
  const keys = new Set<CairoDateKey>()
  const firstYear = Number(from.slice(0, 4))
  const lastYear = Number(to.slice(0, 4))

  for (const row of rows) {
    const key = dateColumnKey(row.date)
    if (!row.isRecurring) {
      if (key >= from && key <= to) keys.add(key)
      continue
    }

    const monthDay = key.slice(5)
    for (let year = firstYear; year <= lastYear; year += 1) {
      const candidate = `${year}-${monthDay}`
      if (candidate < from || candidate > to) continue
      // A recurring 29 February has no occurrence in a common year, and
      // `2026-02-29` string-compares perfectly happily into the range. Without
      // this check the calendar would hand back a day that does not exist, and
      // `startOfCairoDay` would then throw on it deep inside a penalty
      // calculation. Found by `tests/integration/calendar/holidays.test.ts`.
      if (!isCairoDateKey(candidate)) continue
      keys.add(candidate)
    }
  }

  return keys
}

export function expandLeaveRows(
  rows: readonly { startDate: Date; endDate: Date }[],
  from: CairoDateKey,
  to: CairoDateKey,
): Set<CairoDateKey> {
  const keys = new Set<CairoDateKey>()

  for (const row of rows) {
    const start = dateColumnKey(row.startDate)
    const end = dateColumnKey(row.endDate)
    // Clip to the requested window before expanding: a year-long leave asked
    // about for one week must cost one week of iteration, not a year.
    for (const key of expandRange(start > from ? start : from, end < to ? end : to)) {
      keys.add(key)
    }
  }

  return keys
}

export function prismaCalendarSource(db: Db): CalendarSource {
  return {
    workCalendar: loadWorkCalendar,

    async holidays(from, to) {
      const rows = await db.holiday.findMany({
        where: {
          OR: [
            {
              isRecurring: false,
              date: { gte: dateColumnValue(from), lte: dateColumnValue(to) },
            },
            // Recurring rows are a handful and their stored year is
            // meaningless for matching, so they are all loaded and expanded.
            { isRecurring: true },
          ],
        },
        select: { date: true, isRecurring: true },
      })
      return expandHolidayRows(rows, from, to)
    },

    async leaveDays(userId, from, to) {
      const rows = await db.leave.findMany({
        where: {
          userId,
          status: 'APPROVED',
          startDate: { lte: dateColumnValue(to) },
          endDate: { gte: dateColumnValue(from) },
        },
        select: { startDate: true, endDate: true },
      })
      return expandLeaveRows(rows, from, to)
    },
  }
}

export interface CalendarSnapshotArgs {
  from: CairoDateKey
  to: CairoDateKey
  /** Whose leave to preload. Anyone outside this list is queried lazily. */
  userIds: readonly string[]
}

/**
 * One holiday query and one leave query for a whole batch — what the nightly
 * job uses so that recomputing a hundred tasks does not mean two hundred
 * round trips.
 *
 * A request outside the snapshot's window, or for a user who was not
 * preloaded, falls through to a live query rather than silently answering with
 * incomplete data.
 */
export async function snapshotCalendarSource(
  db: Db,
  args: CalendarSnapshotArgs,
): Promise<CalendarSource> {
  const live = prismaCalendarSource(db)
  const work = await loadWorkCalendar()

  const holidayRows = await db.holiday.findMany({
    where: {
      OR: [
        {
          isRecurring: false,
          date: { gte: dateColumnValue(args.from), lte: dateColumnValue(args.to) },
        },
        { isRecurring: true },
      ],
    },
    select: { date: true, isRecurring: true },
  })

  const leaveRows =
    args.userIds.length === 0
      ? []
      : await db.leave.findMany({
          where: {
            userId: { in: [...args.userIds] },
            status: 'APPROVED',
            startDate: { lte: dateColumnValue(args.to) },
            endDate: { gte: dateColumnValue(args.from) },
          },
          select: { userId: true, startDate: true, endDate: true },
        })

  const leaveByUser = new Map<string, Array<{ startDate: Date; endDate: Date }>>()
  for (const row of leaveRows) {
    const bucket = leaveByUser.get(row.userId) ?? []
    bucket.push({ startDate: row.startDate, endDate: row.endDate })
    leaveByUser.set(row.userId, bucket)
  }

  const known = new Set(args.userIds)
  const covers = (from: CairoDateKey, to: CairoDateKey): boolean =>
    from >= args.from && to <= args.to

  return {
    async workCalendar() {
      return work
    },

    async holidays(from, to) {
      if (!covers(from, to)) return live.holidays(from, to)
      return expandHolidayRows(holidayRows, from, to)
    },

    async leaveDays(userId, from, to) {
      if (!known.has(userId) || !covers(from, to)) return live.leaveDays(userId, from, to)
      return expandLeaveRows(leaveByUser.get(userId) ?? [], from, to)
    },
  }
}
