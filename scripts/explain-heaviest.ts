import { PrismaClient } from '@prisma/client'

import { listAuditEntries } from '../src/modules/audit/service'
import { listClients } from '../src/modules/client/service'
import { balancesFor, listEntries } from '../src/modules/ledger/service'
import { listCycles, listPayouts, listStatements } from '../src/modules/payout/service'
import { listMoneyRegister } from '../src/modules/penalty/register'
import { listProjects } from '../src/modules/project/service'
import { listTasks } from '../src/modules/task/service'
import { listUsers } from '../src/modules/user/service'

/**
 * scripts/explain-heaviest.ts — the Phase 12 index audit.
 *
 *   DATABASE_URL=<a _test or scratch database> pnpm perf:explain
 *   … --load           amplify the dataset first (see below)
 *   … --top=15         explain more than the default ten
 *
 * ── What it actually does ──────────────────────────────────────────────────
 *
 * 1. Runs the product's own heaviest read paths — the real `service.ts`
 *    functions the list screens call, not hand-written SQL that only resembles
 *    them. Prisma's query event stream is captured while they run.
 * 2. Ranks the emitted statements by wall time and takes the top N.
 * 3. Re-runs each one under `EXPLAIN (ANALYZE, BUFFERS)` with its real
 *    parameters and prints the plan.
 *
 * Hand-writing the ten queries would have measured the queries somebody
 * *thought* the product runs. Capturing them measures the ones it does.
 *
 * ── Why `--load` exists ────────────────────────────────────────────────────
 *
 * Postgres correctly sequential-scans a 60-row table: at that size a seq scan
 * *is* the fast plan, and a plan taken there proves nothing about the plan
 * taken at real volume. `--load` inserts a few years of a ~100-person agency's
 * work (SPEC §2's ceiling) — 100 users, 40 projects, 8 000 tasks, 30 000 ledger
 * entries — so the planner is answering the question the product will really
 * ask it. The load path uses `createMany` deliberately: it is a perf fixture,
 * not demo data, and `prisma/seed-demo.ts` is the file that goes through the
 * services.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────
 *
 * `--load` writes tens of thousands of rows and refuses to run against a
 * database whose name does not end in `_test` (CLAUDE.md invariant 10's
 * reasoning, applied to the one other script that bulk-writes). Read-only
 * EXPLAINs run against anything.
 */

const args = process.argv.slice(2)
const WANT_LOAD = args.includes('--load')
const TOP_N = Number(args.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 10)

interface CapturedQuery {
  query: string
  params: unknown[]
  durationMs: number
  label: string
}

const captured: CapturedQuery[] = []
let currentLabel = 'startup'

const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'query' }],
})

prisma.$on('query', (event) => {
  // Prisma emits its own transaction and introspection statements too; only
  // the ones that touch a table are worth a plan.
  if (!/^\s*SELECT/i.test(event.query)) return
  captured.push({
    query: event.query,
    params: safeParams(event.params),
    durationMs: event.duration,
    label: currentLabel,
  })
})

/**
 * Prisma logs a `Date` parameter as `2026-08-18 10:37:52.384 UTC` — its own
 * format, neither ISO-8601 nor anything Postgres will accept as a `timestamp`
 * when bound back as text. Both shapes are matched because the format is
 * Prisma's private business and has changed before.
 */
const PRISMA_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s?UTC|Z|[+-]\d{2}:\d{2})?$/

function safeParams(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    /**
     * Re-hydrate timestamps. Binding the logged string back as `text` turns
     * `"dueDate" < $6` into `timestamp < text`, which Postgres refuses — the
     * plan would be missing for exactly the busiest screen in the product.
     */
    return parsed.map((value) => {
      if (typeof value !== 'string' || !PRISMA_TIMESTAMP.test(value)) return value
      const asDate = new Date(value.replace(' UTC', 'Z').replace(' ', 'T'))
      return Number.isNaN(asDate.getTime()) ? value : asDate
    })
  } catch {
    return []
  }
}

async function step(label: string, run: () => Promise<unknown>): Promise<void> {
  currentLabel = label
  const startedAt = performance.now()
  try {
    await run()
    console.info(`  ${label}  ${(performance.now() - startedAt).toFixed(0)}ms`)
  } catch (error) {
    console.info(`  ${label}  SKIPPED (${(error as Error).message.split('\n')[0]})`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional load
// ─────────────────────────────────────────────────────────────────────────────

function assertScratchDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  const dbName = new URL(url).pathname.slice(1)
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `REFUSING to bulk-load "${dbName}": --load only runs against a database whose name ends in _test.`,
    )
  }
}

const TARGET = {
  users: 100,
  projects: 40,
  tasksPerProject: 200,
  ledgerPerUser: 300,
} as const

