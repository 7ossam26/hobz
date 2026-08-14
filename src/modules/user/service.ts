import { recordAudit } from '@/lib/audit'
import { hashPassword, validatePassword, type PasswordPolicy } from '@/lib/auth/password'
import type { Db } from '@/lib/db'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import { SUPER_ADMIN_ROLE, type Actor } from '@/lib/rbac'

import { noOpenTasks, type OpenTaskLookup } from './open-tasks'
import type { CreateUserInput, ListUsersInput, UpdateUserInput } from './schema'
import type { UserDetailDto, UserPageDto, UserSummaryDto } from './types'

/**
 * modules/user/service — accounts, roles and pay profile.
 *
 * Pure functions with an injected client, no `next/*`. Every mutation writes an
 * audit row inside the same call, and every one of them is a permission,
 * money-shape or status change — which is to say every one of them is covered
 * by CLAUDE.md invariant 7.
 */

const USER_SUMMARY_SELECT = {
  id: true,
  username: true,
  fullName: true,
  phone: true,
  isWorker: true,
  isActive: true,
  mustChangePassword: true,
  payType: true,
  roles: {
    where: { role: { deletedAt: null } },
    select: { role: { select: { id: true, nameAr: true, nameEn: true } } },
  },
} as const

const USER_DETAIL_SELECT = {
  ...USER_SUMMARY_SELECT,
  monthlySalary: true,
  defaultTaskRate: true,
  weeklyCapacityHours: true,
  penaltyProfileId: true,
  timezone: true,
  createdAt: true,
} as const

type SummaryRow = {
  id: string
  username: string
  fullName: string
  phone: string | null
  isWorker: boolean
  isActive: boolean
  mustChangePassword: boolean
  payType: string
  roles: Array<{ role: { id: string; nameAr: string; nameEn: string } }>
}

function toSummary(row: SummaryRow): UserSummaryDto {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    phone: row.phone,
    isWorker: row.isWorker,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    payType: row.payType as UserSummaryDto['payType'],
    roles: row.roles.map((r) => r.role),
  }
}

