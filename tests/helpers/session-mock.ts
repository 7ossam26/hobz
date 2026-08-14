import { UnauthenticatedError } from '@/lib/errors'
import {
  createRequireAuth,
  createRequirePermission,
  type Actor,
  type RequireAuth,
  type RequirePermission,
} from '@/lib/rbac'

/**
 * A stand-in for `@/lib/auth/session` in the integration suite.
 *
 *   vi.mock('@/lib/auth/session', () => import('@tests/helpers/session-mock'))
 *
 * ── What this does and does not fake ───────────────────────────────────────
 *
 * It fakes **only** how the actor is obtained. `requirePermission` here is
 * built by the same `createRequirePermission` factory the real module uses, so
 * the permission check an integration test exercises is the production one,
 * against a real `Actor` assembled from real database rows.
 *
 * What is replaced is the Auth.js round trip — reading a JWT out of a cookie,
 * which needs a `Request` that does not exist in a Vitest process. That path is
 * covered instead by the Playwright flow, which drives a real browser through a
 * real sign-in.
 */

let current: Actor | null = null

export function setSessionActor(actor: Actor | null): void {
  current = actor
}

export function clearSessionActor(): void {
  current = null
}

export async function getActor(): Promise<Actor | null> {
  return current
}

export async function getSessionState(): Promise<{
  actor: Actor | null
  mustChangePassword: boolean
}> {
  return { actor: current, mustChangePassword: false }
}

export async function requireActor(): Promise<Actor> {
  if (!current) throw new UnauthenticatedError()
  return current
}

export const requirePermission: RequirePermission = createRequirePermission(requireActor)
export const requireAuth: RequireAuth = createRequireAuth(requireActor)
