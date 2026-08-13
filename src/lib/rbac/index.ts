import { ForbiddenError, NotImplementedError, UnauthenticatedError } from '@/lib/errors'

import { SUPER_ADMIN_ROLE, type Permission } from './catalog'

export * from './catalog'

/**
 * The identity every permission decision is made against. Resolved once per
 * request by `lib/auth` (Phase 1) and carried through queries and actions.
 *
 * `permissions` is the *flattened* set from all of the user's roles. Resolving
 * it at session build time — rather than joining on every check — is what keeps
 * `can()` synchronous and therefore cheap enough to call in a loop.
 */
export interface Actor {
  id: string
  username: string
  isSuperAdmin: boolean
  permissions: ReadonlySet<Permission>
  /** Set only while a SUPER_ADMIN is impersonating; both identities are audited. */
  impersonatorId?: string
}

export function can(actor: Actor | null, permission: Permission): boolean {
  if (!actor) return false
  // SUPER_ADMIN implicitly holds every permission, including ones that do not
  // exist yet (SPEC §2). Never expand this into a stored list.
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

/**
 * Build an Actor from the role/permission rows loaded for a user. Kept here so
 * the session layer and the tests agree on how flattening works.
 */
export function buildActor(input: {
  id: string
  username: string
  roleNamesEn: readonly string[]
  permissionKeys: readonly string[]
  impersonatorId?: string
}): Actor {
  const isSuperAdmin = input.roleNamesEn.some(isSuperAdminRole)
  return {
    id: input.id,
    username: input.username,
    isSuperAdmin,
    permissions: new Set(input.permissionKeys as Permission[]),
    ...(input.impersonatorId ? { impersonatorId: input.impersonatorId } : {}),
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Scoping — Phase 1.
//
// These return Prisma `where` fragments so that `view.all` vs `view.assigned`
// is enforced *inside the query* (CLAUDE.md invariant 3). They are stubs rather
// than permissive defaults on purpose: a stub that returned `{}` would silently
// grant every user access to every project the moment a caller wired it up.
// ───────────────────────────────────────────────────────────────────────────

/** Prisma where-fragment. Typed loosely here; Phase 1 narrows to the real model types. */
export type ScopeFilter = Record<string, unknown>

export function scopeProjects(_actor: Actor): ScopeFilter {
  throw new NotImplementedError('rbac.scopeProjects', 'Phase 1')
}

export function scopeTasks(_actor: Actor): ScopeFilter {
  throw new NotImplementedError('rbac.scopeTasks', 'Phase 1')
}
