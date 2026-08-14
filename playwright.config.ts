import { defineConfig, devices } from '@playwright/test'

/**
 * e2e configuration (docs/TESTING.md §6).
 *
 * Runs against a production build on a dedicated port and the `agency_test`
 * database, so an e2e run can never touch dev data. `globalSetup` re-asserts
 * the `_test` suffix guard before it writes anything.
 *
 * Phase 1 ships flow #1 (access control) and the RTL/font smoke check. The
 * other five arrive with the features they describe.
 */

// Playwright does not read `.env` either. Same reasoning as vitest.config.ts:
// without this the webServer starts with no DATABASE_URL and every page 500s.
try {
  process.loadEnvFile('.env')
} catch {
  // No `.env` on this machine — CI supplies the variables directly.
}

const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

/** The app under test talks to `agency_test`, never to the dev database. */
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? ''

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL,
    // Arabic, RTL, Cairo — matching production, so RTL bugs surface in e2e.
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      NODE_ENV: 'production',
      ENABLE_SCHEDULER: 'false',
      DATABASE_URL: testDatabaseUrl,
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-only-secret-not-for-production',
      AUTH_URL: baseURL,
      TZ: 'Africa/Cairo',
    },
  },
})
