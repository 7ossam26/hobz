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
  {
    href: '/dashboard',
    labelKey: 'dashboard',
    icon: 'layout-dashboard',
    permissions: [],
  },
  {
    href: '/projects',
    labelKey: 'projects',
    icon: 'folder-kanban',
    permissions: ['project.view.all', 'project.view.assigned'],
  },
  /**
   * Phase 10's global deadlines view. No permission listed — like `/dashboard`
   * and holiday reads (SPEC §6), the page itself needs no gate because the
   * queries it composes (`getTaskCalendar`, `getProjects`) are already
   * RBAC-scoped; a user with no task/project visibility simply sees an empty
   * calendar, the same degrade-not-deny shape `scopeTasks`/`scopeProjects`
   * already commit to everywhere else.
   */
  {
    href: '/calendar',
    labelKey: 'calendar',
    icon: 'calendar-days',
    permissions: [],
  },
  {
    href: '/tasks',
    labelKey: 'tasks',
    icon: 'list-todo',
    permissions: ['task.view.all', 'task.view.assigned'],
  },
  {
    href: '/clients',
    labelKey: 'clients',
    icon: 'building-2',
    permissions: ['client.view'],
  },
  /**
   * SPEC §2's B6-vs-J3 decision: worker earnings are **not** on the worker
   * dashboard, but on their own page. This is that page, and `ledger.view.own`
   * is what puts it in somebody's sidebar.
   */
  {
    href: '/my-earnings',
    labelKey: 'myEarnings',
    icon: 'wallet',
    permissions: ['ledger.view.own'],
  },
  {
    href: '/payouts',
    labelKey: 'payouts',
    icon: 'banknote',
    permissions: ['payout.view'],
  },
  /**
   * The خصومات register (Phase 8). `penalty.view` and nothing wider: a منفّذ
   * sees their own deductions on مستحقاتي, with the same breakdown, so this
   * page is the *manager's* view and does not need a second key that would
   * quietly show one منفّذ another's pay.
   */
  {
    href: '/penalties',
    labelKey: 'penalties',
    icon: 'gavel',
    permissions: ['penalty.view'],
  },
  /** Phase 10's report hub — the four new reports plus SPEC R4's deductions one. */
  {
    href: '/reports',
    labelKey: 'reports',
    icon: 'bar-chart-3',
    permissions: ['report.view'],
  },
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
  /** Phase 11's bulk `.xlsx` import (SPEC §10). */
  {
    href: '/import',
    labelKey: 'import',
    icon: 'upload',
    permissions: ['import.run'],
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
  { prefix: '/projects', permissions: ['project.view.all', 'project.view.assigned'] },
  { prefix: '/tasks', permissions: ['task.view.all', 'task.view.assigned'] },
  { prefix: '/clients', permissions: ['client.view'] },
  { prefix: '/my-earnings', permissions: ['ledger.view.own', 'ledger.view.all'] },
  { prefix: '/payouts', permissions: ['payout.view'] },
  { prefix: '/penalties', permissions: ['penalty.view'] },
  // Longest prefix wins, so SPEC R4's report needs `report.view` even though it
  // lives under the register. The two are different questions: "what was
  // deducted from this person" and "what did the agency retain this month".
  { prefix: '/penalties/report', permissions: ['report.view'] },
  { prefix: '/reports', permissions: ['report.view'] },
  { prefix: '/users', permissions: ['user.view'] },
  { prefix: '/roles', permissions: ['role.view'] },
  { prefix: '/settings', permissions: ['settings.view'] },
  { prefix: '/audit', permissions: ['audit.view'] },
  { prefix: '/import', permissions: ['import.run'] },
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
