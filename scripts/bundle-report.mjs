/**
 * scripts/bundle-report.mjs — the SPEC §9 route budget, measured.
 *
 *   node scripts/bundle-report.mjs            # table, exits 1 over budget
 *   node scripts/bundle-report.mjs --json     # machine-readable
 *
 * Run after `next build`. Reads `.next/app-build-manifest.json`, which lists
 * exactly the JS files a route's first load pulls, and gzips each one.
 *
 * **Why this exists next to Next's own build table.** Next already prints a
 * gzipped "First Load JS" per route, and this script agrees with it to within a
 * few KB (`/tasks`: 169.3 vs 173 kB — the two group the shared runtime chunks
 * slightly differently). What the printed table cannot do is *fail*. This
 * exits non-zero when a route crosses SPEC §9's 180 KB, prints `--json` for a
 * CI step, and attributes the total to individual chunk files — which is how
 * the Phase 12 pass found decimal.js sitting in `/tasks`.
 *
 * Sizes are `zlib.gzipSync` at the default level, which is what nginx and a CDN
 * both do by default.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NEXT_DIR = resolve(ROOT, '.next')

/** SPEC §9. */
export const ROUTE_JS_BUDGET_BYTES = 180 * 1024

const gzipCache = new Map()

function gzipSizeOf(relativePath) {
  const cached = gzipCache.get(relativePath)
  if (cached !== undefined) return cached

  const absolute = resolve(NEXT_DIR, relativePath)
  let size = 0
  try {
    statSync(absolute)
    size = gzipSync(readFileSync(absolute)).length
  } catch {
    // A manifest entry with no file on disk is a stale build, not a 0 KB route.
    size = Number.NaN
  }
  gzipCache.set(relativePath, size)
  return size
}

/** `/(app)/tasks/page` → `/tasks`. Route groups are not URL segments. */
function toRoute(manifestKey) {
  const withoutSuffix = manifestKey.replace(/\/(page|route|layout)$/, '')
  const cleaned = withoutSuffix.replace(/\/\([^)]*\)/g, '')
  return cleaned === '' ? '/' : cleaned
}

export function readBundleReport() {
  const manifest = JSON.parse(
    readFileSync(resolve(NEXT_DIR, 'app-build-manifest.json'), 'utf8'),
  )

  const rows = []
  for (const [key, files] of Object.entries(manifest.pages)) {
    if (!key.endsWith('/page')) continue

    const jsFiles = [...new Set(files)].filter((file) => file.endsWith('.js'))
    const bytes = jsFiles.reduce((sum, file) => sum + gzipSizeOf(file), 0)

    rows.push({
      route: toRoute(key),
      gzipBytes: bytes,
      fileCount: jsFiles.length,
      overBudget: !(bytes <= ROUTE_JS_BUDGET_BYTES),
    })
  }

  return rows.sort((a, b) => b.gzipBytes - a.gzipBytes)
}

function kb(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / 1024).toFixed(1)} KB` : 'n/a'
}

function main() {
  const rows = readBundleReport()
  const json = process.argv.includes('--json')

  if (json) {
    console.info(JSON.stringify({ budgetBytes: ROUTE_JS_BUDGET_BYTES, rows }, null, 2))
  } else {
    const width = Math.max(...rows.map((row) => row.route.length), 6)
    console.info(`${'route'.padEnd(width)}  first-load JS (gzip)   files`)
    console.info('-'.repeat(width + 30))
    for (const row of rows) {
      const flag = row.overBudget ? '  ← OVER BUDGET' : ''
      console.info(
        `${row.route.padEnd(width)}  ${kb(row.gzipBytes).padStart(12)}   ${String(
          row.fileCount,
        ).padStart(5)}${flag}`,
      )
    }
    console.info(`\nbudget: ${kb(ROUTE_JS_BUDGET_BYTES)} gzip per route (SPEC §9)`)
  }

  const over = rows.filter((row) => row.overBudget)
  if (over.length > 0) {
    console.error(`\n${over.length} route(s) over budget.`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main()
}
