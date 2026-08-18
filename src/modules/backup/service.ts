import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

/**
 * modules/backup/service.ts — the nightly `pg_dump` (phase brief item 7).
 *
 * ── The shape of it ────────────────────────────────────────────────────────
 *
 * One gzipped custom-free plain SQL dump per night, written to a **server
 * path** and pruned after a retention window. Nothing else: no object storage,
 * no upload, no encryption-at-rest layer of our own (CLAUDE.md invariant 9 —
 * no external APIs; the disk's own encryption and the host's backups are the
 * layers below this one).
 *
 * ── The deliberate absence ─────────────────────────────────────────────────
 *
 * **There is no download button, and there must never be one.** The brief says
 * so, and the reason is worth writing down: a dump of this database is every
 * worker's salary, every deduction, every phone number, and the bcrypt hash of
 * every password, in one file. A button makes that file one compromised admin
 * session away from leaving the building. Restoring is an operator task on the
 * server, with shell access, and `docs/RUNBOOK.md` is where it is documented.
 * Nothing in `src/app` imports this module.
 *
 * ── Why plain SQL and not a Prisma-level export ────────────────────────────
 *
 * A backup has to survive the application that wrote it. `pg_dump` produces a
 * file that `psql` can restore with no Node, no Prisma and no schema
 * agreement — which is exactly the situation a restore happens in.
 */

export interface BackupSettings {
  /** Absolute or app-relative directory. Created if missing. */
  directory: string
  /** Nights of history to keep. */
  retentionDays: number
  /** The database to dump. */
  databaseUrl: string
  /** Overridable so a container can point at a pinned client version. */
  pgDumpPath: string
}

export const DEFAULT_BACKUP_DIR = '/var/backups/agency-os'
export const DEFAULT_RETENTION_DAYS = 14

/**
 * Retention is an env var and **not** a Settings key, which is the one place
 * this module departs from CLAUDE.md invariant 4 — deliberately, and for a
 * reason the invariant itself implies. Invariant 4 is about *business* values:
 * numbers whose change alters what somebody is paid, and which an operator must
 * be able to retune without a redeploy. Retention is a property of the disk the
 * container is mounted on. It is chosen by whoever sized that disk, at deploy
 * time, in the same file as the mount — and a settings page that let an admin
 * ask for 365 nights of dumps on a 20 GB volume would be offering a promise the
 * filesystem cannot keep.
 */
export function backupSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): BackupSettings {
  const retentionRaw = Number(env.BACKUP_RETENTION_DAYS)

  return {
    directory: env.BACKUP_DIR ?? DEFAULT_BACKUP_DIR,
    retentionDays:
      Number.isInteger(retentionRaw) && retentionRaw > 0
        ? retentionRaw
        : DEFAULT_RETENTION_DAYS,
    databaseUrl: env.DATABASE_URL ?? '',
    pgDumpPath: env.PG_DUMP_PATH ?? 'pg_dump',
  }
}

/** `agency-os-2026-08-18T0300.sql.gz` — sortable, and unambiguous in a listing. */
export function backupFileName(at: Date): string {
  const iso = at.toISOString()
  return `agency-os-${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}.sql.gz`
}

/** Only files this module wrote are ever considered for deletion. */
const BACKUP_FILE = /^agency-os-\d{4}-\d{2}-\d{2}T\d{4}\.sql\.gz$/

export function isBackupFile(name: string): boolean {
  return BACKUP_FILE.test(basename(name))
}

export interface BackupResult {
  path: string
  bytes: number
  durationMs: number
  pruned: string[]
}

/**
 * Run `pg_dump`, gzip the stream, and write it.
 *
 * The connection string is passed in the **environment**, not on the command
 * line: an argument is visible in `ps` to every process on the host, and this
 * one contains the database password.
 *
 * `--no-owner --no-privileges` so the dump restores into a database owned by
 * whoever is restoring it, rather than demanding a role that may not exist on
 * the machine the restore is happening on — which is, by definition, not the
 * machine that failed.
 */
export async function runBackup(
  settings: BackupSettings,
  at: Date = new Date(),
): Promise<BackupResult> {
  if (!settings.databaseUrl)
    throw new Error('DATABASE_URL is not set; refusing to back up')

  const startedAt = Date.now()
  const directory = resolve(settings.directory)
  await mkdir(directory, { recursive: true })

  const target = join(directory, backupFileName(at))
  // `.partial` until the dump has exited 0. A truncated file that looks like a
  // backup is worse than a missing one — the pruner also ignores it, so an
  // interrupted run cannot age out a good dump in its place.
  const partial = `${target}.partial`

  const child = spawn(
    settings.pgDumpPath,
    ['--no-owner', '--no-privileges', '--format=plain', '--encoding=UTF8'],
    {
      env: { ...process.env, PGDATABASE: settings.databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    // Bounded: a dump that fails on every row must not fill memory with its
    // own complaints.
    if (stderr.length < 8_000) stderr += chunk
  })

  const exited = new Promise<number>((resolvePromise, rejectPromise) => {
    child.on('error', rejectPromise)
    child.on('close', resolvePromise)
  })

  try {
    await pipeline(child.stdout, createGzip({ level: 6 }), createWriteStream(partial))
    const code = await exited
    if (code !== 0) {
      throw new Error(`pg_dump exited ${code}: ${stderr.trim() || 'no output'}`)
    }
  } catch (error) {
    await unlink(partial).catch(() => undefined)
    throw error
  }

  const { rename } = await import('node:fs/promises')
  await rename(partial, target)

  const { size } = await stat(target)
  if (size === 0) {
    await unlink(target).catch(() => undefined)
    throw new Error('pg_dump produced an empty file')
  }

  const pruned = await pruneBackups(directory, settings.retentionDays, at)

  return { path: target, bytes: size, durationMs: Date.now() - startedAt, pruned }
}

/**
 * Delete dumps older than the retention window.
 *
 * Age is read from the **filename**, not from `mtime`: copying a backup
 * directory, or restoring the volume itself, resets every mtime and would make
 * the whole history look like it was written this morning. The name is the one
 * timestamp that travels with the file.
 */
export async function pruneBackups(
  directory: string,
  retentionDays: number,
  now: Date,
): Promise<string[]> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  const removed: string[] = []

  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return removed
  }

  for (const entry of entries) {
    if (!isBackupFile(entry)) continue
    const stamp = backupTimestamp(entry)
    if (stamp === null || stamp.getTime() >= cutoff) continue

    try {
      await unlink(join(directory, entry))
      removed.push(entry)
    } catch {
      // A file another process is holding open will be pruned tomorrow. It is
      // not worth failing the night's backup over.
    }
  }

  return removed
}

/** `agency-os-2026-08-18T0300.sql.gz` → the instant in its name. */
export function backupTimestamp(name: string): Date | null {
  const match = /^agency-os-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})\.sql\.gz$/.exec(
    basename(name),
  )
  if (!match) return null
  const parsed = new Date(`${match[1]}T${match[2]}:${match[3]}:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
