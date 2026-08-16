import type { Db } from '@/lib/db'

/**
 * lib/advisory-lock — Postgres advisory locks, with no scheduler attached.
 *
 * Extracted from `lib/scheduler` in Phase 8. The hash and the two lock helpers
 * were always independent of cron; what made them awkward was the module they
 * lived in, which imports `node-cron` and therefore drags `path` and
 * `child_process` into anything that touches it. The money path now needs a
 * lock — `modules/payout/cycle` when opening a cycle, `modules/penalty/service`
 * per task — and neither should have to pull a scheduler in to get one.
 *
 * `lib/scheduler` re-exports `advisoryLockKey`, so every existing caller and
 * every existing test is unaffected.
 *
 * **Transaction-scoped, always.** Prisma pools connections, so a session-level
 * lock could be taken on one connection and released on another. A
 * `_xact_` lock is pinned to its transaction and released on commit, rollback
 * or process death — nothing has to remember to unlock, and a crash cannot
 * leave a row permanently unwritable.
 *
 * It follows that these only protect callers who are **inside a transaction**.
 * On the base client each statement is its own implicit transaction, so the
 * lock is acquired and released immediately: harmless, and useless. Every
 * production caller opens a transaction, because every money write is paired
 * with an audit row that must commit with it (CLAUDE.md invariant 7).
 */

/**
 * Map a name to a stable 64-bit advisory-lock key (FNV-1a).
 *
 * Stable across processes and deploys — that is the whole requirement.
 * Exported so a test can assert two names do not collide.
 */
export function advisoryLockKey(name: string): bigint {
  const FNV_OFFSET = 0xcbf29ce484222325n
  const FNV_PRIME = 0x100000001b3n
  const MASK = 0xffffffffffffffffn

  let hash = FNV_OFFSET
  for (const byte of Buffer.from(name, 'utf8')) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK
  }
  // Postgres advisory keys are signed bigint; fold into the signed range.
  return hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash
}

/**
 * Take the lock, or report that somebody else holds it.
 *
 * For work where a second worker would compute the same answer, so being told
 * "somebody is already doing this" is a correct outcome rather than an error —
 * a penalty recomputation, a scheduled job.
 */
export async function tryAdvisoryXactLock(db: Db, name: string): Promise<boolean> {
  const key = advisoryLockKey(name)
  const rows = await db.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked
  `
  return rows[0]?.locked === true
}

/**
 * Wait for the lock.
 *
 * For work where the loser must not give up but must see the winner's result —
 * opening the single OPEN payout cycle, where "somebody else is creating it"
 * means "wait, then use theirs". The wait is bounded by the work under the
 * lock, which in that case is one INSERT.
 */
export async function advisoryXactLock(db: Db, name: string): Promise<void> {
  const key = advisoryLockKey(name)
  await db.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text AS locked`
}
