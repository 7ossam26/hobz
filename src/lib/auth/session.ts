import { cache } from 'react'

import { prisma } from '@/lib/db'
import { UnauthenticatedError } from '@/lib/errors'
import {
  createRequireAuth,
  createRequirePermission,
  type Actor,
  type RequireAuth,
  type RequirePermission,
} from '@/lib/rbac'

import { auth } from './next-auth'
import { resolveActor } from './resolve'

/**
 * lib/auth/session — the seam every server action and query opens with:
 *
 *   const actor = await requireActor()   // session
 *   assertCan(actor, 'settings.edit')    // permission
 *   const input = schema.parse(raw)      // zod
 *   await service.update(prisma, ...)    // service
 *
 * or, equivalently and preferably, wrapped once:
 *
 *   export const updateThing = requirePermission('thing.edit', async (actor, raw) => …)
 *
 * ── The JWT is not the authority ───────────────────────────────────────────
 *
 * The token carries a permission set, and this function ignores it. Permissions
 * are re-read from the database on every call, because a JWT minted this
 * morning would otherwise keep granting a permission an admin revoked at noon —
 * and "revoke" that takes effect at next sign-out is not a revoke. The token's
 * copy exists for the middleware, which runs at the edge where Prisma does not.
 *
 * ── Once per request, not once per caller ──────────────────────────────────
 *
 * "Re-read on every call" was taken literally, and it cost more than anyone
 * checked. `resolveActor` is four statements (Prisma issues one per relation
 * level), and a single `/tasks` render called it six times — the layout, the
 * header's notification read, the page, and each of the four scoped queries —
 * for **17 of the 25 statements that render issued**, plus a JWE decode each
 * time.
 *
 * `cache()` scopes one resolution to one request. The invariant is untouched:
 * every *request* still re-reads permissions from the database, which is what
 * makes a revoke take effect at noon. What it stops is the same request asking
 * the same question six times. The trade, named: a server action that changed
 * its own actor's roles and then re-read them within the same request would see
 * the pre-change answer — no path does (`updateUserAction` resolves the actor
 * once, before the write, and the next request re-resolves).
 */

export interface SessionState {
  actor: Actor | null
  /** True when the user must change their password before doing anything else. */
  mustChangePassword: boolean
}

/**
 * Resolve the current identity, honouring impersonation.
 *
 * While impersonating, the returned actor **is** the impersonated user — same
 * permissions, same row-level scope — with the real SUPER_ADMIN recorded in
 * `impersonatorId` so every audit row names both (SPEC Phase 1 §5). Giving the
 * impersonator their own permissions instead would defeat the purpose: the
 * point of "عرض كـ" is to see what that person sees.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { actor: null, mustChangePassword: false }

  const impersonatorId = session.impersonator?.id

  if (impersonatorId) {
    // Re-verify on every request. A super admin whose role was stripped
    // mid-impersonation must not keep the elevated session alive.
    const admin = await resolveActor(prisma, impersonatorId)
    if (!admin?.actor.isSuperAdmin) {
      return { actor: null, mustChangePassword: false }
    }

    const impersonated = await resolveActor(prisma, userId, {
      impersonator: { id: admin.actor.id, fullName: admin.actor.fullName },
    })
    if (!impersonated) return { actor: null, mustChangePassword: false }

    return {
      actor: impersonated.actor,
      // Never force the *impersonated* user's password change onto the admin
      // who is only looking. It is not their password to change.
      mustChangePassword: false,
    }
  }

  const resolved = await resolveActor(prisma, userId)
  if (!resolved) return { actor: null, mustChangePassword: false }

  return { actor: resolved.actor, mustChangePassword: resolved.mustChangePassword }
})

export async function getActor(): Promise<Actor | null> {
  return (await getSessionState()).actor
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) throw new UnauthenticatedError()
  return actor
}

/**
 * The wrappers actions are built from. Bound here, once, so that no action can
 * accidentally build its own with a different resolver.
 */
export const requirePermission: RequirePermission = createRequirePermission(requireActor)

export const requireAuth: RequireAuth = createRequireAuth(requireActor)
