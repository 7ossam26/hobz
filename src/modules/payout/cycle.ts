import { advisoryXactLock } from '@/lib/advisory-lock'
import type { Db } from '@/lib/db'

import { cycleEndAfter } from './period'

/**
 * modules/payout/cycle — "which cycle is open right now".
 *
 * Deliberately its own file rather than part of `service.ts`: the ledger has to
 * ask this question on every write, and `service.ts` writes ledger entries. One
 * of the two directions has to be the thin one, and it is this — nothing here
 * imports `modules/ledger`, so there is no cycle between the two modules and no
 * port abstraction invented to pretend there isn't.
 */

/**
 * One name for the whole table, because the fact being protected is agency-wide:
 * there is at most one OPEN cycle, ever (`payout_cycles_single_open`).
 */
const OPEN_CYCLE_LOCK = 'payout.ensureOpenCycle'

export const CYCLE_SELECT = {
  id: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  closedAt: true,
} as const

export interface CycleRow {
  id: string
  periodStart: Date
  periodEnd: Date
  status: string
  closedAt: Date | null
}

/**
 * `created` distinguishes "the cycle that was already running" from "the cycle
 * this very call had to invent". `closeCycle` needs the difference: a cycle
 * that existed has a `periodEnd` worth respecting, and one conjured a
 * microsecond ago does not.
 */
export interface EnsuredCycle extends CycleRow {
  created: boolean
}

export async function currentOpenCycle(db: Db): Promise<CycleRow | null> {
  return db.payoutCycle.findFirst({
    where: { status: 'OPEN' },
    orderBy: { periodStart: 'desc' },
    select: CYCLE_SELECT,
  })
}

export async function latestCycle(db: Db): Promise<CycleRow | null> {
  return db.payoutCycle.findFirst({
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    select: CYCLE_SELECT,
  })
}

const laterOf = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b)

export interface EnsureOpenCycleArgs {
  now: Date
  /** Settings `payout.cycleDay`. Injected — never read from here. */
  cycleDay: number
}

/**
 * The open cycle, opening one if there is none.
 *
 * Cycles are contiguous: a new one starts exactly where the previous one ended,
 * so every instant belongs to exactly one cycle and no ledger entry can fall
 * between two of them.
 *
 * **The very first cycle reaches backwards.** Its `periodStart` is the oldest
 * ledger entry rather than `now`, because the alternative is a cycle that
 * begins after money it is about to pay out already moved. In a fresh
 * installation there are no entries and it is simply `now`.
 *
 * The end always comes from `now`, never from `periodStart`: a cycle opened
 * against a months-old first entry must still close on the next cycle day, not
 * on one that has already gone by.
 */
export async function ensureOpenCycle(
  db: Db,
  args: EnsureOpenCycleArgs,
): Promise<EnsuredCycle> {
  const open = await currentOpenCycle(db)
  if (open) return { ...open, created: false }

  /**
   * Serialise the open-a-cycle path (added in Phase 8).
   *
   * The `catch` below was the whole defence until now: let both writers try,
   * and let the loser re-read the winner's row. That works on the base client,
   * where each statement is its own transaction — and **cannot** work inside an
   * interactive one, because a unique violation aborts the whole transaction
   * and Postgres then refuses every subsequent command with `25P02`. The
   * recovery read is exactly such a command, so the loser died on the
   * re-read rather than recovering.
   *
   * Nothing exercised that until Phase 8: before it, ledger writes were
   * user-driven and arrived one at a time. The penalty engine writes money for
   * a منفّذ while a manager may be doing the same for another, each inside
   * their own transaction, and `tests/integration/penalty/concurrency.test.ts`
   * found it on the first try.
   *
   * A blocking lock, not `try`: the loser must not give up, it must wait and
   * then use the winner's cycle. The wait is one INSERT long. The key is the
   * *fact* being established — there is at most one open cycle in the whole
   * agency — so one name for the whole table is right.
   */
  await advisoryXactLock(db, OPEN_CYCLE_LOCK)

  // Re-read under the lock. The winner created it while this caller waited.
  const opened = await currentOpenCycle(db)
  if (opened) return { ...opened, created: false }

  const previous = await latestCycle(db)
  // The *fact*, not the plan: a cycle closed early on the 20th hands over at
  // the 20th, and one closed late on the 1st hands over at the 1st. Using the
  // planned end would leave the days between belonging to no cycle.
  const periodStart =
    previous?.closedAt ?? previous?.periodEnd ?? (await ledgerStart(db, args.now))
  const periodEnd = cycleEndAfter(laterOf(periodStart, args.now), args.cycleDay)

  try {
    const row = await db.payoutCycle.create({
      data: { periodStart, periodEnd, status: 'OPEN' },
      select: CYCLE_SELECT,
    })
    return { ...row, created: true }
  } catch (error) {
    /**
     * Kept as a backstop, and unreachable for callers inside a transaction —
     * the lock above is what stops them colliding now. It still earns its place
     * on the base client, where the lock is released the instant it is taken
     * and two callers genuinely can race the index. There, a unique violation
     * does not poison anything and re-reading is the correct recovery.
     *
     * `payout_cycles_single_open` — another writer opened it first. That is the
     * right outcome, not an error: use theirs.
     */
    const raced = await currentOpenCycle(db)
    if (raced) return { ...raced, created: false }
    throw error
  }
}

async function ledgerStart(db: Db, fallback: Date): Promise<Date> {
  const oldest = await db.ledgerEntry.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })
  if (!oldest) return fallback
  return oldest.createdAt.getTime() < fallback.getTime() ? oldest.createdAt : fallback
}
