import { PERMISSIONS, buildActor, type Actor, type Permission } from '@/lib/rbac'

/**
 * `actingAs(user, permissions[])` from docs/TESTING.md §1.
 *
 * Builds the same `Actor` shape the session layer will produce in Phase 1, so a
 * permission test exercises the real `can()` path rather than a test-only stub.
 */

let counter = 0

export interface ActingAsOptions {
  id?: string
  username?: string
  superAdmin?: boolean
  impersonatorId?: string
}

export function actingAs(
  permissions: readonly Permission[] = [],
  options: ActingAsOptions = {},
): Actor {
  counter += 1
  return buildActor({
    id: options.id ?? `user_${counter}`,
    username: options.username ?? `user${counter}`,
    roleNamesEn: options.superAdmin ? ['SUPER_ADMIN'] : ['MEMBER'],
    permissionKeys: [...permissions],
    ...(options.impersonatorId ? { impersonatorId: options.impersonatorId } : {}),
  })
}

export function superAdmin(options: Omit<ActingAsOptions, 'superAdmin'> = {}): Actor {
  return actingAs([], { ...options, superAdmin: true })
}

/** A non-super-admin holding literally every catalog permission. */
export function omnipotentMember(options: ActingAsOptions = {}): Actor {
  return actingAs(PERMISSIONS, options)
}

/** An authenticated user with no permissions at all — the denial baseline. */
export function nobody(options: ActingAsOptions = {}): Actor {
  return actingAs([], options)
}
