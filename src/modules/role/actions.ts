'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'

import { createRoleSchema, deleteRoleSchema, updateRoleSchema } from './schema'
import { createRole, deleteRole, updateRole } from './service'
import type { RoleDetailDto } from './types'

/**
 * Thin server actions. `requirePermission` fixes the order for all of them —
 * session, then permission, then Zod, then service (CLAUDE.md invariant 3) —
 * and does it *before the handler body runs*, so an unprivileged caller never
 * reaches a line that can write.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

export const createRoleAction = requirePermission(
  'role.manage',
  async (actor, raw: unknown): Promise<RoleDetailDto> => {
    const input = createRoleSchema.parse(raw)
    const requestIp = await ip()
    const role = await prisma.$transaction((tx) =>
      createRole(tx, { actor, input, ...(requestIp ? { ip: requestIp } : {}) }),
    )
    revalidatePath('/roles')
    return role
  },
)

export const updateRoleAction = requirePermission(
  'role.manage',
  async (actor, raw: unknown): Promise<RoleDetailDto> => {
    const input = updateRoleSchema.parse(raw)
    const requestIp = await ip()
    const role = await prisma.$transaction((tx) =>
      updateRole(tx, { actor, input, ...(requestIp ? { ip: requestIp } : {}) }),
    )
    revalidatePath('/roles')
    // A permission change alters what every holder may do, and the navigation
    // is rendered from that. Revalidating the whole tree is the cheap way to
    // make a revoked permission disappear from the sidebar immediately.
    revalidatePath('/', 'layout')
    return role
  },
)

export const deleteRoleAction = requirePermission(
  'role.manage',
  async (actor, raw: unknown): Promise<void> => {
    const { id } = deleteRoleSchema.parse(raw)
    await deleteRole(prisma, { actor, id, ip: await ip() })
    revalidatePath('/roles')
    revalidatePath('/', 'layout')
  },
)
