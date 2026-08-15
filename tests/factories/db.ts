import type { PrismaClient } from '@prisma/client'

import { hashPassword } from '@/lib/auth/password'
import { permissionSeedRows, SUPER_ADMIN_ROLE, type Permission } from '@/lib/rbac'

import { ARABIC_FULL_NAMES, EGYPT_PHONES } from '../fixtures/arabic-names'

/**
 * Persisting factories, for the integration suite.
 *
 * `buildX()` in the sibling files returns a plain object for unit tests;
 * `createX()` here writes a real row. Both exist so a unit test never pays for
 * a database and an integration test never hand-builds a twenty-field object
 * (docs/TESTING.md §5).
 *
 * Passwords are hashed for real — cost 12, ~250 ms each. Tests that do not care
 * about the password pass `password: undefined` and get a fixed pre-computed
 * hash instead, which is the difference between a 2-second suite and a
 * 40-second one.
 */

let seq = 0
const next = (): number => (seq += 1)

export function resetDbFactorySequence(): void {
  seq = 0
}

/**
 * A real cost-12 hash of `SHARED_TEST_PASSWORD`, computed once per process.
 * Shared deliberately: bcrypt is the single slowest thing in the suite.
 */
export const SHARED_TEST_PASSWORD = 'test-password-not-secret'
let sharedHash: string | null = null

export async function sharedPasswordHash(): Promise<string> {
  sharedHash ??= await hashPassword(SHARED_TEST_PASSWORD)
  return sharedHash
}

/** The permission catalog must exist before any RolePermission row can. */
export async function seedPermissionCatalog(db: PrismaClient): Promise<void> {
  await db.permission.createMany({ data: permissionSeedRows(), skipDuplicates: true })
}

export interface CreateRoleOptions {
  nameEn?: string
  nameAr?: string
  isSystem?: boolean
  permissions?: readonly Permission[]
  deletedAt?: Date | null
}

export async function createRole(
  db: PrismaClient,
  options: CreateRoleOptions = {},
): Promise<{ id: string; nameEn: string; nameAr: string }> {
  const n = next()
  const nameEn = options.nameEn ?? `ROLE_${n}`

  return db.role.create({
    data: {
      nameEn,
      nameAr: options.nameAr ?? `دور ${n}`,
      isSystem: options.isSystem ?? false,
      deletedAt: options.deletedAt ?? null,
      permissions: {
        create: (options.permissions ?? []).map((permissionKey) => ({ permissionKey })),
      },
    },
    select: { id: true, nameEn: true, nameAr: true },
  })
}

/** The reserved role. Carries NO stored permissions — it holds them implicitly. */
export async function createSuperAdminRole(
  db: PrismaClient,
): Promise<{ id: string; nameEn: string; nameAr: string }> {
  return createRole(db, {
    nameEn: SUPER_ADMIN_ROLE,
    nameAr: 'مدير النظام',
    isSystem: true,
    permissions: [],
  })
}

export interface CreateUserOptions {
  username?: string
  password?: string
  fullName?: string
  phone?: string | null
  isWorker?: boolean
  isActive?: boolean
  mustChangePassword?: boolean
  payType?: 'SALARY' | 'PER_TASK' | 'HYBRID'
  monthlySalary?: string | null
  defaultTaskRate?: string | null
  weeklyCapacityHours?: number
  roleIds?: readonly string[]
  deletedAt?: Date | null
}

export interface CreatedUser {
  id: string
  username: string
  fullName: string
}

export async function createUser(
  db: PrismaClient,
  options: CreateUserOptions = {},
): Promise<CreatedUser> {
  const n = next()
  const passwordHash = options.password
    ? await hashPassword(options.password)
    : await sharedPasswordHash()

  return db.user.create({
    data: {
      username: options.username ?? `user${n}`,
      passwordHash,
      fullName:
        options.fullName ?? ARABIC_FULL_NAMES[n % ARABIC_FULL_NAMES.length] ?? 'مستخدم',
      phone:
        options.phone === undefined
          ? (EGYPT_PHONES[n % EGYPT_PHONES.length]?.e164 ?? null)
          : options.phone,
      isWorker: options.isWorker ?? true,
      isActive: options.isActive ?? true,
      mustChangePassword: options.mustChangePassword ?? false,
      payType: options.payType ?? 'PER_TASK',
      monthlySalary: options.monthlySalary ?? null,
      // `=== undefined`, not `??`. A test that explicitly asks for a worker
      // with NO task rate is testing the null path, and `?? '500.00'` would
      // silently hand it a rate and make the test prove nothing.
      defaultTaskRate:
        options.defaultTaskRate === undefined ? '500.00' : options.defaultTaskRate,
      weeklyCapacityHours: options.weeklyCapacityHours ?? 40,
      deletedAt: options.deletedAt ?? null,
      roles: { create: (options.roleIds ?? []).map((roleId) => ({ roleId })) },
    },
    select: { id: true, username: true, fullName: true },
  })
}

