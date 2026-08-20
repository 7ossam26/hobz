import type { Calendar } from '@/lib/calendar'

/**
 * modules/task/elapsed.ts — SPEC §5.2.
 *
 * ```
 * elapsedMinutesRaw     = submittedAt − assignedAt          (wall clock)
 * elapsedMinutesWorking = the same span, excluding weekends,
 *                         holidays and the assignee's approved leave
 * ```
 *
 * The working half is `lib/calendar`'s answer, never this file's: CLAUDE.md
 * invariant 5 forbids business-day maths anywhere else, and Phase 6 owns the
 * implementation. What lives here is the raw arithmetic, the null handling, and
 * the two bounds below.
 *
 * ── Why the raw side may subtract two Dates ───────────────────────────────
 *
 * Invariant 5 is about *lateness* and *working* elapsed time — the numbers that
 * feed a deduction. `elapsedMinutesRaw` is defined by the SPEC as wall clock,
 * explicitly in contrast to the working figure beside it. Routing it through
 * the calendar would not make it more correct; it would make it a different
 * number with the same name.
 */

const MINUTE_MS = 60_000

/** Whole minutes in [from, to). Truncates: 119s of work is 1 minute, not 2. */
export function minutesBetween(from: Date, to: Date): number {
  const span = to.getTime() - from.getTime()
  return span <= 0 ? 0 : Math.floor(span / MINUTE_MS)
}

export interface ElapsedInput {
  assignedAt: Date | null
  submittedAt: Date | null
  /** Narrows the calendar by this user's approved leave. Null = Organization calendar. */
  assigneeId: string | null
}

export interface ElapsedResult {
  raw: number
  working: number
}

const NOT_STARTED: ElapsedResult = { raw: 0, working: 0 }

/**
 * Both denormalised columns for one task.
 *
 * Returns zeroes — rather than nulls — for a task that has not completed an
 * assign→submit span, matching the non-null `Int @default(0)` columns. "No
 * elapsed time yet" and "zero elapsed time" are the same statement here: a
 * task that was never submitted has accrued nothing.
 *
 * `working` is clamped into `[0, raw]`. Working time is by definition a subset
 * of the wall-clock span, so `raw` is its arithmetic maximum and a negative
 * result is meaningless; clamping to a provably-correct bound is not the same
 * as swallowing a wrong answer, and it keeps one bad calendar reading from
 * silently inflating an estimate-accuracy score (SPEC §5.6).
 */
export async function computeElapsed(
  calendar: Calendar,
  input: ElapsedInput,
): Promise<ElapsedResult> {
  const { assignedAt, submittedAt, assigneeId } = input
  if (!assignedAt || !submittedAt) return NOT_STARTED

  const raw = minutesBetween(assignedAt, submittedAt)
  // An inverted or empty span never reaches the calendar: its contract is a
  // half-open [from, to), and asking it about a backwards range is undefined.
  if (raw === 0) return NOT_STARTED

  const reported = await calendar.workingMinutesBetween(
    assignedAt,
    submittedAt,
    assigneeId ?? undefined,
  )

  const working = Math.min(Math.max(Math.floor(reported), 0), raw)

  return { raw, working }
}
