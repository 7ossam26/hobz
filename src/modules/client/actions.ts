'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'

import { clientIdSchema, createClientSchema, updateClientSchema } from './schema'
import { createClient, deleteClient, updateClient } from './service'
import type { ClientDetailDto } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate
 * (CLAUDE.md invariant 3). All three gate on `client.manage` — the SPEC §6
 * catalog has no split between create/edit/delete for clients.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

export const createClientAction = requirePermission(
  'client.manage',
  async (actor, raw: unknown): Promise<ClientDetailDto> => {
    const input = createClientSchema.parse(raw)
    const client = await createClient(prisma, { actor, input, ip: await ip() })
    revalidatePath('/clients')
    return client
  },
)

export const updateClientAction = requirePermission(
  'client.manage',
  async (actor, raw: unknown): Promise<ClientDetailDto> => {
    const input = updateClientSchema.parse(raw)
    const client = await updateClient(prisma, { actor, input, ip: await ip() })
    revalidatePath('/clients')
    revalidatePath('/projects')
    return client
  },
)

export const deleteClientAction = requirePermission(
  'client.manage',
  async (actor, raw: unknown): Promise<void> => {
    const { id } = clientIdSchema.parse(raw)
    await deleteClient(prisma, { actor, id, ip: await ip() })
    revalidatePath('/clients')
    revalidatePath('/projects')
  },
)
