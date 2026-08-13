import { PrismaClient } from '@prisma/client'

import { assertTestDatabase } from './db-guard'

/**
 * Truncate-between-tests isolation (docs/TESTING.md §2).
 *
 * TRUNCATE, never DROP: the schema is created once by the migrations in
 * global-setup and must survive the whole run. `RESTART IDENTITY CASCADE` also
 * keeps sequence-derived values deterministic across tests.
 */

let client: PrismaClient | null = null

export function testDb(): PrismaClient {
  assertTestDatabase()
  client ??= new PrismaClient()
  return client
}

/** Tables the reset must never touch. `_prisma_migrations` is the schema itself. */
const PROTECTED_TABLES = new Set(['_prisma_migrations'])

export async function resetDatabase(): Promise<void> {
  assertTestDatabase()
  const db = testDb()

  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `

  const targets = tables
    .map((t) => t.tablename)
    .filter((name) => !PROTECTED_TABLES.has(name))
    .map((name) => `"public"."${name}"`)

  if (targets.length === 0) return

  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${targets.join(', ')} RESTART IDENTITY CASCADE`,
  )
}

export async function disconnectTestDb(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = null
  }
}
