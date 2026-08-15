import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { assertCan } from '@/lib/rbac'

import { listClientsSchema, type ListClientsInput } from './schema'
import { getClient, listClientOptions, listClients } from './service'
import type { ClientDetailDto, ClientPageDto } from './types'

/**
 * modules/client/queries.ts — read paths, permission-checked here rather than
 * in the page (CLAUDE.md invariant 3).
 *
 * `client.view` is all-or-nothing, per the SPEC §6 catalog — there is no
 * `client.view.assigned`, so there is no row-level scope fragment to spread in.
 * Soft delete is still filtered in every `where` (invariant 8).
 */

export async function getClients(
  raw: Partial<ListClientsInput> = {},
): Promise<ClientPageDto> {
  const actor = await requireActor()
  assertCan(actor, 'client.view')
  return listClients(prisma, listClientsSchema.parse(raw))
}

export async function getClientById(id: string): Promise<ClientDetailDto> {
  const actor = await requireActor()
  assertCan(actor, 'client.view')
  return getClient(prisma, id)
}

/**
 * The client picker for the project form. Gated by `client.view` — a user
 * without it cannot see client names, including as a dropdown.
 */
export async function getClientOptions(): Promise<Array<{ id: string; name: string }>> {
  const actor = await requireActor()
  assertCan(actor, 'client.view')
  return listClientOptions(prisma)
}