/** Prisma returns `Decimal`; money leaves this layer as a string (invariant 2). */
function money(value: { toFixed(dp: number): string } | null): string | null {
  return value === null ? null : value.toFixed(2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listUsers(db: Db, input: ListUsersInput): Promise<UserPageDto> {
  const where = {
    deletedAt: null,
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    ...(input.isWorker === undefined ? {} : { isWorker: input.isWorker }),
    // `role: { deletedAt: null }` is not redundant. Without it, filtering by a
    // soft-deleted role's id still returns its former holders — and since a
    // deleted role grants nothing (see `resolveActor`), the list would be
    // reporting a membership that confers no access. CLAUDE.md invariant 8
    // applies to the filter, not only to the rows.
    ...(input.roleId
      ? { roles: { some: { roleId: input.roleId, role: { deletedAt: null } } } }
      : {}),
    ...(input.search
      ? {
          OR: [
            { fullName: { contains: input.search, mode: 'insensitive' as const } },
            { username: { contains: input.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: USER_SUMMARY_SELECT,
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.user.count({ where }),
  ])

  return {
    items: rows.map(toSummary),
    total,
    page: input.page,
    pageSize: input.pageSize,
  }
}

export async function getUser(db: Db, id: string): Promise<UserDetailDto> {
  const row = await db.user.findFirst({
    where: { id, deletedAt: null },
    select: USER_DETAIL_SELECT,
  })
  if (!row) throw new NotFoundError('User', id)

  return {
    ...toSummary(row),
    monthlySalary: money(row.monthlySalary),
    defaultTaskRate: money(row.defaultTaskRate),
    weeklyCapacityHours: row.weeklyCapacityHours,
    penaltyProfileId: row.penaltyProfileId,
    timezone: row.timezone,
    createdAt: row.createdAt,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export interface UserMutationArgs {
  actor: Actor
  ip?: string | undefined
}

/** Role ids that exist and are not soft-deleted. Anything else is a bad request. */
async function assertRolesExist(db: Db, roleIds: readonly string[]): Promise<void> {
  if (roleIds.length === 0) return
  const found = await db.role.findMany({
    where: { id: { in: [...roleIds] }, deletedAt: null },
    select: { id: true },
  })
  if (found.length !== new Set(roleIds).size) {
    throw new NotFoundError('Role', roleIds.join(','))
  }
}

/**
 * Only a SUPER_ADMIN may grant or revoke the SUPER_ADMIN role.
 *
 * Without this, `user.edit` is transitively the power to hold every permission
 * in the catalog: assigning roles is part of editing a user, and one of the
 * assignable roles implicitly holds everything (SPEC §2). An editor could
 * promote themselves, or — just as bad — demote every administrator and take
 * over a product with nobody left who can undo it.
 *
 * Deliberately narrow. It fires only when the SUPER_ADMIN membership actually
 * changes, so ordinary role edits by an ordinary editor are untouched.
 */
async function assertMayChangeSuperAdminRole(
  db: Db,
  actor: Actor,
  before: readonly string[],
  after: readonly string[],
): Promise<void> {
  const superRole = await db.role.findUnique({
    where: { nameEn: SUPER_ADMIN_ROLE },
    select: { id: true },
  })
  // Nothing to protect until the role is seeded.
  if (!superRole) return

  const had = before.includes(superRole.id)
  const wants = after.includes(superRole.id)
  if (had === wants) return
  if (actor.isSuperAdmin) return

  throw new DomainError('users.superAdminRoleRestricted', {
    nameEn: SUPER_ADMIN_ROLE,
  })
}

export async function createUser(
  db: Db,
  args: UserMutationArgs & { input: CreateUserInput; policy: PasswordPolicy },
): Promise<UserDetailDto> {
  const { input } = args

  const problems = validatePassword(input.password, args.policy, {
    username: input.username,
  })
  if (problems.length > 0) {
    throw new DomainError(problems[0] ?? 'errors.validation', {
      minLength: args.policy.minLength,
    })
  }

  const existing = await db.user.findUnique({
    where: { username: input.username },
    select: { id: true },
  })
  if (existing) {
    // Includes soft-deleted accounts. A username is a person's identity in the
    // audit log; handing it to someone else would rewrite history by proxy.
    throw new ConflictError('validation.usernameTaken', { username: input.username })
  }

  await assertRolesExist(db, input.roles)
  await assertMayChangeSuperAdminRole(db, args.actor, [], input.roles)

  const user = await db.user.create({
    data: {
      username: input.username,
      passwordHash: await hashPassword(input.password),
      fullName: input.fullName,
      phone: input.phone,
      isWorker: input.isWorker,
      isActive: true,
      // The admin chose this password and has to communicate it out of band;
      // the user changes it on first login.
      mustChangePassword: true,
      payType: input.payType,
      monthlySalary: input.monthlySalary,
      defaultTaskRate: input.defaultTaskRate,
      weeklyCapacityHours: input.weeklyCapacityHours,
      penaltyProfileId: input.penaltyProfileId,
      roles: { create: input.roles.map((roleId) => ({ roleId })) },
    },
    select: { id: true },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'user.created',
    entity: 'User',
    entityId: user.id,
    after: {
      username: input.username,
      fullName: input.fullName,
      phone: input.phone,
      isWorker: input.isWorker,
      payType: input.payType,
      monthlySalary: input.monthlySalary,
      defaultTaskRate: input.defaultTaskRate,
      weeklyCapacityHours: input.weeklyCapacityHours,
      penaltyProfileId: input.penaltyProfileId,
      roles: [...input.roles].sort(),
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return getUser(db, user.id)
}

export async function updateUser(
  db: Db,
  args: UserMutationArgs & { input: UpdateUserInput },
): Promise<UserDetailDto> {
  const { input } = args

  const before = await db.user.findFirst({
    where: { id: input.id, deletedAt: null },
    select: USER_DETAIL_SELECT,
  })
  if (!before) throw new NotFoundError('User', input.id)

  await assertRolesExist(db, input.roles)

  const beforeRoles = before.roles.map((r) => r.role.id).sort()
  const afterRoles = [...input.roles].sort()
  const rolesChanged = beforeRoles.join(',') !== afterRoles.join(',')

  await assertMayChangeSuperAdminRole(db, args.actor, beforeRoles, afterRoles)

  await db.user.update({
    where: { id: before.id },
    data: {
      fullName: input.fullName,
      phone: input.phone,
      isWorker: input.isWorker,
      payType: input.payType,
      monthlySalary: input.monthlySalary,
      defaultTaskRate: input.defaultTaskRate,
      weeklyCapacityHours: input.weeklyCapacityHours,
      penaltyProfileId: input.penaltyProfileId,
      ...(rolesChanged
        ? {
            roles: {
              deleteMany: {},
              create: input.roles.map((roleId) => ({ roleId })),
            },
          }
        : {}),
    },
  })

  await recordAudit(db, {
    actor: args.actor,
    // A role change is a permission change, and must be findable as one.
    action: rolesChanged ? 'user.rolesChanged' : 'user.updated',
    entity: 'User',
    entityId: before.id,
    before: {
      fullName: before.fullName,
      phone: before.phone,
      isWorker: before.isWorker,
      payType: before.payType,
      monthlySalary: money(before.monthlySalary),
      defaultTaskRate: money(before.defaultTaskRate),
      weeklyCapacityHours: before.weeklyCapacityHours,
      penaltyProfileId: before.penaltyProfileId,
      roles: beforeRoles,
    },
    after: {
      fullName: input.fullName,
      phone: input.phone,
      isWorker: input.isWorker,
      payType: input.payType,
      monthlySalary: input.monthlySalary,
      defaultTaskRate: input.defaultTaskRate,
      weeklyCapacityHours: input.weeklyCapacityHours,
      penaltyProfileId: input.penaltyProfileId,
      roles: afterRoles,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return getUser(db, before.id)
}

export interface DeactivateUserArgs extends UserMutationArgs {
  id: string
  /** Injected so the rule is testable before Phase 4 exists. See open-tasks.ts. */
  openTasks?: OpenTaskLookup
}

/**
 * Deactivate an account — blocked while the user still owns open work.
 *
 * The block is the point. Deactivating a worker mid-task silently orphans the
 * task: it keeps its due date, keeps accruing lateness against an assignee who
 * can no longer log in, and produces a penalty nobody can explain. Forcing the
 * reassignment first is what keeps the deduction defensible, which is the one
 * thing this product exists to do.
 *
 * The error carries the task list so the UI can name them rather than saying
 * "there are open tasks" and leaving the admin to go hunting.
 */
export async function deactivateUser(db: Db, args: DeactivateUserArgs): Promise<void> {
  const user = await db.user.findFirst({
    where: { id: args.id, deletedAt: null },
    select: {
      id: true,
      username: true,
      fullName: true,
      isActive: true,
      roles: { select: { role: { select: { nameEn: true } } } },
    },
  })
  if (!user) throw new NotFoundError('User', args.id)

  if (args.actor.id === user.id) {
    throw new DomainError('users.cannotDeactivateSelf')
  }

  // Locking every super admin out of the product is not a state the UI should
  // be able to reach, whatever the operator meant to click.
  const isSuperAdmin = user.roles.some((r) => r.role.nameEn === SUPER_ADMIN_ROLE)
  if (isSuperAdmin) {
    const remaining = await db.user.count({
      where: {
        deletedAt: null,
        isActive: true,
        id: { not: user.id },
        roles: { some: { role: { nameEn: SUPER_ADMIN_ROLE, deletedAt: null } } },
      },
    })
    if (remaining === 0) throw new DomainError('users.cannotDeactivateLastSuperAdmin')
  }

  const lookup = args.openTasks ?? noOpenTasks
  const open = await lookup(db, user.id)
  if (open.length > 0) {
    throw new ConflictError('users.hasOpenTasks', {
      tasks: open.map((t) => ({ id: t.id, title: t.title })),
    })
  }

  if (!user.isActive) return

  await db.user.update({ where: { id: user.id }, data: { isActive: false } })

  await recordAudit(db, {
    actor: args.actor,
    action: 'user.deactivated',
    entity: 'User',
    entityId: user.id,
    before: { isActive: true },
    after: { isActive: false },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

export async function activateUser(
  db: Db,
  args: UserMutationArgs & { id: string },
): Promise<void> {
  const user = await db.user.findFirst({
    where: { id: args.id, deletedAt: null },
    select: { id: true, isActive: true },
  })
  if (!user) throw new NotFoundError('User', args.id)
  if (user.isActive) return

  await db.user.update({ where: { id: user.id }, data: { isActive: true } })

  await recordAudit(db, {
    actor: args.actor,
    action: 'user.activated',
    entity: 'User',
    entityId: user.id,
    before: { isActive: false },
    after: { isActive: true },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

/**
 * Admin password reset — the only reset path in the product.
 *
 * There is no email, so there is no reset link and no self-service recovery
 * (SPEC §2, CLAUDE.md invariant 9). The admin sets a password, tells the person
 * out of band, and `mustChangePassword` makes them replace it before they can
 * do anything else — so the admin does not hold a working credential for
 * someone else's account past the next login.
 */
export async function adminResetPassword(
  db: Db,
  args: UserMutationArgs & { id: string; newPassword: string; policy: PasswordPolicy },
): Promise<void> {
  const user = await db.user.findFirst({
    where: { id: args.id, deletedAt: null },
    select: { id: true, username: true },
  })
  if (!user) throw new NotFoundError('User', args.id)

  const problems = validatePassword(args.newPassword, args.policy, {
    username: user.username,
  })
  if (problems.length > 0) {
    throw new DomainError(problems[0] ?? 'errors.validation', {
      minLength: args.policy.minLength,
    })
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(args.newPassword),
      mustChangePassword: true,
    },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'user.passwordReset',
    entity: 'User',
    entityId: user.id,
    // No payload: the fact and the actor are the record. The value is the one
    // thing that must never reach this table.
    after: { mustChangePassword: true },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}
