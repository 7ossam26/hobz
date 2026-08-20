import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { assertTestDatabase } from './db-guard'

/**
 * Runs once per integration test run, before any worker starts.
 *
 * Applies migrations rather than `db push`: the test schema must be the schema
 * the migrations actually produce, or the suite validates a database that will
 * never exist in production (CLAUDE.md: "Prisma migrations only").
 */
export async function setup(): Promise<void> {
  const dbName = assertTestDatabase()

  execFileSync(
    process.execPath,
    [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    },
  )

  console.info(`[tests] migrations applied to "${dbName}"`)
}

export async function teardown(): Promise<void> {
  // Nothing to tear down: the database is a long-lived container that the next
  // run truncates. Dropping it here would make a re-run slower for no benefit,
  // and `reset.ts` already guarantees isolation between tests.
}
