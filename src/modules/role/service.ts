import { ar } from '@/i18n/ar'
import { recordAudit } from '@/lib/audit'
import type { Db } from '@/lib/db'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import {
  PERMISSIONS,
  SUPER_ADMIN_ROLE,
  permissionDomain,
  type Actor,
  type Permission,
} from '@/lib/rbac'

import type { CreateRoleInput, UpdateRoleInput } from './schema'
import type { PermissionGroupDto, RoleDetailDto, RoleSummaryDto } from './types'

/**
 * modules/role/service — roles are data, the permission catalog is code.
 *
 * SPEC §2: "Fixed permission catalog in code. Roles are created/named/edited in
 * the UI. SUPER_ADMIN is hardcoded, undeletable, has all permissions
 * implicitly."
 *
 * ── Why SUPER_ADMIN has no stored permissions ──────────────────────────────
 *
 * Its `RolePermission` rows are deliberately absent, and `can()` short-circuits
 * on the role name instead. Materialising the list would make it a snapshot:
 * Phase 7 adds `payout.markPaid`, and the super admin silently does not have
 * it until someone remembers to re-run a backfill. An implicit grant cannot go
 * stale.
 */

/**
 * Member counts exclude soft-deleted users.
 *
 * Not cosmetic: `deleteRole` refuses while the count is above zero, so counting
 * a departed employee's row makes their role permanently undeletable — and the
 * screen cannot explain why, because the holder it is protecting is invisible
 * everywhere else (CLAUDE.md invariant 8).
 *
 * Deactivated-but-not-deleted users still count. That account exists, still
 * holds the role, and can be switched back on.
 */
const ACTIVE_MEMBERS = { where: { user: { deletedAt: null } } } as const

/** The one role the UI may not touch. Enforced here, not only in the component. */
function assertMutable(role: { nameEn: string; isSystem: boolean }): void {
  if (role.nameEn === SUPER_ADMIN_ROLE || role.isSystem) {
    throw new DomainError('roles.systemRoleLocked', { nameEn: role.nameEn })
  }
}

export function isSuperAdminRoleRow(role: { nameEn: string }): boolean {
  return role.nameEn === SUPER_ADMIN_ROLE
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listRoles(db: Db): Promise<RoleSummaryDto[]> {
  const rows = await db.role.findMany({
    where: { deletedAt: null },
    orderBy: [{ isSystem: 'desc' }, { nameAr: 'asc' }],
    select: {
      id: true,
      nameAr: true,
      nameEn: true,
      description: true,
      isSystem: true,
      _count: { select: { permissions: true, users: ACTIVE_MEMBERS } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    description: row.description,
    isSystem: row.isSystem,
    permissionCount: isSuperAdminRoleRow(row) ? null : row._count.permissions,
    memberCount: row._count.users,
  }))
}

export async function getRole(db: Db, id: string): Promise<RoleDetailDto> {
  const row = await db.role.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      nameAr: true,
      nameEn: true,
      description: true,
      isSystem: true,
      permissions: { select: { permissionKey: true } },
      _count: { select: { users: ACTIVE_MEMBERS } },
    },
  })
  if (!row) throw new NotFoundError('Role', id)

  const holdsAll = isSuperAdminRoleRow(row)

  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    description: row.description,
    isSystem: row.isSystem,
    permissionCount: holdsAll ? null : row.permissions.length,
    memberCount: row._count.users,
    permissions: holdsAll
      ? [...PERMISSIONS]
      : (row.permissions.map((p) => p.permissionKey) as Permission[]),
    holdsAllPermissions: holdsAll,
  }
}

/**
 * The role editor's checkbox groups, built from the code catalog rather than
 * from the `permissions` table — so a permission added in a later phase appears
 * the moment it is deployed, whether or not the seed has run yet.
 */
