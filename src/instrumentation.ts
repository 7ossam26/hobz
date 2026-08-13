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
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.ENABLE_SCHEDULER !== 'true') return

  const { startScheduler } = await import('@/lib/scheduler')

  // Jobs register themselves here as phases land:
  //   Phase 6 — calendar.recomputeElapsed  (03:00 Cairo)
  //   Phase 7 — payout.closeCycle          (23:59 Cairo on settings.payoutCycleDay)
  //   Phase 8 — penalty.recompute          (03:00 Cairo)
  //   Phase 9 — notifications.dailyDigest  (08:00 Cairo)
  startScheduler()
}
