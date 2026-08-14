/**
 * lib/auth/username — the login identifier.
 *
 * SPEC §2: username + password, **no email anywhere**. So the username is the
 * only handle a person has, and two of them differing by a trailing space or a
 * capital letter would be a support incident, not a feature. Normalisation is
 * applied identically on create, on edit, on login, and on the throttle key —
 * anything less and an account could be created that its owner cannot log into.
 */

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 32

/**
 * Latin lowercase, digits, and `.` `_` `-` between them — never at either end.
 *
 * Arabic is the UI language, but the username is an identifier, not a display
 * name: it appears in audit rows, in `wa.me` support messages and in log lines,
 * where a bidi-reordered Arabic identifier is unreadable and ambiguous. The
 * person's Arabic name lives in `fullName`, which is what the UI actually shows.
 */
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

/** Lowercase and trim. Idempotent — normalising twice is normalising once. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Returns i18n keys, not prose. `lib/` never renders Arabic. */
export function validateUsername(raw: string): string[] {
  const username = normalizeUsername(raw)
  const problems: string[] = []

  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    problems.push('validation.usernameLength')
  }
  if (!USERNAME_RE.test(username)) {
    problems.push('validation.usernameFormat')
  }

  return problems
}

export function isValidUsername(raw: string): boolean {
  return validateUsername(raw).length === 0
}
