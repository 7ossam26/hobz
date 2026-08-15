import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { ForbiddenError } from '@/lib/errors'
import { can, type Actor } from '@/lib/rbac'

import { listLeaveSchema, type ListLeaveInput } from './schema'
import { getLeave, listLeave } from './service'
import type { LeaveDto, LeavePageDto } from './types'

/**
 * Read paths with RBAC scoping baked in (CLAUDE.md invariant 3).
 *
 * SPEC §6 gives leave two keys: `leave.view` and `leave.manage`. Neither is a
 * `.own` variant, and one is still needed — a منفّذ must be able to see the
 * request they filed, or they cannot tell whether Thursday is approved. So the
 * scope is: `leave.view` sees everyone, everybody else sees themselves.
 *
 * That is a widening of the SPEC §6 catalog's literal text, not of its intent
 * ("`*.view.assigned` is limited to … tasks where they are assignee"), applied
 * to the one entity whose "assigned" is simply "mine". Recorded in
 * docs/DECISIONS.md.
 */
export function scopeLeave(actor: Actor | null): Record<string, unknown> {
  if (!actor) throw new ForbiddenError('leave.view')
  if (can(actor, 'leave.view') || can(actor, 'leave.manage')) return {}
  return { userId: actor.id }
}

export async function getLeaveList(raw: unknown): Promise<LeavePageDto> {
  const actor = await requireActor()
  const filters: ListLeaveInput = listLeaveSchema.parse(raw ?? {})
  return listLeave(prisma, { filters, scope: scopeLeave(actor) })
}

export async function getLeaveById(id: string): Promise<LeaveDto> {
  const actor = await requireActor()
  const leave = await getLeave(prisma, id)

  // Scope is enforced after the read rather than inside it because a single
  // row is fetched by primary key; the check is the same one `scopeLeave`
  // expresses as a where-fragment for the list.
  const scope = scopeLeave(actor)
  if ('userId' in scope && scope.userId !== leave.user.id) {
    throw new ForbiddenError('leave.view')
  }

  return leave
}
