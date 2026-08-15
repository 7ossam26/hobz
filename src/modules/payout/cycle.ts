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
    // `payout_cycles_single_open` — another writer opened it first. That is the
    // correct outcome, not an error: re-read and use theirs.
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