async function load(): Promise<void> {
  assertScratchDatabase()
  console.info('loading a ~100-person agency-year …')

  const role = await prisma.role.findFirst({ select: { id: true } })
  const existingUsers = await prisma.user.findMany({ select: { id: true } })
  const owner = existingUsers[0]
  if (!owner) throw new Error('Run `pnpm db:seed` (and ideally db:seed:demo) first.')

  const now = Date.now()
  const DAY = 86_400_000

  const newUsers = Array.from({ length: TARGET.users }, (_, i) => ({
    username: `perf.user.${i}`,
    usernameCanonical: `perf.user.${i}`,
    passwordHash: '$2b$12$0000000000000000000000000000000000000000000000000000',
    fullName: `منفّذ اختبار ${i}`,
    isWorker: true,
    payType: 'PER_TASK' as const,
    defaultTaskRate: '500.00',
    weeklyCapacityHours: 40,
  }))
  await prisma.user.createMany({ data: newUsers, skipDuplicates: true })
  if (role) {
    const created = await prisma.user.findMany({
      where: { username: { startsWith: 'perf.user.' } },
      select: { id: true },
    })
    await prisma.userRole.createMany({
      data: created.map((u) => ({ userId: u.id, roleId: role.id })),
      skipDuplicates: true,
    })
  }

  const workers = await prisma.user.findMany({
    where: { isWorker: true, deletedAt: null },
    select: { id: true },
  })

  await prisma.project.createMany({
    data: Array.from({ length: TARGET.projects }, (_, i) => ({
      code: `PERF-${String(i).padStart(4, '0')}`,
      name: `مشروع اختبار ${i}`,
      ownerId: owner.id,
      engagementType: 'FIXED_PRICE' as const,
      status: 'ACTIVE' as const,
      startDate: new Date(now - 400 * DAY),
      dueDate: new Date(now + 60 * DAY),
    })),
    skipDuplicates: true,
  })

  const projects = await prisma.project.findMany({
    where: { code: { startsWith: 'PERF-' } },
    select: { id: true },
  })

  const statuses = [
    'BACKLOG',
    'ASSIGNED',
    'IN_PROGRESS',
    'SUBMITTED',
    'IN_REVIEW',
    'APPROVED',
    'BLOCKED',
  ] as const
  const categories = ['design', 'development', 'content', 'marketing', 'video']
  const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

  let taskTotal = 0
  for (const [projectIndex, project] of projects.entries()) {
    const rows = Array.from({ length: TARGET.tasksPerProject }, (_, i) => {
      const seed = projectIndex * TARGET.tasksPerProject + i
      const due = new Date(now + (((seed * 7) % 400) - 200) * DAY)
      return {
        projectId: project.id,
        title: `مهمة اختبار ${seed}`,
        assigneeId: workers[seed % workers.length]?.id ?? null,
        status: statuses[seed % statuses.length] as (typeof statuses)[number],
        priority: priorities[seed % priorities.length] as (typeof priorities)[number],
        categoryId: categories[seed % categories.length] as string,
        estimatedHours: String((seed % 12) + 1),
        taskValue: '500.00',
        dueDate: due,
        originalDueDate: due,
        createdAt: new Date(now - (((seed * 3) % 380) + 5) * DAY),
      }
    })
    await prisma.task.createMany({ data: rows })
    taskTotal += rows.length
  }

  const cycle = await prisma.payoutCycle.findFirst({ select: { id: true } })
  let ledgerTotal = 0
  for (const worker of workers) {
    const rows = Array.from({ length: TARGET.ledgerPerUser }, (_, i) => ({
      userId: worker.id,
      cycleId: cycle?.id ?? null,
      type: (i % 5 === 0 ? 'PENALTY' : 'EARNING') as 'PENALTY' | 'EARNING',
      amount: i % 5 === 0 ? '-50.00' : '500.00',
      note: i % 5 === 0 ? 'خصم اختبار' : 'استحقاق اختبار',
      isAutoGenerated: i % 5 === 0,
      createdAt: new Date(now - ((i * 2) % 380) * DAY),
    }))
    await prisma.ledgerEntry.createMany({ data: rows })
    ledgerTotal += rows.length
  }

  console.info(
    `  loaded: ${newUsers.length} users, ${projects.length} projects, ${taskTotal} tasks, ${ledgerTotal} ledger entries`,
  )

  // Without this the planner is working from statistics gathered when the
  // tables were empty, and every plan below would be a plan for 60 rows.
  console.info('  ANALYZE …')
  await prisma.$executeRawUnsafe('ANALYZE')
}

// ─────────────────────────────────────────────────────────────────────────────
// The read paths
// ─────────────────────────────────────────────────────────────────────────────

