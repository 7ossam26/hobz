import { chromium, type Page } from '@playwright/test'

import { ar } from '../src/i18n/ar'

/**
 * scripts/lcp-report.ts — SPEC §9's "LCP < 1.8s on 4G", measured.
 *
 *   # 1. a production build, served, against a database with data in it
 *   pnpm build && pnpm start --port 3100
 *   # 2. then
 *   E2E_BASE_URL=http://127.0.0.1:3100 \
 *   LCP_USERNAME=admin LCP_PASSWORD=… pnpm tsx scripts/lcp-report.ts
 *
 *   … --no-throttle    measure on the local link instead of emulated 4G
 *   … --runs=5         median of N loads per route (default 3)
 *
 * ── What is measured, and how ──────────────────────────────────────────────
 *
 * A real Chromium, a real sign-in, a real navigation per route, and the
 * browser's own `largest-contentful-paint` PerformanceObserver entry — not a
 * proxy like `load` or `domContentLoaded`. LCP is defined as the *last* such
 * entry before the first interaction, so the observer keeps the latest value
 * and is read after the network settles.
 *
 * **Throttled to "Fast 4G" by default**, via CDP, because the budget in SPEC §9
 * is stated on 4G and an unthrottled localhost measurement of a Next.js app is
 * always well under two seconds — it would be a number that can never fail,
 * which is the same as not measuring. The profile below is Chrome DevTools'
 * own: 9 Mbit down, 1.5 Mbit up, 85 ms RTT.
 *
 * Each route is loaded `--runs` times and the **median** reported. LCP on a
 * developer machine is noisy — one background compile moves a single run by
 * hundreds of milliseconds — and a median of three is the cheapest thing that
 * stops a report being an anecdote.
 *
 * Deliberately not part of `pnpm test`: it needs a built server and a seeded
 * database, and a performance number that fails CI on an unrelated machine's
 * load average teaches people to ignore CI.
 */

const args = process.argv.slice(2)
const THROTTLE = !args.includes('--no-throttle')
const RUNS = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 3)

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100'
const USERNAME = process.env.LCP_USERNAME ?? process.env.SEED_ADMIN_USERNAME ?? 'admin'
const PASSWORD = process.env.LCP_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? ''

/** SPEC §9. */
const LCP_BUDGET_MS = 1800

/** Chrome DevTools' "Fast 4G". */
const FAST_4G = {
  offline: false,
  downloadThroughput: (9 * 1000 * 1000) / 8,
  uploadThroughput: (1.5 * 1000 * 1000) / 8,
  latency: 85,
}

/**
 * Every route a signed-in operator actually opens. `/design-system` is excluded
 * — it 404s in production by design (SPEC §9).
 */
const ROUTES = [
  '/dashboard',
  '/tasks',
  '/tasks?view=board',
  '/projects',
  '/clients',
  '/calendar',
  '/my-earnings',
  '/payouts',
  '/penalties',
  '/reports',
  '/users',
  '/roles',
  '/settings',
  '/audit',
  '/import',
] as const

/**
 * Installed *before* the document runs, so the observer exists before the
 * browser has anything to report. Reading `performance.getEntriesByType` after
 * the fact works in Chromium but not reliably across a soft navigation, and
 * this way the same code measures both.
 */
const OBSERVER_SCRIPT = `
  window.__lcp = 0
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      // The spec's rule: the largest paint so far wins, and later entries
      // supersede earlier ones until the first user interaction.
      window.__lcp = Math.max(window.__lcp, entry.startTime)
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true })
`

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number)
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel(ar.auth.username).fill(USERNAME)
  await page.getByLabel(ar.auth.password).fill(PASSWORD)
  await page.getByRole('button', { name: ar.auth.signIn }).click()
  await page.waitForURL(/\/(dashboard|change-password)/, { timeout: 30_000 })

  if (page.url().includes('change-password')) {
    throw new Error(
      'This account must change its password before it can browse. Use one that does not.',
    )
  }
}

async function measure(page: Page, route: string): Promise<number> {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle' })
  // One frame after idle: the largest element may only be painted on the tick
  // after the last response is applied.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
  return page.evaluate(() => (window as unknown as { __lcp: number }).__lcp)
}

async function main(): Promise<void> {
  if (!PASSWORD) {
    throw new Error('Set LCP_PASSWORD (or SEED_ADMIN_PASSWORD) before running.')
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    viewport: { width: 1440, height: 900 },
  })
  await context.addInitScript(OBSERVER_SCRIPT)

  const page = await context.newPage()

  if (THROTTLE) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', FAST_4G)
    // Matches Chrome's own "4x slowdown" preset; a phone on 4G is not a
    // desktop CPU with a slow radio.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }

  console.info(`base URL:  ${BASE_URL}`)
  console.info(`network:   ${THROTTLE ? 'emulated Fast 4G + 4× CPU' : 'unthrottled'}`)
  console.info(`runs:      ${RUNS} per route (median reported)`)
  console.info(`budget:    ${LCP_BUDGET_MS} ms (SPEC §9)\n`)

  await signIn(page)

  const width = Math.max(...ROUTES.map((r) => r.length), 5)
  console.info(`${'route'.padEnd(width)}   LCP (median)`)
  console.info('-'.repeat(width + 20))

  const over: string[] = []

  for (const route of ROUTES) {
    const samples: number[] = []
    for (let run = 0; run < RUNS; run += 1) samples.push(await measure(page, route))

    const value = median(samples)
    const flag = value > LCP_BUDGET_MS ? '  ← OVER BUDGET' : ''
    if (value > LCP_BUDGET_MS) over.push(route)

    console.info(
      `${route.padEnd(width)}   ${`${value.toFixed(0)} ms`.padStart(9)}${flag}`,
    )
  }

  await browser.close()

  if (over.length > 0) {
    console.error(`\n${over.length} route(s) over the ${LCP_BUDGET_MS} ms budget.`)
    process.exitCode = 1
  } else {
    console.info('\nevery route inside the budget.')
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
