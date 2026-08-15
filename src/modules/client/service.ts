import { recordAudit } from '@/lib/audit'
import type { Db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import type { Actor } from '@/lib/rbac'
import { normalizeArabic } from '@/lib/search'

import type { CreateClientInput, ListClientsInput, UpdateClientInput } from './schema'
import type { ClientDetailDto, ClientPageDto, ClientSummaryDto } from './types'

/**
 * modules/client/service.ts — pure functions, dependency-injected Prisma
 * client, no `next/*` import (CLAUDE.md architecture rules).
 *
 * The client record is deliberately thin (SPEC §2: "Clients: lightweight
 * label on a project... No money-in tracking"). There is no financial field
 * to guard here, which is the point — a `client.manage` holder cannot touch
 * money through this module because there is none in it.
 */

const CLIENT_SELECT = {
  id: true,
  name: true,
  phone: true,
  notes: true,
  createdAt: true,
  _count: { select: { projects: { where: { deletedAt: null } } } },
} as const

type ClientRow = {
  id: string
  name: string
  phone: string | null
  notes: string | null
  createdAt: Date
  _count: { projects: number }
}

function toDto(row: ClientRow): ClientSummaryDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    projectCount: row._count.projects,
    createdAt: row.createdAt,
  }
}

export async function listClients(
  db: Db,
  input: ListClientsInput,
): Promise<ClientPageDto> {
  // A search term needs Arabic-aware matching, not a raw Postgres `ILIKE`.
  // `contains`/`mode: 'insensitive'` case-folds but does not fold alef/hamza,
  // ya/alef-maksura or ta-marbuta variants — a manager typing `احمد` (no
  // hamza, how most people type) would never find a client stored as
  // `أحمد للمقاولات`, exactly the failure `lib/search.ts` documents and fixes
  // for the command palette. Postgres cannot run that fold table inside a
  // `WHERE` clause, so — following the same precedent as
  // `modules/search/queries.ts` (Phase 2 DECISIONS.md: fetch the whole
  // candidate set once, at SPEC §2's capped ~100-user/entity scale, and match
  // in application code) — the candidate rows are fetched unfiltered by name
  // and folded/matched/paginated here instead.
  if (input.search) {
    const needle = normalizeArabic(input.search)
    const candidates = await db.client.findMany({
      where: { deletedAt: null },
      select: CLIENT_SELECT,
      orderBy: { name: 'asc' },
    })
    const matched = candidates.filter((row) => normalizeArabic(row.name).includes(needle))
    const start = (input.page - 1) * input.pageSize
    const page = matched.slice(start, start + input.pageSize)
    return {
      items: page.map(toDto),
      total: matched.length,
      page: input.page,
      pageSize: input.pageSize,
    }
  }

  const where = { deletedAt: null }

  const [rows, total] = await Promise.all([
    db.client.findMany({
      where,
      select: CLIENT_SELECT,
      orderBy: { name: 'asc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.client.count({ where }),
  ])

  return { items: rows.map(toDto), total, page: input.page, pageSize: input.pageSize }
}

export async function getClient(db: Db, id: string): Promise<ClientDetailDto> {
  const row = await db.client.findFirst({
    where: { id, deletedAt: null },
    select: CLIENT_SELECT,
  })
  if (!row) throw new NotFoundError('Client', id)
  return toDto(row)
}

/** Every client this actor may attach to a project — no pagination, capped by SPEC §2 scale. */
export async function listClientOptions(
  db: Db,
): Promise<Array<{ id: string; name: string }>> {
  return db.client.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

export interface ClientMutationArgs {
  actor: Actor
  ip?: string | undefined
}

export async function createClient(
  db: Db,
  args: ClientMutationArgs & { input: CreateClientInput },
): Promise<ClientDetailDto> {
  const { input } = args

  const client = await db.client.create({
    data: { name: input.name, phone: input.phone, notes: input.notes },
    select: { id: true },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'client.created',
    entity: 'Client',
    entityId: client.id,
    after: { name: input.name, phone: input.phone, notes: input.notes },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return getClient(db, client.id)
}

export async function updateClient(
  db: Db,
  args: ClientMutationArgs & { input: UpdateClientInput },
): Promise<ClientDetailDto> {
  const { input } = args

  const before = await db.client.findFirst({
    where: { id: input.id, deletedAt: null },
    select: { id: true, name: true, phone: true, notes: true },
  })
  if (!before) throw new NotFoundError('Client', input.id)

  await db.client.update({
    where: { id: before.id },
    data: { name: input.name, phone: input.phone, notes: input.notes },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'client.updated',
    entity: 'Client',
    entityId: before.id,
    before: { name: before.name, phone: before.phone, notes: before.notes },
    after: { name: input.name, phone: input.phone, notes: input.notes },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return getClient(db, before.id)
}

/**
 * Soft-delete (CLAUDE.md invariant 8, SPEC §2: "Soft-delete everywhere").
 * Projects referencing this client keep their `clientId` — the relation is
 * `SetNull` only on a hard delete, which this never performs — so a project's
 * history is unaffected; the read paths that join the client for display
 * simply stop being able to find it via the scoped list.
 */
export async function deleteClient(
  db: Db,
  args: ClientMutationArgs & { id: string },
): Promise<void> {
  const client = await db.client.findFirst({
    where: { id: args.id, deletedAt: null },
    select: { id: true, name: true },
  })
  if (!client) throw new NotFoundError('Client', args.id)

  await db.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } })

  await recordAudit(db, {
    actor: args.actor,
    action: 'client.deleted',
    entity: 'Client',
    entityId: client.id,
    before: { deletedAt: null },
    after: { deletedAt: new Date().toISOString() },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}