/**
 * A user holding exactly the listed permissions, via a role created for them.
 * The shortest path from "this test is about `user.create`" to a real actor.
 */
export async function createUserWithPermissions(
  db: PrismaClient,
  permissions: readonly Permission[],
  options: CreateUserOptions = {},
): Promise<CreatedUser> {
  const role = await createRole(db, { permissions })
  return createUser(db, { ...options, roleIds: [role.id] })
}

export async function createSuperAdmin(
  db: PrismaClient,
  options: CreateUserOptions = {},
): Promise<CreatedUser> {
  const existing = await db.role.findUnique({ where: { nameEn: SUPER_ADMIN_ROLE } })
  const role = existing ?? (await createSuperAdminRole(db))
  return createUser(db, { ...options, roleIds: [role.id] })
}

// ─────────────────────────────────────────────────────────────────────────────
// Work — Phase 3 (Client, Project, ProjectMember, Milestone, ProjectTemplate)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateClientOptions {
  name?: string
  phone?: string | null
  notes?: string | null
  deletedAt?: Date | null
}

export async function createClient(
  db: PrismaClient,
  options: CreateClientOptions = {},
): Promise<{ id: string; name: string }> {
  const n = next()
  return db.client.create({
    data: {
      name: options.name ?? `عميل ${n}`,
      phone: options.phone ?? null,
      notes: options.notes ?? null,
      deletedAt: options.deletedAt ?? null,
    },
    select: { id: true, name: true },
  })
}

export interface CreateProjectOptions {
  code?: string
  name?: string
  clientId?: string | null
  ownerId: string
  engagementType?: 'FIXED_PRICE' | 'RETAINER' | 'MILESTONE_BASED' | 'HOURLY'
  status?:
    | 'DRAFT'
    | 'PROPOSED'
    | 'ACTIVE'
    | 'ON_HOLD'
    | 'IN_REVIEW'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'ARCHIVED'
  startDate?: Date
  dueDate?: Date
  gracePeriodHours?: number | null
  penalizeRevisionLateness?: boolean | null
  healthOverride?: 'GREEN' | 'AMBER' | 'RED' | null
  healthReason?: string | null
  memberIds?: readonly string[]
  deletedAt?: Date | null
}

export async function createProject(
  db: PrismaClient,
  options: CreateProjectOptions,
): Promise<{ id: string; code: string; name: string }> {
  const n = next()
  return db.project.create({
    data: {
      code: options.code ?? `PRJ-TEST-${n}`,
      name: options.name ?? `مشروع ${n}`,
      clientId: options.clientId ?? null,
      ownerId: options.ownerId,
      engagementType: options.engagementType ?? 'FIXED_PRICE',
      status: options.status ?? 'ACTIVE',
      startDate: options.startDate ?? new Date('2026-01-01T00:00:00Z'),
      dueDate: options.dueDate ?? new Date('2026-06-01T00:00:00Z'),
      gracePeriodHours: options.gracePeriodHours ?? null,
      penalizeRevisionLateness: options.penalizeRevisionLateness ?? null,
      healthOverride: options.healthOverride ?? null,
      healthReason: options.healthReason ?? null,
      deletedAt: options.deletedAt ?? null,
      members: {
        create: (options.memberIds ?? []).map((userId) => ({
          userId,
          role: 'CONTRIBUTOR',
        })),
      },
    },
    select: { id: true, code: true, name: true },
  })
}

export interface CreateMilestoneOptions {
  projectId: string
  name?: string
  dueDate?: Date | null
  order?: number
  status?: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'DELAYED'
}

export async function createMilestone(
  db: PrismaClient,
  options: CreateMilestoneOptions,
): Promise<{ id: string; order: number }> {
  const n = next()
  return db.milestone.create({
    data: {
      projectId: options.projectId,
      name: options.name ?? `مرحلة ${n}`,
      dueDate: options.dueDate === undefined ? null : options.dueDate,
      order: options.order ?? n,
      status: options.status ?? 'PENDING',
    },
    select: { id: true, order: true },
  })
}

export interface CreateProjectTemplateOptions {
  name?: string
  payload?: unknown
  createdById?: string | null
  deletedAt?: Date | null
}

export async function createProjectTemplate(
  db: PrismaClient,
  options: CreateProjectTemplateOptions = {},
): Promise<{ id: string; name: string }> {
  const n = next()
  return db.projectTemplate.create({
    data: {
      name: options.name ?? `قالب ${n}`,
      payload: (options.payload ?? { milestones: [], tasks: [] }) as never,
      createdById: options.createdById ?? null,
      deletedAt: options.deletedAt ?? null,
    },
    select: { id: true, name: true },
  })
}
