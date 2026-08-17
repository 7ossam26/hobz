import type { Db } from '@/lib/db'

/**
 * modules/import/resolve.ts — human-readable foreign-key resolution (SPEC
 * §10 item 5): project by code, user by username, client by name.
 *
 * A client has no unique column in the schema (`prisma/schema.prisma`'s
 * `Client.name` carries no `@unique`), so a name can genuinely match more
 * than one row — `'ambiguous'` says so explicitly rather than silently
 * picking the first match, which would attach a project to the wrong client
 * on a coin flip.
 */

export async function findUserByUsername(
  db: Db,
  username: string,
): Promise<{ id: string; isActive: boolean; defaultTaskRate: string | null } | null> {
  const row = await db.user.findFirst({
    where: { username, deletedAt: null },
    select: { id: true, isActive: true, defaultTaskRate: true },
  })
  if (!row) return null
  return {
    id: row.id,
    isActive: row.isActive,
    defaultTaskRate: row.defaultTaskRate ? row.defaultTaskRate.toFixed(2) : null,
  }
}

export async function findProjectByCode(
  db: Db,
  code: string,
): Promise<{ id: string } | null> {
  return db.project.findFirst({ where: { code, deletedAt: null }, select: { id: true } })
}

export type ClientLookup = { id: string } | 'not_found' | 'ambiguous'

export async function findClientByName(db: Db, name: string): Promise<ClientLookup> {
  const rows = await db.client.findMany({
    where: { name, deletedAt: null },
    select: { id: true },
    take: 2,
  })
  if (rows.length === 0) return 'not_found'
  if (rows.length > 1) return 'ambiguous'
  const [row] = rows
  return row ? { id: row.id } : 'not_found'
}
