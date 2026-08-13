/**
 * tests/setup/db-guard.ts — CLAUDE.md invariant 10, docs/TESTING.md §2.
 *
 * Loaded as the FIRST setup file of the integration project, so it runs before
 * any Prisma client is constructed. Also exported as a pure function so it can
 * be unit-tested on its own.
 *
 * This file is the reason a mistyped `DATABASE_URL` cannot truncate production.
 * Treat it as load-bearing.
 */

export interface GuardEnv {
  DATABASE_URL?: string | undefined
  NODE_ENV?: string | undefined
}

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(`REFUSING TO RUN: ${message}`)
    this.name = 'UnsafeTestDatabaseError'
  }
}

/** Extract the database name from a Postgres URL, tolerating query strings. */
export function databaseNameFromUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new UnsafeTestDatabaseError(`DATABASE_URL is not a valid URL: "${url}"`)
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!name) {
    throw new UnsafeTestDatabaseError(`DATABASE_URL has no database name: "${url}"`)
  }
  return name
}

/**
 * Point the run at the test database.
 *
 * `.env` defines both `DATABASE_URL` (dev) and `TEST_DATABASE_URL`. Prisma only
 * ever reads `DATABASE_URL`, so without this promotion a developer running
 * `pnpm test:integration` would silently migrate and truncate their *dev*
 * database — which is exactly the accident the suffix check below exists to
 * prevent, arriving one step earlier.
 *
 * Promotion happens first; the suffix check then applies to the promoted value,
 * so a mistyped `TEST_DATABASE_URL` is still caught.
 */
export function promoteTestDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.TEST_DATABASE_URL) {
    env.DATABASE_URL = env.TEST_DATABASE_URL
  }
}

export function assertTestDatabase(env: GuardEnv = process.env): string {
  if (env.NODE_ENV === 'production') {
    throw new UnsafeTestDatabaseError('NODE_ENV is "production"')
  }

  const url = env.DATABASE_URL ?? ''
  if (!url) {
    throw new UnsafeTestDatabaseError('DATABASE_URL is not set')
  }

  const dbName = databaseNameFromUrl(url)
  if (!dbName.endsWith('_test')) {
    throw new UnsafeTestDatabaseError(`test DB must end in _test, got "${dbName}"`)
  }

  return dbName
}

// Side effects on import — this is what makes it usable as a Vitest setupFile,
// and what guarantees the check runs before any Prisma client is constructed.
promoteTestDatabaseUrl()
assertTestDatabase()
