import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

/**
 * `next dev` reads `.env` for you; Vitest does not. Without this the
 * integration project starts with no `TEST_DATABASE_URL`, and `db-guard`
 * correctly refuses to run — which looks like a broken harness rather than the
 * missing variable it is.
 *
 * `loadEnvFile` follows `--env-file` semantics: a variable already present in
 * the environment wins, so CI's real values are never clobbered by a developer
 * `.env` that happens to be checked out.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // No `.env` on this machine — CI supplies the variables directly.
}

/**
 * Two projects, per docs/TESTING.md §1.
 *
 *  unit        — no database, no network. Services are called with fakes.
 *  integration — real Postgres (`agency_test`), guarded by tests/setup/db-guard.
 *
 * `pnpm test` runs both. The integration project passes with no tests today:
 * Phase 0 ships no models with write paths beyond the settings example, and the
 * integration suite starts landing in Phase 1 with auth and RBAC.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: false,
    restoreMocks: true,
    // The integration project ships no tests until Phase 1; without this, a
    // plain `pnpm test` would fail on an empty project rather than on a real
    // problem. The coverage gate is what keeps the unit suite honest.
    passWithNoTests: true,
    projects: [
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          restoreMocks: true,
          // Component tests opt into jsdom per file with:
          //   // @vitest-environment jsdom
          setupFiles: ['tests/setup/unit.ts'],
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          restoreMocks: true,
          // db-guard MUST be first: it aborts before Prisma is constructed.
          setupFiles: ['tests/setup/db-guard.ts', 'tests/setup/integration.ts'],
          globalSetup: ['tests/setup/global-setup.ts'],
          // A shared Postgres database cannot be truncated by parallel workers:
          // one worker's TRUNCATE would delete another's fixtures mid-test.
          // A single fork serialises the whole integration project.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Scoped to code each phase actually implements. Widened in Phase 1 with
      // the auth, phone and navigation modules — see docs/DECISIONS.md. Files
      // that only exist to wire Next.js together (`config.ts`, `next-auth.ts`,
      // `throttle.ts`, `session.ts`) are excluded: they are covered by the
      // Playwright flow, and a unit test of them would only assert that a
      // framework was configured.
      include: [
        'src/lib/money.ts',
        'src/lib/settings/**/*.ts',
        'src/lib/rbac/**/*.ts',
        'src/lib/audit.ts',
        'src/lib/scheduler.ts',
        'src/lib/navigation.ts',
        'src/lib/phone.ts',
        'src/lib/auth/password.ts',
        'src/lib/auth/username.ts',
        'src/lib/auth/rate-limit.ts',
        'src/lib/auth/ip.ts',
        'src/lib/auth/resolve.ts',
        'src/modules/**/service.ts',
        'tests/setup/db-guard.ts',
        // Phase 2. `search` and `datetime` carry the 90% gate below for the
        // same reason `money` does: they are the two places where a silent
        // wrong answer looks like a correct one. A name that cannot be found
        // reads as "that person is not in the system", and a date rendered in
        // the wrong timezone reads as a different deadline.
        'src/lib/search.ts',
        'src/lib/datetime.ts',
        'src/lib/palette.ts',
        'src/lib/preferences.ts',
        'src/components/shared/data-table/state.ts',
      ],
      thresholds: {
        // Global gate (docs/TESTING.md §3).
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
        // Financial and access-control code carries the 90% gate.
        'src/lib/money.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/rbac/**/*.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/settings/**/*.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        // Access control carries the same gate as money: a gap here is a gap in
        // who can touch the money (docs/TESTING.md §3).
        'src/lib/auth/password.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/auth/rate-limit.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/navigation.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/phone.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/search.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/datetime.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/preferences.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/components/shared/data-table/state.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
})
