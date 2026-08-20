import { ar } from '@/i18n/ar'

/**
 * The permission catalog — SPEC §6, verbatim and in order.
 *
 * This const is the source of truth; the `permissions` table is a projection of
 * it, refreshed by the seed. Permissions are never created from the UI. Roles
 * are (SPEC §2).
 */
export const PERMISSIONS = [
  'user.view',
  'user.create',
  'user.edit',
  'user.deactivate',
  'user.resetPassword',
  'user.impersonate',

  'role.view',
  'role.manage',

  'client.view',
  'client.manage',

  'project.view.all',
  'project.view.assigned',
  'project.create',
  'project.edit',
  'project.delete',

  'task.view.all',
  'task.view.assigned',
  'task.work.assigned',
  'task.create',
  'task.edit',
  'task.assign',
  'task.approve',
  'task.extend',
  'task.cancel',
  'task.comment',

  'calendar.manage',
  'leave.view',
  'leave.manage',

  'ledger.view.all',
  'ledger.view.own',

  'penalty.view',
  'penalty.create',
  'penalty.reverse',

  'bonus.create',
  'bonus.reverse',

  'advance.create',

  'payout.view',
  'payout.generate',
  'payout.approve',
  'payout.markPaid',

  'report.view',
  'report.export',

  'settings.view',
  'settings.edit',

  'import.run',

  'audit.view',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const PERMISSION_SET: ReadonlySet<string> = new Set<string>(PERMISSIONS)

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value)
}

/** Domain prefix, used to group the role editor and to index the DB table. */
export function permissionDomain(permission: Permission): string {
  const [domain] = permission.split('.')
  return domain ?? permission
}

/**
 * The reserved system role. Hardcoded, undeletable, uneditable, and holder of
 * every permission — including ones added in future phases, which is why `can()`
 * short-circuits on it rather than expanding it into a stored permission list.
 */
export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN'

/** The ceiling for a role automatically assigned to a newly created account. */
export const DEFAULT_ROLE_PERMISSIONS = [
  'project.view.assigned',
  'task.view.assigned',
  'task.work.assigned',
  'task.comment',
  'ledger.view.own',
] as const satisfies readonly Permission[]

const DEFAULT_ROLE_PERMISSION_SET: ReadonlySet<Permission> = new Set(
  DEFAULT_ROLE_PERMISSIONS,
)

export function isSafeDefaultRolePermission(permission: Permission): boolean {
  return DEFAULT_ROLE_PERMISSION_SET.has(permission)
}

/** Catalog rows in the shape the seed upserts. */
export function permissionSeedRows(): Array<{
  key: Permission
  domain: string
  descriptionAr: string
}> {
  return PERMISSIONS.map((key) => ({
    key,
    domain: permissionDomain(key),
    descriptionAr: ar.permissions[key],
  }))
}
