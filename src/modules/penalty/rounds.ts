import type { Prisma } from '@prisma/client'

/**
 * modules/penalty/rounds — which delivery a penalty belongs to (SPEC T4).
 *
 *   > Penalty already accrued on the original delivery stands and is frozen.
 *   > The revision then accrues against the new due date.
 *
 * ── The apparent contradiction, and how it resolves ───────────────────────
 *
 * SPEC §5.4 says "exactly one **active** auto `PENALTY` entry per task", and
 * SPEC T4 says a revision leaves the previous delivery's penalty standing. Read
 * carelessly those two sentences disagree — a revised task would carry two
 * unreversed automatic penalties.
 *
 * They agree once *active* is read as what it says: **still subject to
 * recalculation**. Not "not yet reversed". The moment a revision is requested,
 * the previous delivery's penalty can never change again — the deadline it was
 * measured against is gone, and SPEC T4 says it stands — so it stops being
 * active. Exactly one entry is active at any instant: the current round's.
 *
 * ── Why the feed and not a column ─────────────────────────────────────────
 *
 * SPEC §2 says there is "no round counting" as a product feature, and SPEC §4
 * gives `LedgerEntry` no metadata column to stamp one on. `TaskActivity`
 * already records every status change with its `from` and `to`, and SPEC §5.1
 * (`BLOCKED → previous`) and SPEC §5.3 (the blocked intervals lateness
 * subtracts) have both already made that feed load-bearing rather than
 * decorative. This is a third reader of a fact already recorded, not a fourth
 * place a task's history is stored — and so it cannot disagree with the other
 * two.
 */

/** A `TaskActivity` row, narrowed to what a round boundary needs. */
export interface RevisionActivityRow {
  type: string
  from: string | null
  to: string | null
  createdAt: Date
}

export interface RevisionRounds {
  /**
   * The instant each revision was requested, ascending. Length is the revision
   * count; an empty array means the task is still on its original delivery.
   */
  boundaries: readonly Date[]
}

/**
 * The activity rows a round reader needs. Exported so the job, the service and
 * the breakdown all select the same shape rather than three that drift.
 *
 * Ordered `[createdAt, id]` — the tiebreak Phase 4 added because a frozen clock
 * in a test writes two rows at the same instant.
 */
export const REVISION_ACTIVITY_SELECT = {
  where: { type: 'STATUS_CHANGED', to: 'REVISION_REQUESTED' },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  select: { type: true, from: true, to: true, createdAt: true },
  // `satisfies`, not `as const`: the nested `where`/`orderBy` need Prisma's own
  // contextual types to narrow `'asc'` to `SortOrder`.
} satisfies Prisma.Task$activityArgs

export function revisionRoundsFromActivity(
  rows: readonly RevisionActivityRow[],
): RevisionRounds {
  const boundaries = rows
    .filter((r) => r.type === 'STATUS_CHANGED' && r.to === 'REVISION_REQUESTED')
    .map((r) => r.createdAt)
    // Sorted here rather than trusted from the caller. The select above already
    // orders, but this function is also handed hand-built fixtures and an
    // in-memory feed, and a mis-ordered boundary list would freeze the wrong
    // penalty — silently, and in the direction that costs somebody money.
    .sort((a, b) => a.getTime() - b.getTime())

  return { boundaries }
}

export function revisionCount(rounds: RevisionRounds): number {
  return rounds.boundaries.length
}

/** When the live round began, or null while the task is on its first delivery. */
export function currentRoundStart(rounds: RevisionRounds): Date | null {
  return rounds.boundaries.at(-1) ?? null
}

/**
 * Which delivery an instant belongs to. `0` is the original delivery, `n` the
 * n-th revision — which is exactly the label SPEC T4's "separately labelled"
 * asks the breakdown panel for.
 */
export function roundIndexAt(at: Date, rounds: RevisionRounds): number {
  return rounds.boundaries.filter((b) => b.getTime() <= at.getTime()).length
}

/**
 * True when an entry written at `at` may still be recalculated.
 *
 * `>=`, and the inclusive edge is required rather than a tie-break:
 * `transitionTask` writes the `REVISION_REQUESTED` activity row and calls the
 * penalty recomputation with the *same* `now`. Under a strict `>` that
 * recomputation would still belong to the previous round and would reverse the
 * penalty SPEC T4 says must stand.
 */
export function isInCurrentRound(at: Date, rounds: RevisionRounds): boolean {
  const start = currentRoundStart(rounds)
  return start === null || at.getTime() >= start.getTime()
}