export function permissionGroups(): PermissionGroupDto[] {
  const groups = new Map<string, PermissionGroupDto>()

  for (const key of PERMISSIONS) {
    const domain = permissionDomain(key)
    let group = groups.get(domain)
    if (!group) {
      group = {
        domain,
        labelAr:
          ar.permissionDomains[domain as keyof typeof ar.permissionDomains] ?? domain,
        permissions: [],
      }
      groups.set(domain, group)
    }
    group.permissions.push({ key, descriptionAr: ar.permissions[key] })
  }

  return [...groups.values()]
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export interface RoleMutationArgs {
  actor: Actor
  ip?: string | undefined
}

export async function createRole(
  db: Db,
  args: RoleMutationArgs & { input: CreateRoleInput },
): Promise<RoleDetailDto> {
  const { input } = args

  if (input.nameEn === SUPER_ADMIN_ROLE) {
    throw new DomainError('roles.systemRoleLocked', { nameEn: input.nameEn })
  }

  const existing = await db.role.findUnique({
    where: { nameEn: input.nameEn },
    select: { id: true, deletedAt: true },
  })

  if (existing && existing.deletedAt === null) {
    throw new ConflictError('validation.roleNameEnTaken', { nameEn: input.nameEn })
  }

  // `nameEn` is unique at the database level, so a soft-deleted row still owns
  // the identifier. Resurrecting it — rather than failing with "taken" for a
  // role the operator cannot see — is the only behaviour that matches what they
  // observe on screen.
  const role = existing
    ? await db.role.update({
        where: { id: existing.id },
        data: {
          nameAr: input.nameAr,
          description: input.description ?? null,
          deletedAt: null,
          isSystem: false,
          permissions: {
            deleteMany: {},
            create: input.permissions.map((permissionKey) => ({ permissionKey })),
          },
        },
        select: { id: true },
      })
    : await db.role.create({
        data: {
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          description: input.description ?? null,
          isSystem: false,
          permissions: {
            create: input.permissions.map((permissionKey) => ({ permissionKey })),
          },
        },
        select: { id: true },
      })

  await recordAudit(db, {
    actor: args.actor,
    action: 'role.created',
    entity: 'Role',
    entityId: role.id,
    after: {
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      description: input.description ?? null,
      permissions: [...input.permissions].sort(),
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return getRole(db, role.id)
}

export async function updateRole(
  db: Db,
  args: RoleMutationArgs & { input: UpdateRoleInput },
): Promise<RoleDetailDto> {
  const { input } = args

  const before = await db.role.findFirst({
    where: { id: input.id, deletedAt: null },
    select: {
      id: true,
      nameAr: true,
      nameEn: true,
      description: true,
      isSystem: true,
      permissions: { select: { permissionKey: true } },
    },
  })
  if (!before) throw new NotFoundError('Role', input.id)
  assertMutable(before)

  await db.role.update({
    where: { id: before.id },
    data: {
      nameAr: input.nameAr,
      description: input.description ?? null,
      // Replace wholesale. A diff would have to reason about concurrent edits
      // to the same role, and the set is at most a few dozen rows.
      permissions: {
        deleteMany: {},
        create: input.permissions.map((permissionKey) => ({ permissionKey })),
      },
    },
  })

  const beforePermissions = before.permissions.map((p) => p.permissionKey).sort()
  const afterPermissions = [...input.permissions].sort()
  const permissionsChanged = beforePermissions.join(',') !== afterPermissions.join(',')

  await recordAudit(db, {
    actor: args.actor,
    // A permission change is the security-relevant event and must be findable
    // on its own, not buried among renames.
    action: permissionsChanged ? 'role.permissionsChanged' : 'role.updated',
    entity: 'Role',
    entityId: before.id,
    before: {
      nameAr: before.nameAr,
      description: before.description,
      permissions: beforePermissions,
    },
    after: {
      nameAr: input.nameAr,
      description: input.description ?? null,
      permissions: afterPermissions,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return getRole(db, before.id)
}

export async function deleteRole(
  db: Db,
  args: RoleMutationArgs & { id: string },
): Promise<void> {
  const role = await db.role.findFirst({
    where: { id: args.id, deletedAt: null },
    select: {
      id: true,
      nameAr: true,
      nameEn: true,
      isSystem: true,
      _count: { select: { users: ACTIVE_MEMBERS } },
    },
  })
  if (!role) throw new NotFoundError('Role', args.id)
  assertMutable(role)

  // Deleting a role out from under its holders would silently strip their
  // access with no trace of why. Make the operator unassign it deliberately.
  if (role._count.users > 0) {
    throw new ConflictError('roles.inUse', { memberCount: role._count.users })
  }

  await db.role.update({
    where: { id: role.id },
    data: { deletedAt: new Date() },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'role.deleted',
    entity: 'Role',
    entityId: role.id,
    before: { nameAr: role.nameAr, nameEn: role.nameEn },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}
