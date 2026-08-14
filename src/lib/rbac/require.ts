import { assertCan, type Actor } from './actor'
import type { Permission } from './catalog'

/**
 * `requirePermission()` — the wrapper every server action is built from.
 *
 * It fixes the order CLAUDE.md invariant 3 mandates, so that no action can get
 * it wrong by accident:
 *
 *   1. session      — resolve the actor, throw `UnauthenticatedError` if none
 *   2. permission   — `assertCan`, throw `ForbiddenError` if missing
 *   3. validation   — the handler's first line is `schema.parse(raw)`
 *   4. service      — the pure, DB-injected function that does the work
 *
 * Steps 1 and 2 happen *before the handler body runs at all*, which is what
 * makes "must throw and must not mutate" true by construction rather than by
 * review: an unprivileged caller never reaches a line that can write.
 *
 * ── Why this is a factory ──────────────────────────────────────────────────
 *
 * The actor resolver is injected rather than imported. `lib/rbac` therefore
 * stays free of any dependency on `lib/auth` — no import cycle, and no Next.js
 * in the way — so the wrapper itself is unit-testable with a fake resolver.
 * `lib/auth` binds it to the real session once, and actions import it from
 * there.
 */

export type ActorResolver = () => Promise<Actor>

export type RequirePermission = <A extends unknown[], R>(
  permission: Permission,
  handler: (actor: Actor, ...args: A) => Promise<R>,
) => (...args: A) => Promise<R>

export type RequireAuth = <A extends unknown[], R>(
  handler: (actor: Actor, ...args: A) => Promise<R>,
) => (...args: A) => Promise<R>

export function createRequirePermission(resolveActor: ActorResolver): RequirePermission {
  return (permission, handler) =>
    async (...args) => {
      const actor = await resolveActor()
      assertCan(actor, permission)
      return handler(actor, ...args)
    }
}

/**
 * For the handful of actions that every authenticated user may call regardless
 * of role: sign out, change *your own* password, exit impersonation.
 *
 * Deliberately a separate, named export rather than
 * `requirePermission(undefined, …)` — "this action has no permission gate" is a
 * claim that should be visible at the call site and greppable in review.
 */
export function createRequireAuth(resolveActor: ActorResolver): RequireAuth {
  return (handler) =>
    async (...args) => {
      const actor = await resolveActor()
      return handler(actor, ...args)
    }
}
