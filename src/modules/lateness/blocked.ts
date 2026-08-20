import type { TaskStatus } from '@/modules/task/state-machine'

/**
 * modules/lateness/blocked.ts — when the worker's clock was suspended.
 *
 * SPEC §5.3, as amended: **a BLOCKED task does not accrue lateness while it is
 * blocked.** The operator's decision, recorded in docs/DECISIONS.md (Phase 6)
 * where the question had been raised.
 *
 * ── Why intervals, and not `status === 'BLOCKED'` ─────────────────────────
 *
 * The naive reading — "skip the task while it is currently blocked" — is wrong
 * in both directions, and both are ordinary days at an organization:
 *
 *  - A task blocked for a week and then **resumed** is no longer BLOCKED, so
 *    the naive rule charges the منفّذ for the week they could not work. The
 *    suspension has to survive the unblock.
 *  - A task blocked *today*, three weeks overdue, is currently BLOCKED, so the
 *    naive rule would forgive all three weeks. Only the blocked stretch is
 *    excused, not the lateness that preceded it.
 *
 * So the unit is the **interval**, recovered from `TaskActivity` — the same
 * feed SPEC §5.1 already makes load-bearing for `BLOCKED → previous`. There is
 * no `blockedMinutes` column to drift out of sync with it, for the reason the
 * state machine gives for having no `statusBeforeBlock` column: a second copy
 * of a fact is a second thing that can be wrong.
 */

export interface BlockedInterval {
  start: Date
  /** Null while the task is still blocked — the interval has no end yet. */
  end: Date | null
  /**
   * The status the task was blocked *out of*. Null when the feed does not say.
   * Read by `effectiveStatus` so that a task blocked while SUBMITTED is still
   * treated as delivered: review time is not the worker's, and a manager
   * blocking a task under review must not restart their clock.
   */
  from: TaskStatus | null
}

/** The shape of a `TaskActivity` row this module reads. */
export interface StatusChangeRow {
  from: string | null
  to: string | null
  createdAt: Date
}

/** Half-open `[start, end)`, with `end` still unknown while blocked. */
export interface OpenInterval {
  start: Date
  end: Date | null
}

/** Closed and clipped — what the calendar is actually asked about. */
export interface ClosedInterval {
  start: Date
  end: Date
}

/**
 * Pair up `→ BLOCKED` and `BLOCKED →` rows into intervals.
 *
 * Rows are expected in chronological order (the query asks for
 * `[createdAt asc, id asc]`, the tiebreak Phase 4 added because a frozen clock
 * in a test produces two rows at the same instant). The sort here is stable and
 * on `createdAt` alone, so a caller's ordering wins for ties rather than being
 * shuffled.
 *
 * Two malformed shapes are possible in principle and neither is guessed at:
 *
 *  - **An entry with no exit** is the normal "still blocked" case → `end: null`.
 *  - **An exit with no entry** means the feed does not reach back far enough to
 *    say when the block began. Excluding from an unknown start would be
 *    inventing an excuse, so the row is ignored and the time counts. Erring
 *    toward *charging* is the safe direction here: a deduction that is too high
 *    gets disputed and reversed, one that is too low is never noticed.
 */
export function blockedIntervalsFromActivity(
  rows: readonly StatusChangeRow[],
): BlockedInterval[] {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const intervals: BlockedInterval[] = []
  let open: { start: Date; from: TaskStatus | null } | null = null

  for (const row of ordered) {
    if (row.to === 'BLOCKED') {
      // `BLOCKED → BLOCKED` is not a legal transition, so a second entry while
      // one is open is corruption rather than nesting. The first wins.
      open ??= { start: row.createdAt, from: (row.from as TaskStatus | null) ?? null }
      continue
    }
    if (row.from === 'BLOCKED' && open !== null) {
      intervals.push({ start: open.start, end: row.createdAt, from: open.from })
      open = null
    }
  }

  if (open !== null) intervals.push({ start: open.start, end: null, from: open.from })

  return intervals
}

/**
 * Overlapping or touching intervals collapse into one, so that a day inside two
 * of them is never subtracted twice.
 *
 * Reachable in practice: the state machine cannot nest blocks, but a data
 * import or a hand-repaired feed can, and the arithmetic downstream is a
 * subtraction from the total. Double-subtracting would forgive a day the منفّذ
 * was never excused.
 */
export function mergeBlockedIntervals(
  intervals: readonly BlockedInterval[],
): OpenInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime())
  const merged: OpenInterval[] = []

  for (const next of sorted) {
    const last = merged[merged.length - 1]

    if (!last) {
      merged.push({ start: next.start, end: next.end })
      continue
    }
    // An open-ended interval runs to the end of time and swallows the rest.
    if (last.end === null) continue

    if (next.start.getTime() <= last.end.getTime()) {
      last.end =
        next.end === null
          ? null
          : new Date(Math.max(last.end.getTime(), next.end.getTime()))
    } else {
      merged.push({ start: next.start, end: next.end })
    }
  }

  return merged
}

/**
 * Cut the merged intervals down to the window actually being measured.
 *
 * An open interval ends at `to`: "still blocked" means blocked right up to the
 * moment of measurement, and never past it. Empty slices are dropped so the
 * calendar is never asked about a zero-width range.
 */
export function clipBlockedIntervals(
  merged: readonly OpenInterval[],
  from: Date,
  to: Date,
): ClosedInterval[] {
  const clipped: ClosedInterval[] = []

  for (const interval of merged) {
    const start = Math.max(interval.start.getTime(), from.getTime())
    const end = Math.min(interval.end?.getTime() ?? to.getTime(), to.getTime())
    if (end > start) clipped.push({ start: new Date(start), end: new Date(end) })
  }

  return clipped
}

/**
 * The intervals a measurement window actually has to exclude — merged, clipped
 * and ready for the calendar. One function so that no caller can do half of it.
 */
export function blockedIntervalsIn(
  intervals: readonly BlockedInterval[],
  from: Date,
  to: Date,
): ClosedInterval[] {
  if (to.getTime() <= from.getTime()) return []
  return clipBlockedIntervals(mergeBlockedIntervals(intervals), from, to)
}
