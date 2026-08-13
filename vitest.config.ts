import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

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
      // Scoped to code that Phase 0 actually implements. Each phase widens this
      // list as its modules land — see docs/DECISIONS.md.
      include: [
        'src/lib/money.ts',
        'src/lib/settings/**/*.ts',
        'src/lib/rbac/**/*.ts',
        'src/lib/audit.ts',
        'src/lib/scheduler.ts',
        'src/modules/**/service.ts',
        'tests/setup/db-guard.ts',
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
      },
    },
  },
})
