'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'

import { recordAudit } from '@/lib/audit'
import { setImpersonation } from '@/lib/auth/impersonation'
import { clientIpFromHeaders } from '@/lib/auth/ip'
import { resolveActor } from '@/lib/auth/resolve'
import { getSessionState, requireAuth, requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { DomainError } from '@/lib/errors'

/**
 * Impersonation — "عرض كـ".
 *
 * SUPER_ADMIN only, and gated three times over, because a hole here is total:
 *
 *   1. `requirePermission('user.impersonate')` — the catalog permission
 *   2. `actor.isSuperAdmin` — the phase brief says SUPER_ADMIN *only*, and the
 *      permission alone is not enough; a role could be granted it by mistake
 *   3. the `jwt` callback in `lib/auth/config.ts` re-checks against the
 *      database when the token is minted, so an action that forgot 1 and 2
 *      still could not produce an impersonated token
 *
 * While impersonating, the actor *is* the target — same permissions, same row
 * scope — with the real identity in `impersonatorId`, so every audit row names
 * both people (SPEC Phase 1 §5).
 */

const startSchema = z.object({ userId: z.string().min(1) })

export const startImpersonationAction = requirePermission(
  'user.impersonate',
  async (actor, raw: unknown): Promise<void> => {
    if (!actor.isSuperAdmin) throw new DomainError('impersonation.notAllowed')
    if (actor.impersonatorId) throw new DomainError('impersonation.alreadyImpersonating')

    const { userId } = startSchema.parse(raw)
    if (userId === actor.id) throw new DomainError('impersonation.cannotImpersonateSelf')

    // `resolveActor` returns null for a deleted or deactivated user, which is
    // what makes "view as a disabled account" impossible rather than merely
    // discouraged.
    const target = await resolveActor(prisma, userId)
    if (!target) throw new DomainError('impersonation.cannotImpersonateInactive')

    await recordAudit(prisma, {
      actor,
      action: 'impersonation.started',
      entity: 'User',
      entityId: userId,
      after: { impersonatedUsername: target.actor.username },
      ip: clientIpFromHeaders(await headers()),
    })

    await setImpersonation(userId)
    revalidatePath('/', 'layout')
  },
)

/**
 * Exit impersonation.
 *
 * Gated by `requireAuth` rather than `requirePermission`: the actor at this
 * point is the *impersonated* user, who by definition does not hold
 * `user.impersonate`. Requiring it would trap the admin inside the session they
 * are trying to leave.
 */
export const stopImpersonationAction = requireAuth(async (actor): Promise<void> => {
  const { actor: current } = await getSessionState()
  if (!current?.impersonatorId) return

  await recordAudit(prisma, {
    actor,
    action: 'impersonation.stopped',
    entity: 'User',
    entityId: actor.id,
    ip: clientIpFromHeaders(await headers()),
  })

  await setImpersonation(null)
  revalidatePath('/', 'layout')
})
