import type { Db } from '@/lib/db'

/**
 * lib/auth/rate-limit — login throttling, in two layers.
 *
 *   in-memory  fast, per-process, lost on restart
 *   database   durable, shared across instances, survives a redeploy
 *
 * Both are written on every failure and both are consulted on every check; the
 * strictest verdict wins. The reason for keeping both is the failure mode of
 * each: an in-memory-only limiter is reset by `docker restart`, which an
 * attacker can often provoke, and a database-only limiter adds a write to every
 * single login attempt including the successful ones.
 *
 * ── Shape of this module ───────────────────────────────────────────────────
 *
 * The decision logic (`evaluate`, `applyFailure`) is pure: state in, state out,
 * clock injected. It is unit-tested exhaustively at boundaries — one attempt
 * under the limit, exactly at it, one millisecond before the lock expires —
 * without a database or a timer. The storage layers are thin adapters behind
 * `ThrottleStore` and carry no policy.
 */

export interface ThrottlePolicy {
  /** Failures inside the window before the key locks. */
  maxAttempts: number
  /** Failures older than this stop counting — sliding, not fixed. */
  windowMs: number
  /** How long a locked key stays locked. */
  lockoutMs: number
}

export interface ThrottleState {
  failures: number
  firstFailureAt: Date
  lastFailureAt: Date
  lockedUntil: Date | null
}

export interface ThrottleDecision {
  allowed: boolean
  /** 0 when allowed. Rendered to the user as whole minutes. */
  retryAfterMs: number
  /** Attempts left before the lock engages. 0 once locked. */
  remainingAttempts: number
}

export interface ThrottleStore {
  read(key: string): Promise<ThrottleState | null>
  write(key: string, state: ThrottleState): Promise<void>
  clear(key: string): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure decision logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this key currently allowed to attempt a login?
 *
 * A lock that has expired is simply not a lock — `evaluate` does not mutate, so
 * expiry needs no cleanup pass and a stale row is harmless.
 */
export function evaluate(
  state: ThrottleState | null,
  now: Date,
  policy: ThrottlePolicy,
): ThrottleDecision {
  if (!state) {
    return { allowed: true, retryAfterMs: 0, remainingAttempts: policy.maxAttempts }
  }

  if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) {
    return {
      allowed: false,
      retryAfterMs: state.lockedUntil.getTime() - now.getTime(),
      remainingAttempts: 0,
    }
  }

  const failures = countableFailures(state, now, policy)
  return {
    allowed: true,
    retryAfterMs: 0,
    remainingAttempts: Math.max(0, policy.maxAttempts - failures),
  }
}

/**
 * Failures that still count against this key.
 *
 * Two ways the count reaches zero:
 *
 *  - **The window slid past them.** Measured from the *last* failure, not the
 *    first: measuring from the first would let a patient attacker reset the
 *    counter by pausing, because the whole run ages out together however many
 *    attempts it contains.
 *
 *  - **A lockout was served.** Once `lockedUntil` is in the past the penalty is
 *    finished, so the user starts again with a full allowance. Carrying the old
 *    count across an expired lock would mean a single typo immediately re-locks
 *    the account for another full period — punishing the locked-out legitimate
 *    user, who is the only person the expiry exists for.
 */
function countableFailures(
  state: ThrottleState,
  now: Date,
  policy: ThrottlePolicy,
): number {
  if (state.lockedUntil && state.lockedUntil.getTime() <= now.getTime()) return 0
  const age = now.getTime() - state.lastFailureAt.getTime()
  return age > policy.windowMs ? 0 : state.failures
}

/**
 * Fold one failed attempt into the state. Locks the key once the count reaches
 * the limit; the lock is set, not extended, so a locked key that keeps being
 * hammered does not accumulate an unbounded lockout.
 */
export function applyFailure(
  current: ThrottleState | null,
  now: Date,
  policy: ThrottlePolicy,
): ThrottleState {
  const carried = current ? countableFailures(current, now, policy) : 0
  const failures = carried + 1
  const locked = failures >= policy.maxAttempts

  return {
    failures,
    firstFailureAt: carried > 0 && current ? current.firstFailureAt : now,
    lastFailureAt: now,
    lockedUntil: locked ? new Date(now.getTime() + policy.lockoutMs) : null,
  }
}

/** Whole minutes, rounded up — what the Arabic message actually shows. */
export function retryAfterMinutes(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 60_000))
}

