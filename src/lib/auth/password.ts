import { randomBytes } from 'node:crypto'

import bcrypt from 'bcryptjs'

/**
 * lib/auth/password — bcrypt, cost 12 (SPEC §3).
 *
 * Cost 12 is roughly 250 ms per hash on the target VPS. That is the point: it
 * is the same 250 ms an attacker pays per guess, and with ~100 accounts and no
 * public signup, login latency is not a metric anybody optimises here.
 */

export const BCRYPT_COST = 12

/** `$2a$` and `$2b$` are the two prefixes bcryptjs produces and accepts. */
const BCRYPT_HASH_RE = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

/**
 * Never throws. A malformed or truncated hash in the database is a `false`,
 * not a 500 — an exception here would turn one corrupt row into a login page
 * that reports "unexpected error" and tells the operator nothing useful.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false
  try {
    return await bcrypt.compare(plain, hash)
  } catch {
    return false
  }
}

export function bcryptCostOf(hash: string): number | null {
  const match = BCRYPT_HASH_RE.exec(hash)
  if (!match?.[1]) return null
  return Number(match[1])
}

export function isBcryptHash(value: string): boolean {
  return BCRYPT_HASH_RE.test(value)
}

/**
 * True when a stored hash was produced at a weaker cost than the current
 * policy. Callers rehash transparently on the next successful login, which is
 * the only moment the plaintext is available.
 */
export function needsRehash(hash: string): boolean {
  const cost = bcryptCostOf(hash)
  return cost === null || cost < BCRYPT_COST
}

/**
 * A hash of a random value nobody holds, computed once per process.
 *
 * Verified against when the username does not exist, so a missing account costs
 * the same ~250 ms as a wrong password. Without it, the login form is a
 * username oracle: "instant rejection" means "no such user", and an internal
 * tool's user list is exactly what an attacker wants first.
 */
let decoyHash: string | null = null

async function getDecoyHash(): Promise<string> {
  decoyHash ??= await bcrypt.hash(randomBytes(24).toString('hex'), BCRYPT_COST)
  return decoyHash
}

/** Spend a verification's worth of time without revealing that nothing matched. */
export async function burnPasswordTime(): Promise<void> {
  await verifyPassword('not-the-password', await getDecoyHash())
}

export interface PasswordPolicy {
  minLength: number
}

/**
 * Length only, plus the one composition rule that is actually worth having:
 * the password must not contain the username.
 *
 * No symbol/digit/uppercase requirements. Those reliably produce `Password1!`
 * and a sticky note on the monitor, which is a worse outcome than a long
 * passphrase the operator remembers. The minimum comes from Settings
 * (CLAUDE.md invariant 4), never from a literal in this file.
 *
 * Returns i18n keys, not prose — `lib/` never renders Arabic.
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicy,
  context: { username?: string } = {},
): string[] {
  const problems: string[] = []

  if (password.length < policy.minLength) {
    problems.push('validation.passwordTooShort')
  }

  const username = context.username?.trim().toLowerCase()
  if (username && username.length >= 3 && password.toLowerCase().includes(username)) {
    problems.push('validation.passwordContainsUsername')
  }

  return problems
}
