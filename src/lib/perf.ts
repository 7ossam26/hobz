/**
 * lib/perf — the dashboard/report timing watchdog (Phase 10 phase brief:
 * "every dashboard query indexed and measured — log query times and report
 * anything over 100ms").
 *
 * `100` here is a development-time diagnostic threshold, not a business value
 * — it never reaches a screen, a deduction or a permission decision, so it is
 * exempt from CLAUDE.md invariant 4 the same way `MAX_TASKS_PER_RUN` in the
 * calendar/penalty jobs is: a backstop for the person reading the logs, not a
 * number an operator would ever need to retune from Settings.
 *
 * Deliberately just a `console.warn` — this product has no metrics backend
 * (CLAUDE.md invariant 9: no external APIs), and stdout is what Dokploy's log
 * viewer already captures.
 */

const SLOW_QUERY_MS = 100

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  try {
    return await fn()
  } finally {
    const elapsedMs = performance.now() - startedAt
    if (elapsedMs > SLOW_QUERY_MS) {
      console.warn(`[perf] ${label} took ${elapsedMs.toFixed(1)}ms (> ${SLOW_QUERY_MS}ms)`)
    }
  }
}
