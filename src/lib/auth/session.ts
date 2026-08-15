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
export async function getSessionState(): Promise<SessionState> {
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
}

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
