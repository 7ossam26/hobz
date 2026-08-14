import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'

import { SUPER_ADMIN_ROLE, type Permission } from './catalog'

/**
 * The identity every permission decision is made against. Resolved once per
 * request by `lib/auth` and carried through queries, actions and services.
 *
 * `permissions` is the *flattened* set from all of the user's roles. Resolving
 * it up front — rather than joining on every check — is what keeps `can()`
 * synchronous, and therefore cheap enough to call inside a render loop when the
 * navigation decides which links to draw.
 */
export interface Actor {
  id: string
  username: string
  fullName: string
  isSuperAdmin: boolean
  permissions: ReadonlySet<Permission>
  /**
   * Set only while a SUPER_ADMIN is viewing the app as someone else. The actor
   * *is* the impersonated user — same permissions, same scope — and this field
   * is what makes the real identity survive into the audit row (SPEC Phase 1 §5).
   */
  impersonatorId?: string
  /** Real identity's display name, for the impersonation banner. */
  impersonatorName?: string
}

export function can(actor: Actor | null, permission: Permission): boolean {
  if (!actor) return false
  // SUPER_ADMIN implicitly holds every permission, including ones that do not
  // exist yet (SPEC §2). Never expand this into a stored list — a materialised
  // list goes stale the moment a later phase adds a permission key.
  if (actor.isSuperAdmin) return true
  return actor.permissions.has(permission)
}

export function canAny(actor: Actor | null, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(actor, p))
}

export function canAll(actor: Actor | null, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => can(actor, p))
}

/**
 * Throws rather than returns. Every server action calls this immediately after
 * resolving the session and before touching Zod or the service
 * (CLAUDE.md invariant 3).
 */
export function assertCan(
  actor: Actor | null,
  permission: Permission,
): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError()
  if (!can(actor, permission)) throw new ForbiddenError(permission)
}

export function isSuperAdminRole(roleNameEn: string): boolean {
  return roleNameEn === SUPER_ADMIN_ROLE
}

export function isImpersonating(actor: Actor | null): boolean {
  return actor?.impersonatorId !== undefined
}

/**
 * Build an Actor from the role/permission rows loaded for a user. Kept here so
 * the session layer and the tests agree on how flattening works — a second,
 * drifting implementation in a test helper would let a real bug pass.
 */
export function buildActor(input: {
  id: string
  username: string
  fullName?: string
  roleNamesEn: readonly string[]
  permissionKeys: readonly string[]
  impersonatorId?: string
  impersonatorName?: string
}): Actor {
  const isSuperAdmin = input.roleNamesEn.some(isSuperAdminRole)
  return {
    id: input.id,
    username: input.username,
    fullName: input.fullName ?? input.username,
    isSuperAdmin,
    permissions: new Set(input.permissionKeys as Permission[]),
    ...(input.impersonatorId ? { impersonatorId: input.impersonatorId } : {}),
    ...(input.impersonatorName ? { impersonatorName: input.impersonatorName } : {}),
  }
}
