import { backupSettingsFromEnv, runBackup } from '../src/modules/backup/service'

/**
 * scripts/backup.ts — take a dump now, from a shell.
 *
 *   BACKUP_DIR=/var/backups/virallap pnpm db:backup
 *
 * The same code the nightly job runs (`modules/backup/job.ts`), reachable
 * without waiting for 02:00 — which is what an operator wants immediately
 * before a migration, and what `docs/RUNBOOK.md` tells them to run.
 *
 * There is deliberately no UI counterpart. A dump is every salary, every
 * deduction and every password hash in one file; it is produced on the server,
 * by someone with shell access, and it stays there.
 */
async function main(): Promise<void> {
  const settings = backupSettingsFromEnv()
  console.info(`[backup] directory: ${settings.directory}`)
  console.info(`[backup] retention: ${settings.retentionDays} night(s)`)

  const result = await runBackup(settings)

  console.info(`[backup] wrote ${result.path}`)
  console.info(
    `[backup] ${(result.bytes / 1024 / 1024).toFixed(2)} MB in ${result.durationMs}ms`,
  )
  if (result.pruned.length > 0) {
    console.info(`[backup] pruned: ${result.pruned.join(', ')}`)
  }
}

main().catch((error: unknown) => {
  console.error('[backup] failed', error)
  process.exitCode = 1
})
