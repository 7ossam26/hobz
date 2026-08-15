import { recordAudit } from '@/lib/audit'
import {
  burnPasswordTime,
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
  type PasswordPolicy,
} from '@/lib/auth/password'
import {
  retryAfterMinutes,
  throttleKeys,
  type LoginThrottle,
} from '@/lib/auth/rate-limit'
import { normalizeUsername } from '@/lib/auth/username'
import type { Db } from '@/lib/db'
import { DomainError } from '@/lib/errors'

/**
 * modules/auth/service — credential verification.
 *
 * Called by the Auth.js Credentials provider and by the integration tests, with
 * no Next.js in between either time. Everything it needs is a parameter.
 *
 * ── Why this returns instead of throwing ───────────────────────────────────
 *
 * A wrong password is not an exceptional condition; it is the single most
 * common outcome this function has. Callers need to branch on *which* failure
 * it was — the login form shows a different Arabic message for a lockout than
 * for a bad password — and a discriminated result makes that a compile-time
 * exhaustive switch instead of `instanceof` archaeology.
 */

export type AuthenticateResult =
  | { ok: true; userId: string; username: string }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'INACTIVE' }
  | { ok: false; reason: 'THROTTLED'; retryAfterMinutes: number }

/** Derived, so the login form's message map can never drift from the service. */
export type AuthFailureReason = Extract<AuthenticateResult, { ok: false }>['reason']

export interface AuthenticateArgs {
  username: string
  password: string
  ip?: string | undefined
  throttle: LoginThrottle
  now?: Date
}

/**
 * Verify a username/password pair, honouring the throttle and auditing the
 * outcome either way.
 *
 * The order of the checks is load-bearing:
 *
 *  1. **Throttle first.** A locked key must not reach bcrypt at all, or the
 *     lockout still costs the server 250 ms of CPU per attempt and becomes its
 *     own denial-of-service vector.
 *  2. **Password before status.** "This account is disabled" is only told to
 *     someone who has already proved they know the password. Reversing these
 *     two turns the login form into a directory of deactivated staff.
 *  3. **A missing user still pays for a bcrypt comparison** (`burnPasswordTime`),
 *     so response time cannot be used to enumerate usernames.
 */
export async function authenticate(
  db: Db,
  args: AuthenticateArgs,
): Promise<AuthenticateResult> {
  const now = args.now ?? new Date()
  const username = normalizeUsername(args.username)
  const keys = throttleKeys(username, args.ip)

  const gate = await args.throttle.check(keys, now)
  if (!gate.allowed) {
    await recordAudit(db, {
      actor: null,
      action: 'auth.throttled',
      entity: 'Auth',
      entityId: username,
      ...(args.ip ? { ip: args.ip } : {}),
    })
    return {
      ok: false,
      reason: 'THROTTLED',
      retryAfterMinutes: retryAfterMinutes(gate.retryAfterMs),
    }
  }

  const user = await db.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      isActive: true,
      deletedAt: true,
    },
  })

  const usable = user && user.deletedAt === null ? user : null

  if (!usable) {
    await burnPasswordTime()
    return failLogin(db, args, keys, username, now)
  }

  const correct = await verifyPassword(args.password, usable.passwordHash)
  if (!correct) {
    return failLogin(db, args, keys, username, now)
  }

  if (!usable.isActive) {
    // Not a throttle failure: the credentials were right. Counting it would
    // lock out an account whose owner is doing nothing wrong.
    await recordAudit(db, {
      actor: null,
      action: 'auth.signInFailed',
      entity: 'Auth',
      entityId: username,
      after: { reason: 'INACTIVE' },
      ...(args.ip ? { ip: args.ip } : {}),
    })
    return { ok: false, reason: 'INACTIVE' }
  }

  await args.throttle.registerSuccess(keys)

  // The one moment the plaintext exists and an old hash can be upgraded.
  if (needsRehash(usable.passwordHash)) {
    await db.user.update({
      where: { id: usable.id },
      data: { passwordHash: await hashPassword(args.password) },
    })
  }

  await recordAudit(db, {
    actor: { id: usable.id },
    action: 'auth.signedIn',
    entity: 'User',
    entityId: usable.id,
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return { ok: true, userId: usable.id, username: usable.username }
}

async function failLogin(
  db: Db,
  args: AuthenticateArgs,
  keys: string[],
  username: string,
  now: Date,
): Promise<AuthenticateResult> {
  const after = await args.throttle.registerFailure(keys, now)

  await recordAudit(db, {
    actor: null,
    action: 'auth.signInFailed',
    entity: 'Auth',
    entityId: username,
    after: { remainingAttempts: after.remainingAttempts },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  if (!after.allowed) {
    return {
      ok: false,
      reason: 'THROTTLED',
      retryAfterMinutes: retryAfterMinutes(after.retryAfterMs),
    }
  }
  return { ok: false, reason: 'INVALID_CREDENTIALS' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Changing your own password
// ─────────────────────────────────────────────────────────────────────────────

export interface ChangeOwnPasswordArgs {
  userId: string
  currentPassword: string
  newPassword: string
  policy: PasswordPolicy
  ip?: string | undefined
}

/**
 * The only path by which a user changes their own password.
 *
 * There is no reset-by-email and no reset-by-user (SPEC §2, CLAUDE.md invariant
 * 9). A forgotten password is an admin action; this function exists for the
 * case where the user knows the current one — including the forced change after
 * an admin reset, which is why it also clears `mustChangePassword`.
 */
export async function changeOwnPassword(
  db: Db,
  args: ChangeOwnPasswordArgs,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: args.userId },
    select: { id: true, username: true, passwordHash: true, deletedAt: true },
  })
  if (!user || user.deletedAt !== null) throw new DomainError('errors.notFound')

  if (!(await verifyPassword(args.currentPassword, user.passwordHash))) {
    throw new DomainError('auth.invalidCredentials')
  }

  const problems = validatePassword(args.newPassword, args.policy, {
    username: user.username,
  })
  if (problems.length > 0) {
    throw new DomainError(problems[0] ?? 'errors.validation', {
      minLength: args.policy.minLength,
    })
  }

  if (await verifyPassword(args.newPassword, user.passwordHash)) {
    throw new DomainError('auth.passwordSameAsOld')
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(args.newPassword),
      mustChangePassword: false,
    },
  })

  await recordAudit(db, {
    actor: { id: user.id },
    action: 'auth.passwordChanged',
    entity: 'User',
    entityId: user.id,
    // Deliberately no payload. The interesting fact is that it happened and
    // when; the values are the one thing that must never reach this table.
    ...(args.ip ? { ip: args.ip } : {}),
  })
}
