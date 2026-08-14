import type { Db } from '@/lib/db'
import { buildActor, type Actor } from '@/lib/rbac'

/**
 * lib/auth/resolve — turn a user id into an `Actor`.
 *
 * This is the authoritative resolution, and it always hits the database. The
 * JWT carries a copy of the permission set (see `config.ts`) but that copy is
 * only ever trusted by the middleware, which does cosmetic routing at the edge.
 * Anything that can read or write goes through this function first.
 *
 * The reason is staleness. A JWT lives for days; a role edit takes effect the
 * moment it is saved. If the query layer trusted the token, revoking someone's
 * `payout.approve` would not actually revoke anything until they happened to
 * sign out — which is not what any manager clicking "save" believes they just
 * did. At ~100 users this is one indexed query per request, and correctness is
 * worth more than it costs.
 */

/** Deleted roles grant nothing (CLAUDE.md invariant 8). */
const ACTOR_SELECT = {
  id: true,
  username: true,
  fullName: true,
  isActive: true,
  mustChangePassword: true,
  deletedAt: true,
  roles: {
    where: { role: { deletedAt: null } },
    select: {
      role: {
        select: {
          nameEn: true,
          permissions: { select: { permissionKey: true } },
        },
      },
    },
  },
} as const

export interface ResolvedUser {
  actor: Actor
  mustChangePassword: boolean
}

export interface ResolveOptions {
  /**
   * The real SUPER_ADMIN behind an impersonated session. Stamped onto the
   * actor so `recordAudit` can write both identities (SPEC Phase 1 §5).
   */
  impersonator?: { id: string; fullName: string }
}

/**
 * `null` for a user who does not exist, is soft-deleted, or is deactivated.
 *
 * All three collapse to the same answer on purpose: a deactivated account must
 * stop working immediately, including for a session that was already signed in
 * when the deactivation happened.
 */
export async function resolveActor(
  db: Db,
  userId: string,
  options: ResolveOptions = {},
): Promise<ResolvedUser | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: ACTOR_SELECT,
  })

  if (!user || user.deletedAt !== null || !user.isActive) return null

  const roleNamesEn = user.roles.map((r) => r.role.nameEn)
  const permissionKeys = user.roles.flatMap((r) =>
    r.role.permissions.map((p) => p.permissionKey),
  )

  return {
    actor: buildActor({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roleNamesEn,
      permissionKeys,
      ...(options.impersonator
        ? {
            impersonatorId: options.impersonator.id,
            impersonatorName: options.impersonator.fullName,
          }
        : {}),
    }),
    mustChangePassword: user.mustChangePassword,
  }
}

// A `findUserForLogin` helper lived here and was deleted: `authenticate` in
// modules/auth/service does its own lookup, so this was an unused second path
// that could read a password hash. Dead code in an auth module is not neutral —
// it is a function someone will reach for later without the surrounding checks.