async function exerciseReadPaths(): Promise<void> {
  const now = new Date()
  const worker = await prisma.user.findFirst({
    where: { isWorker: true, deletedAt: null },
    select: { id: true },
  })
  const project = await prisma.project.findFirst({
    where: { deletedAt: null },
    select: { id: true },
  })
  const cycle = await prisma.payoutCycle.findFirst({ select: { id: true } })
  const workerIds = (
    await prisma.user.findMany({
      where: { isWorker: true, deletedAt: null },
      select: { id: true },
      take: 100,
    })
  ).map((u) => u.id)

  console.info('\nexercising read paths:')

  await step('tasks · list, filtered + paginated', () =>
    listTasks(prisma, {
      scope: { deletedAt: null },
      now,
      dueSoonDays: 7,
      filters: {
        status: ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'],
        priority: ['HIGH', 'URGENT'],
        overdueOnly: true,
        page: 1,
        pageSize: 25,
      },
    }),
  )

  await step('tasks · board read (whole filtered set)', () =>
    listTasks(prisma, {
      scope: { deletedAt: null },
      now,
      dueSoonDays: 7,
      filters: { projectId: project ? [project.id] : [], page: 1, pageSize: 1000 },
    }),
  )

  await step('tasks · assignee inbox', () =>
    listTasks(prisma, {
      scope: { deletedAt: null },
      now,
      dueSoonDays: 7,
      filters: {
        assigneeId: worker ? [worker.id] : [],
        dueSoon: true,
        page: 1,
        pageSize: 25,
      },
    }),
  )

  await step('projects · list with health', () =>
    listProjects(prisma, {
      scope: { deletedAt: null },
      now,
      filters: { page: 1, pageSize: 25 },
      thresholds: {
        overdueTasksThreshold: 3,
        blockedDaysThreshold: 3,
        amberDaysBeforeDue: 3,
      },
    }),
  )

  await step('ledger · statement page', () =>
    listEntries(prisma, { userId: worker?.id, page: 1, pageSize: 50 }),
  )

  await step('ledger · balances for every منفّذ', () =>
    balancesFor(prisma, { userIds: workerIds }),
  )

  await step('penalties · money register', () =>
    listMoneyRegister(prisma, { page: 1, pageSize: 25 }),
  )

  await step('payouts · one cycle', () =>
    listPayouts(prisma, cycle ? { cycleId: cycle.id } : {}),
  )

  await step('payouts · cycle list', () => listCycles(prisma, { limit: 24 }))

  await step('payouts · statements', () =>
    worker
      ? listStatements(prisma, { userId: worker.id, limit: 24 })
      : Promise.resolve([]),
  )

  await step('users · directory page', () =>
    listUsers(prisma, { page: 1, pageSize: 25, isActive: true }),
  )

  await step('clients · list', () => listClients(prisma, { page: 1, pageSize: 25 }))

  await step('audit · log page', () =>
    listAuditEntries(prisma, { page: 1, pageSize: 50 }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPLAIN
// ─────────────────────────────────────────────────────────────────────────────

/** Collapse repeats of the same statement, keeping the slowest observation. */
function heaviest(queries: CapturedQuery[], limit: number): CapturedQuery[] {
  const bySql = new Map<string, CapturedQuery>()
  for (const query of queries) {
    const existing = bySql.get(query.query)
    if (!existing || query.durationMs > existing.durationMs) bySql.set(query.query, query)
  }
  return [...bySql.values()].sort((a, b) => b.durationMs - a.durationMs).slice(0, limit)
}

/**
 * Prisma logs parameters JSON-encoded, so a `timestamp` arrives as a string and
 * an enum as a string. Postgres infers both correctly from the query's own
 * context, which is why the plan is the real one rather than a cast-shaped
 * approximation.
 */
async function explain(query: CapturedQuery): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE false) ${query.query}`,
    ...query.params,
  )
  return rows.map((row) => Object.values(row)[0]).join('\n')
}

function verdict(plan: string): string {
  const seqScans = [...plan.matchAll(/Seq Scan on (\w+)/g)].map((m) => m[1])
  if (seqScans.length === 0) return 'index-only path'
  return `sequential scan on: ${[...new Set(seqScans)].join(', ')}`
}

async function main(): Promise<void> {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgres://x/y').pathname.slice(1)
  console.info(`database: ${dbName}`)

  if (WANT_LOAD) await load()

  // Warm the connection and the plan cache, then discard: the first query of a
  // process pays for connection setup and would otherwise always rank first.
  await prisma.$queryRawUnsafe('SELECT 1')
  captured.length = 0

  await exerciseReadPaths()

  const top = heaviest(captured, TOP_N)
  console.info(
    `\ncaptured ${captured.length} SELECT statement(s); explaining the ${top.length} heaviest\n`,
  )

  for (const [index, query] of top.entries()) {
    console.info('='.repeat(78))
    console.info(`#${index + 1}  ${query.label}  —  ${query.durationMs}ms`)
    console.info('-'.repeat(78))
    console.info(query.query)
    console.info('-'.repeat(78))
    try {
      const plan = await explain(query)
      console.info(plan)
      console.info(`\nverdict: ${verdict(plan)}`)
    } catch (error) {
      console.info(`EXPLAIN failed: ${(error as Error).message.trim()}`)
    }
    console.info('')
  }
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
