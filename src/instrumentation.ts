/**
 * Next.js instrumentation hook — the single place the scheduler is started
 * (CLAUDE.md: "one scheduler").
 *
 * Guarded by `ENABLE_SCHEDULER` so that only one container runs jobs when the
 * app is scaled horizontally. The advisory lock in `lib/scheduler` makes a
 * second runner harmless rather than catastrophic, but not running it at all is
 * cheaper than contending for a lock every night.
 */
export async function register(): Promise<void> {
  if (process.env.ENABLE_SCHEDULER !== 'true') return

  /**
   * The runtime check must be a *positive* condition wrapping the import, not
   * an early `return` above it.
   *
   * Next compiles this file once per runtime and substitutes
   * `process.env.NEXT_RUNTIME` as a literal in each. Written this way, the edge
   * compilation sees `"edge" === "nodejs"` and eliminates the whole block —
   * import included. Written as an early return, webpack still resolves the
   * dynamic import and the edge build fails on `node-cron` reaching for `path`
   * and `child_process`. That only started mattering once `src/middleware.ts`
   * existed, because middleware is what makes Next produce an edge bundle at
   * all.
   */
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/lib/scheduler')
    const { registerCalendarJobs } = await import('@/modules/calendar/job')
    const { registerPayoutJobs } = await import('@/modules/payout/job')
    const { registerPenaltyJobs } = await import('@/modules/penalty/job')
    const { registerNotificationJobs } = await import('@/modules/notification/job')

    // Jobs register themselves here as phases land:
    //   Phase 6 — calendar.recomputeSchedule    (03:00 Cairo)     ← below
    //   Phase 7 — payout.closeCycle             (23:59 Cairo, closes on
    //             settings.payout.cycleDay)                       ← below
    //   Phase 8 — penalty.recompute             (03:00 Cairo)     ← below
    //   Phase 9 — notifications.managerDigest   (hourly tick, fires on
    //             settings.notifications.digestHourCairo)         ← below
    //
    // `calendar.recomputeSchedule` and `penalty.recompute` share a time and
    // nothing else: one writes derived columns on `tasks`, the other writes to
    // the append-only ledger. They take *different* advisory-lock keys on
    // purpose, so a slow whole-table scan never delays somebody's deduction and
    // a failing deduction never rolls back the scan.
    registerCalendarJobs()
    registerPayoutJobs()
    registerPenaltyJobs()
    registerNotificationJobs()

    startScheduler()
  }
}
