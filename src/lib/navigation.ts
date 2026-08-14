import { canAny, type Actor } from '@/lib/rbac'
import type { Permission } from '@/lib/rbac'

/**
 * lib/navigation — the route table, and which permission each route needs.
 *
 * One list, two consumers: the sidebar decides what to *draw* from it, and the
 * middleware decides what to *let through*. Keeping them on the same data is
 * what stops the two from disagreeing — a link that renders and then 403s is a
 * worse experience than no link at all, and a route that is unlinked but
 * unguarded is a hole.
 *
 * To be explicit about what this is not: **this file is not the enforcement.**
 * Hiding a link is cosmetic and the middleware runs on a JWT copy of the
 * permission set that can be a few minutes stale. The enforcement is
 * `assertCan` in `queries.ts` and `requirePermission` on every action, against
 * permissions re-read from the database (CLAUDE.md invariant 3).
 */

export interface NavItem {
  href: string
  /** Key into `ar.nav`. */
  labelKey: string
  /** Icon name, resolved to a component in the client nav. */
  icon: string
  /** Visible when the actor holds ANY of these. Empty means "any signed-in user". */
  permissions: readonly Permission[]
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: 'layout-dashboard', permissions: [] },
  {
    href: '/users',
    labelKey: 'users',
    icon: 'users',
    permissions: ['user.view'],
  },
  {
    href: '/roles',
    labelKey: 'roles',
    icon: 'shield',
    permissions: ['role.view'],
  },
  {
    href: '/settings',
    labelKey: 'settings',
    icon: 'settings',
    permissions: ['settings.view'],
  },
  {
    href: '/audit',
    labelKey: 'auditLog',
    icon: 'scroll-text',
    permissions: ['audit.view'],
  },
] as const

export function visibleNavItems(actor: Actor | null): NavItem[] {
  if (!actor) return []
  return NAV_ITEMS.filter(
    (item) => item.permissions.length === 0 || canAny(actor, item.permissions),
  )
}

/**
 * Route prefix → the permissions that can open it. Longest prefix wins, so
 * `/users/new` inherits `/users` without a second entry.
 *
 * Only routes that exist are listed. An unlisted route under `/(app)` is
 * reachable by any signed-in user, which is correct for `/dashboard` and
 * `/change-password` and is why every data-bearing route is listed here.
 */
export const ROUTE_PERMISSIONS: ReadonlyArray<{
  prefix: string
  permissions: readonly Permission[]
}> = [
  { prefix: '/users', permissions: ['user.view'] },
  { prefix: '/roles', permissions: ['role.view'] },
  { prefix: '/settings', permissions: ['settings.view'] },
  { prefix: '/audit', permissions: ['audit.view'] },
] as const

export function permissionsForRoute(pathname: string): readonly Permission[] | null {
  let best: { prefix: string; permissions: readonly Permission[] } | null = null

  for (const entry of ROUTE_PERMISSIONS) {
    const matches = pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)
    if (matches && (!best || entry.prefix.length > best.prefix.length)) best = entry
  }

  return best?.permissions ?? null
}

/**
 * The middleware's check, written against the JWT's permission array rather
 * than an `Actor` — the Edge runtime has no database to build one from.
 */
export function routeAllowedByToken(
  pathname: string,
  token: { isSuperAdmin: boolean; permissions: readonly string[] } | null,
): boolean {
  const required = permissionsForRoute(pathname)
  if (!required) return true
  if (!token) return false
  if (token.isSuperAdmin) return true
  return required.some((p) => token.permissions.includes(p))
}
