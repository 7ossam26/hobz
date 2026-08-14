import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { assertCan } from '@/lib/rbac'

import { getRole, listRoles, permissionGroups } from './service'
import type { PermissionGroupDto, RoleDetailDto, RoleSummaryDto } from './types'

/**
 * Read paths, with the permission check baked in (CLAUDE.md invariant 3).
 *
 * The check lives here rather than in the page because the page is not the only
 * caller — the user editor needs the role list too, and a check in one route
 * component is a check the other route forgot.
 *
 * Roles are global, so there is no row-level scoping to apply.
 */

export async function getRoles(): Promise<RoleSummaryDto[]> {
  const actor = await requireActor()
  assertCan(actor, 'role.view')
  return listRoles(prisma)
}

export async function getRoleById(id: string): Promise<RoleDetailDto> {
  const actor = await requireActor()
  assertCan(actor, 'role.view')
  return getRole(prisma, id)
}

export async function getPermissionGroups(): Promise<PermissionGroupDto[]> {
  const actor = await requireActor()
  assertCan(actor, 'role.view')
  return permissionGroups()
}
