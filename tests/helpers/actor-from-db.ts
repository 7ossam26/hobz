import type { PrismaClient } from '@prisma/client'

import { resolveActor } from '@/lib/auth/resolve'
import type { Actor } from '@/lib/rbac'

/**
 * Build an `Actor` the way production does — from real rows, through the real
 * `resolveActor`.
 *
 * Integration tests use this rather than `actingAs()` from `helpers/auth.ts`.
 * The difference matters: `actingAs` hands you the permission set you asked
 * for, so a test using it proves the check works given a correct actor. This
 * one proves the actor is *assembled* correctly too — roles flattened,
 * soft-deleted roles excluded, SUPER_ADMIN recognised by name.
 */
export async function actorFor(db: PrismaClient, userId: string): Promise<Actor> {
  const resolved = await resolveActor(db, userId)
  if (!resolved) throw new Error(`No resolvable actor for user ${userId}`)
  return resolved.actor
}

/** As above, but returns null for a deactivated or soft-deleted user. */
export async function maybeActorFor(
  db: PrismaClient,
  userId: string,
): Promise<Actor | null> {
  return (await resolveActor(db, userId))?.actor ?? null
}
