import cron, { type ScheduledTask } from 'node-cron'

// Deep import: the `@/lib/calendar` barrel builds the app calendar on the
// Prisma singleton, and the scheduler only needs the timezone name.
import { CAIRO_TIMEZONE } from '@/lib/calendar/cairo'
import { prisma } from '@/lib/db'
import type { DbClient } from '@/lib/db'

/**
 * lib/scheduler — one scheduler for the whole app (CLAUDE.md architecture rules).
 *
 * Two guarantees:
 *
 * 1. **Only one instance runs a job.** Every run is wrapped in a Postgres
 *    *transaction-level* advisory lock. Transaction-level, not session-level:
 *    Prisma pools connections, so a session lock could be taken on one
 *    connection and released on another. `pg_try_advisory_xact_lock` inside an
 *    interactive transaction is pinned to that transaction's connection and is
 *    released automatically on commit, rollback, or process death.
 *
 * 2. **Jobs are safe to run twice.** The lock protects against concurrency, not
 *    against repetition — a redeploy mid-run, or a manual trigger, will run a
 *    job again. Idempotency is each job's own responsibility (CLAUDE.md
 *    invariant 6): the penalty job must reverse-then-insert, never accumulate.
 */

export interface JobContext {
  /** The transaction client holding the advisory lock. Use it for all writes. */
  db: Parameters<Parameters<DbClient['$transaction']>[0]>[0]
  /** When the run was triggered, in UTC. Jobs must not call `new Date()`. */
  runAt: Date
  trigger: 'schedule' | 'manual'
}

export interface JobDefinition {
  name: string
  /** Standard 5-field cron expression, evaluated in Africa/Cairo. */
  schedule: string
  handler: (ctx: JobContext) => Promise<void>
  /** Abort and release the lock after this long. Default 5 minutes. */
  timeoutMs?: number
}

export type JobResult =
  | { status: 'completed'; name: string; durationMs: number }
  | { status: 'skipped-locked'; name: string; durationMs: number }
  | { status: 'failed'; name: string; durationMs: number; error: unknown }

const DEFAULT_JOB_TIMEOUT_MS = 5 * 60_000

const registry = new Map<string, JobDefinition>()
const running = new Map<string, ScheduledTask>()

/**
 * Map a job name to a stable 64-bit advisory-lock key (FNV-1a).
 *
 * Stable across processes and deploys — that is the whole requirement. Exported
 * so a test can assert two names don't collide.
 */
export function advisoryLockKey(name: string): bigint {
  const FNV_OFFSET = 0xcbf29ce484222325n
  const FNV_PRIME = 0x100000001b3n
  const MASK = 0xffffffffffffffffn

  let hash = FNV_OFFSET
  for (const byte of Buffer.from(name, 'utf8')) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK
  }
  // Postgres advisory keys are signed bigint; fold into the signed range.
  return hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash
}

/**
 * Run `fn` while holding the named advisory lock, or report that another
 * instance holds it. Exported because manual recomputations (a Phase 8 "recalculate
 * penalties" button) must contend for the same lock as the scheduled job.
 */
export async function withAdvisoryLock<T>(
  client: DbClient,
  name: string,
  fn: (db: JobContext['db']) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const key = advisoryLockKey(name)
  const timeoutMs = options.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS

  return client.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked
      `
      if (rows[0]?.locked !== true) return { acquired: false as const }
      return { acquired: true as const, result: await fn(tx) }
    },
    { timeout: timeoutMs, maxWait: 5_000 },
  )
}

export function registerJob(job: JobDefinition): void {
  if (!cron.validate(job.schedule)) {
    throw new Error(`Invalid cron expression for job "${job.name}": ${job.schedule}`)
  }
  if (registry.has(job.name)) {
    throw new Error(`Job "${job.name}" is already registered`)
  }
  registry.set(job.name, job)
}

export function registeredJobs(): readonly JobDefinition[] {
  return [...registry.values()]
}

/** Test/CLI seam. */
export function clearJobs(): void {
  stopScheduler()
  registry.clear()
}

/**
 * Execute a job once, right now, under the lock. Used by the cron tick and by
 * manual triggers; both paths are identical so the lock behaviour cannot drift.
 */
export async function runJob(
  name: string,
  trigger: JobContext['trigger'] = 'manual',
  client: DbClient = prisma,
): Promise<JobResult> {
  const job = registry.get(name)
  if (!job) throw new Error(`Unknown job "${name}"`)

  const startedAt = Date.now()
  const runAt = new Date(startedAt)

  try {
    const outcome = await withAdvisoryLock(
      client,
      job.name,
      (db) => job.handler({ db, runAt, trigger }),
      { timeoutMs: job.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS },
    )

    return outcome.acquired
      ? { status: 'completed', name, durationMs: Date.now() - startedAt }
      : { status: 'skipped-locked', name, durationMs: Date.now() - startedAt }
  } catch (error) {
    // A failing job must never take the process down — the next tick retries.
    console.error(`[scheduler] job "${name}" failed`, error)
    return { status: 'failed', name, durationMs: Date.now() - startedAt, error }
  }
}

let started = false

/**
 * Start every registered job. Idempotent, so Next.js instrumentation re-running
 * on hot reload cannot double-schedule.
 */
export function startScheduler(client: DbClient = prisma): void {
  if (started) return
  started = true

  for (const job of registry.values()) {
    const task = cron.schedule(
      job.schedule,
      () => {
        void runJob(job.name, 'schedule', client)
      },
      { timezone: CAIRO_TIMEZONE },
    )
    running.set(job.name, task)
  }
}

export function stopScheduler(): void {
  for (const task of running.values()) {
    void task.stop()
  }
  running.clear()
  started = false
}

export function isSchedulerStarted(): boolean {
  return started
}
