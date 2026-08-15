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

// ─────────────────────────────────────────────────────────────────────────────
// Work — Phase 4 (Task and its satellites)
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatusOption =
  | 'BACKLOG'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'REVISION_REQUESTED'
  | 'APPROVED'
  | 'DONE'
  | 'BLOCKED'
  | 'CANCELLED'

export interface CreateTaskOptions {
  projectId: string
  milestoneId?: string | null
  title?: string
  description?: string | null
  assigneeId?: string | null
  status?: TaskStatusOption
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  categoryId?: string
  estimatedHours?: string
  taskValue?: string
  dueDate?: Date
  originalDueDate?: Date
  assignedAt?: Date | null
  startedAt?: Date | null
  submittedAt?: Date | null
  approvedAt?: Date | null
  elapsedMinutesRaw?: number
  elapsedMinutesWorking?: number
  qualityRating?: number | null
  watcherIds?: readonly string[]
  deletedAt?: Date | null
}

/**
 * A task in whatever state the test needs, written directly.
 *
 * Deliberately bypasses the state machine: a test about *approving* should not
 * have to walk BACKLOG → ASSIGNED → IN_PROGRESS → SUBMITTED → IN_REVIEW first,
 * and one that did would fail for four unrelated reasons. Tests about the
 * transitions themselves call the service.
 *
 * `assignedAt` follows the status when not given explicitly, so a task built
 * `IN_PROGRESS` has the stamp the state machine would have left — otherwise
 * every elapsed-time assertion would silently measure from null.
 */
export async function createTask(
  db: PrismaClient,
  options: CreateTaskOptions,
): Promise<{ id: string; title: string; status: TaskStatusOption }> {
  const n = next()
  const status = options.status ?? 'BACKLOG'
  const dueDate = options.dueDate ?? new Date('2026-04-01T12:00:00Z')
  const assignedByStatus = status !== 'BACKLOG' && options.assigneeId

  const row = await db.task.create({
    data: {
      projectId: options.projectId,
      milestoneId: options.milestoneId ?? null,
      title: options.title ?? `مهمة ${n}`,
      description: options.description ?? null,
      assigneeId: options.assigneeId ?? null,
      status,
      priority: options.priority ?? 'MEDIUM',
      categoryId: options.categoryId ?? 'design',
      estimatedHours: options.estimatedHours ?? '8.00',
      taskValue: options.taskValue ?? '500.00',
      dueDate,
      originalDueDate: options.originalDueDate ?? dueDate,
      assignedAt:
        options.assignedAt === undefined
          ? assignedByStatus
            ? new Date('2026-03-01T09:00:00Z')
            : null
          : options.assignedAt,
      startedAt: options.startedAt ?? null,
      submittedAt: options.submittedAt ?? null,
      approvedAt: options.approvedAt ?? null,
      elapsedMinutesRaw: options.elapsedMinutesRaw ?? 0,
      elapsedMinutesWorking: options.elapsedMinutesWorking ?? 0,
      qualityRating: options.qualityRating ?? null,
      deletedAt: options.deletedAt ?? null,
      watchers: {
        create: (options.watcherIds ?? []).map((userId) => ({ userId })),
      },
    },
    select: { id: true, title: true, status: true },
  })

  return { ...row, status: row.status as TaskStatusOption }
}

/**
 * A `STATUS_CHANGED → BLOCKED` activity row, which is where `unblockTask` and
 * the project-health `maxBlockedDays` signal both read "what was this doing
 * when it was blocked, and since when".
 */
export async function createBlockActivity(
  db: PrismaClient,
  options: {
    taskId: string
    from: TaskStatusOption
    actorId?: string | null
    at?: Date
  },
): Promise<{ id: string }> {
  return db.taskActivity.create({
    data: {
      taskId: options.taskId,
      actorId: options.actorId ?? null,
      type: 'STATUS_CHANGED',
      from: options.from,
      to: 'BLOCKED',
      createdAt: options.at ?? new Date('2026-03-01T09:00:00Z'),
    },
    select: { id: true },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar — Phase 6 (Holiday, Leave, ExtensionRequest)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `@db.Date` columns are written and read as UTC midnight — Prisma's
 * representation of a bare calendar date. Factories therefore take the date
 * *key* (`YYYY-MM-DD`) and never a `Date`, so a test can never accidentally
 * assert against a value that a timezone shifted on the way in.
 */
const dateColumn = (key: string): Date => new Date(`${key}T00:00:00.000Z`)

export interface CreateHolidayOptions {
  /** Cairo date key, `YYYY-MM-DD`. */
  date: string
  nameAr?: string
  isRecurring?: boolean
}

export async function createHoliday(
  db: PrismaClient,
  options: CreateHolidayOptions,
): Promise<{ id: string; date: string }> {
  const n = next()
  const row = await db.holiday.create({
    data: {
      date: dateColumn(options.date),
      nameAr: options.nameAr ?? `عطلة ${n}`,
      isRecurring: options.isRecurring ?? false,
    },
    select: { id: true },
  })
  return { id: row.id, date: options.date }
}

export interface CreateLeaveOptions {
  userId: string
  /** Inclusive Cairo date keys. */
  startDate: string
  endDate: string
  typeId?: string
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
  note?: string | null
  requestedById?: string
  decidedById?: string | null
  decidedAt?: Date | null
}

export async function createLeave(
  db: PrismaClient,
  options: CreateLeaveOptions,
): Promise<{ id: string }> {
  const status = options.status ?? 'APPROVED'
  return db.leave.create({
    data: {
      userId: options.userId,
      startDate: dateColumn(options.startDate),
      endDate: dateColumn(options.endDate),
      typeId: options.typeId ?? 'annual',
      status,
      note: options.note ?? null,
      requestedById: options.requestedById ?? options.userId,
      // A decided row without a decider would be a state the service can never
      // produce, and a test built on one proves nothing about the real thing.
      decidedById:
        options.decidedById === undefined
          ? status === 'PENDING'
            ? null
            : (options.requestedById ?? options.userId)
          : options.decidedById,
      decidedAt:
        options.decidedAt === undefined
          ? status === 'PENDING'
            ? null
            : new Date('2026-02-01T09:00:00Z')
          : options.decidedAt,
    },
    select: { id: true },
  })
}

export interface CreateExtensionRequestOptions {
  taskId: string
  requestedById: string
  oldDueDate: Date
  newDueDate: Date
  reason?: string
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
  decidedById?: string | null
}

export async function createExtensionRequest(
  db: PrismaClient,
  options: CreateExtensionRequestOptions,
): Promise<{ id: string }> {
  const n = next()
  return db.extensionRequest.create({
    data: {
      taskId: options.taskId,
      requestedById: options.requestedById,
      oldDueDate: options.oldDueDate,
      newDueDate: options.newDueDate,
      reason: options.reason ?? `سبب التمديد ${n}`,
      status: options.status ?? 'PENDING',
      decidedById: options.decidedById ?? null,
    },
    select: { id: true },
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
