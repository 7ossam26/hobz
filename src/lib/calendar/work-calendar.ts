import { parseTimeOfDay, type Weekday } from './cairo'

/**
 * `WorkCalendar` — SPEC §4 lists this under "Calendar" as though it were a
 * table. It is not one, and that is a deliberate reading:
 *
 *   > weekend days · workday start/end · working days per month
 *
 * are all already Settings keys (`calendar.*`, SPEC §7), and CLAUDE.md
 * invariant 4 says every business number comes from `lib/settings`. A one-row
 * table holding the same four values would be a second authority, and the
 * first time the two disagreed the penalty engine would pick one of them
 * without anyone knowing which. So `WorkCalendar` is a *value object*: the
 * Settings group, parsed once into the shape the arithmetic wants.
 *
 * Recorded in docs/DECISIONS.md and reflected back into docs/SPEC.md §4.
 */

export interface WorkCalendarInput {
  weekendDays: readonly Weekday[]
  /** `HH:mm`, Cairo wall clock. */
  workdayStart: string
  workdayEnd: string
  workingDaysPerMonth: number
}

export interface WorkCalendar {
  weekendDays: ReadonlySet<Weekday>
  workdayStart: string
  workdayEnd: string
  /** Minutes since midnight. */
  workdayStartMinutes: number
  workdayEndMinutes: number
  /**
   * Length of one full workday, in minutes. **Zero when the bounds are
   * inverted or equal** — a window that ends before it starts has no honest
   * length, and zero is the only answer that cannot silently inflate somebody's
   * elapsed working time. The Settings schema validates each bound on its own
   * (`HH:mm`) but cannot compare the two, so this is where that shows up.
   */
  workdayMinutes: number
  /** Divisor for `dailyRate(user)` (SPEC §5.4). */
  workingDaysPerMonth: number
}

export function buildWorkCalendar(input: WorkCalendarInput): WorkCalendar {
  const workdayStartMinutes = parseTimeOfDay(input.workdayStart)
  const workdayEndMinutes = parseTimeOfDay(input.workdayEnd)

  return {
    weekendDays: new Set(input.weekendDays),
    workdayStart: input.workdayStart,
    workdayEnd: input.workdayEnd,
    workdayStartMinutes,
    workdayEndMinutes,
    workdayMinutes: Math.max(0, workdayEndMinutes - workdayStartMinutes),
    workingDaysPerMonth: input.workingDaysPerMonth,
  }
}
