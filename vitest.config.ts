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
          // bcrypt at cost 12 (lib/auth/password) genuinely takes 1-4s per
          // call under `--coverage`'s v8 instrumentation, against vitest's
          // 5s default — margin thin enough that `tests/unit/auth/*.test.ts`
          // started timing out under Phase 3's larger, more parallel suite.
          // Widened once here rather than per-test, matching the integration
          // project's own explicit `testTimeout` a few lines down for the
          // same class of concern (slow-but-correct crypto/IO, not a hang).
          testTimeout: 15_000,
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
        // Phase 3. `project/health.ts` carries the 90% gate below for the same
        // reason `money`/`search`/`datetime` do: a silently wrong RAG reads as
        // a correct one until a manager acts on it. `project/code.ts` is
        // listed (no elevated gate) so its coverage is measured honestly
        // rather than quietly excluded because it lives outside `service.ts`.
        'src/modules/project/health.ts',
        'src/modules/project/code.ts',
        // Phase 4. `task/state-machine.ts` and `task/elapsed.ts` carry the 90%
        // gate below for the same reason `money` does: a silent wrong answer
        // reads as a correct one. An illegal transition that slips through
        // corrupts a task's history, and elapsed working time is a direct
        // input to the penalty engine (SPEC §5.2 → §5.4). `task/mentions.ts`
        // and `task/ports.ts` are listed without an elevated gate so their
        // coverage is measured honestly rather than quietly excluded for
        // living outside `service.ts`.
        'src/modules/task/state-machine.ts',
        'src/modules/task/elapsed.ts',
        'src/modules/task/mentions.ts',
        'src/modules/task/ports.ts',
        // Phase 6. `lib/calendar` carries the 90% gate docs/TESTING.md §3 names
        // it under, and every file below it does too: a wrong working-day count
        // is a wrong deduction, and it looks exactly like a right one.
        // `index.ts` is excluded — it is the Prisma singleton wiring, the same
        // exclusion `lib/auth/session.ts` gets, and a unit test of it would only
        // assert that a client was constructed.
        'src/lib/calendar/cairo.ts',
        'src/lib/calendar/calendar.ts',
        'src/lib/calendar/work-calendar.ts',
        'src/lib/calendar/source.ts',
        'src/lib/calendar/zod.ts',
        // `escalation.ts`, `blocked.ts` and `job.ts` live outside `service.ts`
        // and are listed so their coverage is measured honestly rather than
        // quietly excluded.
        'src/modules/lateness/escalation.ts',
        'src/modules/lateness/blocked.ts',
        'src/modules/lateness/ports.ts',
        'src/modules/calendar/job.ts',
        'src/modules/leave/lookup.ts',
        // Phase 7. docs/TESTING.md §3 names `modules/payout` and `modules/ledger`
        // in the 90% group alongside money, rbac, calendar and penalty — this is
        // the phase where that gate starts applying to something real. The files
        // outside `service.ts` are listed so their coverage is measured honestly
        // rather than quietly excluded for living next door to it; `sign.ts`,
        // `pay-profile.ts` and `period.ts` carry the elevated gate below because
        // each is a place where a silent wrong answer looks exactly like a right
        // one — a mis-signed entry, a salary divided by the wrong number, a cycle
        // that ends on the wrong night.
        'src/modules/ledger/sign.ts',
        'src/modules/ledger/pay-profile.ts',
        'src/modules/ledger/earnings.ts',
        'src/modules/ledger/port.ts',
        'src/modules/payout/period.ts',
        'src/modules/payout/cycle.ts',
        'src/modules/payout/job.ts',
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
        'src/modules/project/health.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/task/state-machine.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/task/elapsed.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        // docs/TESTING.md §3 names `lib/calendar` in the 90% group alongside
        // money, rbac, penalty and payout. Phase 6 is where that gate starts
        // applying to something other than a stub.
        'src/lib/calendar/cairo.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/calendar/calendar.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/calendar/work-calendar.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/lib/calendar/source.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        // The lateness figure is the multiplicand of every automatic deduction
        // (SPEC §5.3 → §5.4), so it carries the financial gate.
        'src/modules/lateness/service.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/lateness/escalation.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        // Which stretches of a task were BLOCKED is subtracted straight from a
        // deduction (SPEC §5.3), so it carries the financial gate too.
        'src/modules/lateness/blocked.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        // Phase 7 — docs/TESTING.md §3's `modules/payout` and `modules/ledger`.
        // This is the financial core; nothing here gets the global 70%.
        'src/modules/ledger/service.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/ledger/sign.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/ledger/pay-profile.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/payout/service.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/payout/period.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/payout/cycle.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
})
