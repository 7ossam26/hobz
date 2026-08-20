import { PrismaClient } from '@prisma/client'

/**
 * The Prisma client singleton.
 *
 * Services never import this — they take a client as a parameter (CLAUDE.md
 * "dependency-injected Prisma client"). Only actions, queries, jobs and the
 * seed reach for the singleton. That is what keeps `modules/*\/service.ts`
 * unit-testable without a database.
 */

declare global {
  var __virallapPrisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

export const prisma: PrismaClient = globalThis.__virallapPrisma ?? createPrismaClient()

// Next.js dev server hot-reloads modules; without this every reload would open
// a fresh connection pool until Postgres refuses new connections.
if (process.env.NODE_ENV !== 'production') {
  globalThis.__virallapPrisma = prisma
}

/**
 * The structural type every service depends on. Accepts both `PrismaClient`
 * and a transaction client, so a service can be composed inside a caller's
 * transaction without knowing about it.
 */
export type Db = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

/** Full client — required where an interactive transaction must be opened. */
export type DbClient = PrismaClient
