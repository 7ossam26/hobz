'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requireAuth, requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { DomainError } from '@/lib/errors'
import { can } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'

import { decideLeaveSchema, requestLeaveSchema } from './schema'
import { decideLeave, requestLeave } from './service'
import type { LeaveDto } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate
 * (CLAUDE.md invariant 3).
 *
 * `requestLeaveAction` is gated by `requireAuth` rather than a permission key,
 * because SPEC §6 has none for "ask for time off" and inventing one would be
 * inventing a permission. What it enforces instead is *whose* leave: anybody
 * may file their own, and only a `leave.manage` holder may file — and
 * therefore immediately approve — somebody else's.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

async function leaveTypes() {
  return getSetting('calendar.leaveTypes')
}

export const requestLeaveAction = requireAuth(
  async (actor, raw: unknown): Promise<LeaveDto> => {
    const input = requestLeaveSchema.parse(raw)
    const manages = can(actor, 'leave.manage')

    if (input.userId !== actor.id && !manages) {
      throw new DomainError('leave.errors.notOwn', { userId: input.userId })
    }

    const leave = await requestLeave(prisma, {
      actor,
      input,
      leaveTypes: await leaveTypes(),
      // A manager recording leave for someone else has already made the
      // decision; making them approve their own entry afterwards would be
      // ceremony, and the audit row says `leave.recorded` so the two paths
      // stay distinguishable.
      autoApprove: manages && input.userId !== actor.id,
      ip: await ip(),
    })

    revalidatePath('/leave')
    return leave
  },
)

export const decideLeaveAction = requirePermission(
  'leave.manage',
  async (actor, raw: unknown): Promise<LeaveDto> => {
    const input = decideLeaveSchema.parse(raw)
    const leave = await decideLeave(prisma, { actor, input, ip: await ip() })
    revalidatePath('/leave')
    // An approval changes what every one of that person's deadlines is
    // measured against (SPEC §5.3), so the task views are stale too.
    revalidatePath('/tasks')
    return leave
  },
)