/**
 * The keys one attempt is throttled under.
 *
 * Both, always. Keying on the username alone lets one attacker lock every
 * account out of the product — a denial of service dressed as a security
 * control. Keying on IP alone lets a botnet spread a credential-stuffing run
 * thin enough to never trip.
 */
export function throttleKeys(username: string, ip?: string | null): string[] {
  const keys = [`user:${username}`]
  if (ip) keys.push(`ip:${ip}`)
  return keys
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage layers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-process store. `maxKeys` bounds it: an attacker rotating usernames must
 * not be able to grow this map until the container runs out of memory. Eviction
 * is oldest-first and is safe — the database layer still holds the real count.
 */
export function createMemoryThrottleStore(maxKeys = 10_000): ThrottleStore {
  const map = new Map<string, ThrottleState>()

  return {
    async read(key) {
      return map.get(key) ?? null
    },
    async write(key, state) {
      // Re-insert so the Map's insertion order doubles as an LRU queue.
      map.delete(key)
      map.set(key, state)
      while (map.size > maxKeys) {
        const oldest = map.keys().next()
        if (oldest.done) break
        map.delete(oldest.value)
      }
    },
    async clear(key) {
      map.delete(key)
    },
  }
}

/** Shared across every request in this process. */
export const memoryThrottleStore: ThrottleStore = createMemoryThrottleStore()

/**
 * The durable layer, backed by `login_throttles`.
 *
 * Typed against the real Prisma delegate rather than a hand-written port: a
 * port would happily keep compiling after the column names in `schema.prisma`
 * changed underneath it, and a silently broken rate limiter is worse than none.
 * Unit tests pass a fake and cast, the same way the audit tests do.
 */
export type ThrottleRecordDb = Pick<Db, 'loginThrottle'>

export function createDbThrottleStore(db: ThrottleRecordDb): ThrottleStore {
  return {
    async read(key) {
      const row = await db.loginThrottle.findUnique({ where: { key } })
      if (!row) return null
      return {
        failures: row.failures,
        firstFailureAt: row.firstFailureAt,
        lastFailureAt: row.lastFailureAt,
        lockedUntil: row.lockedUntil,
      }
    },
    async write(key, state) {
      await db.loginThrottle.upsert({
        where: { key },
        create: { key, ...state },
        update: state,
      })
    },
    async clear(key) {
      // deleteMany, not delete: clearing a key that was never written is the
      // normal case (every first successful login), not an error.
      await db.loginThrottle.deleteMany({ where: { key } })
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The limiter
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginThrottle {
  check(keys: readonly string[], now?: Date): Promise<ThrottleDecision>
  registerFailure(keys: readonly string[], now?: Date): Promise<ThrottleDecision>
  registerSuccess(keys: readonly string[]): Promise<void>
}

export interface LoginThrottleOptions {
  stores: readonly ThrottleStore[]
  /** Async because the policy comes from Settings, which is DB-backed. */
  policy: () => Promise<ThrottlePolicy>
}

/**
 * The strictest verdict across layers and keys wins: any denial beats every
 * allowance, and among denials the longest wait is the one reported.
 */
function strictest(
  decisions: readonly ThrottleDecision[],
  policy: ThrottlePolicy,
): ThrottleDecision {
  return decisions.reduce<ThrottleDecision>(
    (worst, d) => {
      if (!d.allowed && (worst.allowed || d.retryAfterMs > worst.retryAfterMs)) return d
      if (worst.allowed && d.allowed && d.remainingAttempts < worst.remainingAttempts) {
        return d
      }
      return worst
    },
    { allowed: true, retryAfterMs: 0, remainingAttempts: policy.maxAttempts },
  )
}

export function createLoginThrottle(options: LoginThrottleOptions): LoginThrottle {
  const { stores } = options

  return {
    async check(keys, now = new Date()) {
      const policy = await options.policy()
      const decisions: ThrottleDecision[] = []
      for (const store of stores) {
        for (const key of keys) {
          decisions.push(evaluate(await store.read(key), now, policy))
        }
      }
      return strictest(decisions, policy)
    },

    async registerFailure(keys, now = new Date()) {
      const policy = await options.policy()
      const decisions: ThrottleDecision[] = []
      for (const store of stores) {
        for (const key of keys) {
          const next = applyFailure(await store.read(key), now, policy)
          await store.write(key, next)
          decisions.push(evaluate(next, now, policy))
        }
      }
      return strictest(decisions, policy)
    },

    async registerSuccess(keys) {
      for (const store of stores) {
        for (const key of keys) {
          await store.clear(key)
        }
      }
    },
  }
}
