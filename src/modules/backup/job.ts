import { registerJob, type JobDefinition } from '@/lib/scheduler'

import { backupSettingsFromEnv, runBackup } from './service'

/**
 * modules/backup/job.ts — the nightly dump (phase brief item 7).
 *
 * **02:00 Cairo**, an hour ahead of the 03:00 pair (`calendar.recomputeSchedule`
 * and `penalty.recompute`) and two ahead of `performance.recompute`. The order
 * is deliberate: the backup captures the day that just ended, *before* the
 * night's jobs start writing derived columns and ledger rows into it. A dump
 * taken mid-recompute is still consistent — it is one Postgres snapshot — but
 * it would capture a half-finished night, and "which night is this?" is the
 * first question anybody asks of a backup.
 *
 * It takes the scheduler's advisory lock like every other job, so two
 * containers cannot both dump into the same directory. Unlike the other jobs it
 * writes nothing to the database, so the transaction it holds is doing nothing
 * but hold the lock — cheap, and worth it for the mutual exclusion.
 *
 * A failure is logged and rethrown. `lib/scheduler` records the job as failed,
 * which is what puts it in the Dokploy log an operator actually reads; silently
 * swallowing it would produce the worst possible outcome, which is believing
 * you have backups.
 */

export const BACKUP_JOB_NAME = 'backup.nightly'

const BACKUP_CRON = '0 2 * * *'

/** Dumping a real database takes longer than the scheduler's 5-minute default. */
const BACKUP_TIMEOUT_MS = 30 * 60_000

export const nightlyBackupJob: JobDefinition = {
  name: BACKUP_JOB_NAME,
  schedule: BACKUP_CRON,
  timeoutMs: BACKUP_TIMEOUT_MS,
  handler: async (ctx) => {
    const settings = backupSettingsFromEnv()
    const result = await runBackup(settings, ctx.runAt)

    console.info(
      `[${BACKUP_JOB_NAME}] wrote ${result.path} (${(result.bytes / 1024 / 1024).toFixed(1)} MB) in ${result.durationMs}ms; pruned ${result.pruned.length} older than ${settings.retentionDays}d`,
    )
  },
}

/**
 * Called once, from `src/instrumentation.ts` — and only when `BACKUP_DIR` is
 * set. An unset path is how a developer's laptop and the test runner say "not
 * here": registering the job anyway would have every `pnpm dev` session trying
 * to shell out to `pg_dump` at 02:00.
 */
export function registerBackupJobs(): void {
  if (!process.env.BACKUP_DIR) return
  registerJob(nightlyBackupJob)
}
