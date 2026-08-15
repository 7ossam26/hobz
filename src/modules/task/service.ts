import { ar } from '@/i18n/ar'
import { recordAudit } from '@/lib/audit'
import type { Calendar } from '@/lib/calendar'
import type { Db } from '@/lib/db'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import { fitsColumn, gt, toMoney, toStorageString } from '@/lib/money'
import type { Actor, Permission, WhereFragment } from '@/lib/rbac'
import { normalizeArabic } from '@/lib/search'

import { computeElapsed } from './elapsed'
import { parseMentions } from './mentions'
import {
  noopLedgerPort,
  noopTaskEvents,
  type LedgerPort,
  type TaskEventBus,
} from './ports'
import type {
  AddCommentInput,
  ApproveTaskInput,
  AssignTaskInput,
  BlockTaskInput,
  CancelTaskInput,
  CreateTaskInput,
  ListTasksInput,
  RequestRevisionInput,
  TaskDependencyInput,
  TaskWatcherInput,
  TransitionTaskInput,
  UpdateTaskInput,
} from './schema'
import {
  assertTransition,
  stampTimestamps,
  type TaskStatus,
  type TaskTimestamps,
} from './state-machine'
import type {
  DependencyWarningDto,
  TaskActivityDto,
  TaskActivityKind,
  TaskCommentDto,
  TaskDetailDto,
  TaskPageDto,
  TaskSummaryDto,
  TaskTransitionResultDto,
} from './types'

/**
 * modules/task/service.ts — pure functions, dependency-injected Prisma client,
 * no `next/*` import (CLAUDE.md architecture rules).
 *
 * Every mutation follows the same four beats: load the row (scoped and
 * soft-delete-aware), decide with a pure function, write, then record both
 * histories — the `AuditLog` row that CLAUDE.md invariant 7 requires, and the
 * `TaskActivity` row that SPEC §4 gives the task itself.
 *
 * ── Two histories, on purpose ─────────────────────────────────────────────
 *
 * `AuditLog` is the compliance record: actor, impersonator, ip, before/after
 * diff, queryable across every entity in the product. `TaskActivity` is the
 * feed a منفّذ reads on their own task. They are not redundant, and one of
 * them is load-bearing beyond display: SPEC §5.1 puts the *original*
 * `submittedAt` and the status a task was blocked out of in the activity feed,
 * so `unblockTask` and every "when was this first delivered" question read it
 * back rather than a denormalised column that could drift.
 *
 * ── What this module never does ───────────────────────────────────────────
 *
 * It never writes a `LedgerEntry` and never computes a penalty. Approval emits
 * `TaskApproved` and reassignment hands an `AdjustmentIntent` to a port
 * (`ports.ts`); Phase 7 subscribes. It never does business-day maths either —
 * `elapsed.ts` calls `lib/calendar`, which Phase 6 implements.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared shapes
// ─────────────────────────────────────────────────────────────────────────────

const PERSON_SELECT = { id: true, fullName: true, username: true } as const

const TASK_SUMMARY_SELECT = {
  id: true,
  projectId: true,
  milestoneId: true,
  title: true,
  status: true,
  priority: true,
  categoryId: true,
  taskValue: true,
  estimatedHours: true,
  dueDate: true,
  assignee: { select: PERSON_SELECT },
  project: { select: { name: true } },
} as const

const TASK_DETAIL_SELECT = {
  ...TASK_SUMMARY_SELECT,
  description: true,
  originalDueDate: true,
  assignedAt: true,
  startedAt: true,
  submittedAt: true,
  approvedAt: true,
  elapsedMinutesRaw: true,
  elapsedMinutesWorking: true,
  delayReason: true,
  delayAttribution: true,
  qualityRating: true,
  createdAt: true,
  watchers: { select: { user: { select: PERSON_SELECT } } },
} as const

/** Structural, so it accepts Prisma's `Decimal` without importing its runtime. */
function money(value: { toFixed(dp: number): string }): string {
  return value.toFixed(2)
}

/**
 * Delivered means the worker's clock stopped. Time sitting in review never
 * counts against them (SPEC §5.3), so a SUBMITTED task past its due date is
 * not overdue — it was delivered, whether on time or not.
 */
const DELIVERED_STATUSES: readonly TaskStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'DONE',
  'CANCELLED',
]

function isOverdue(status: TaskStatus, dueDate: Date, now: Date): boolean {
  if (DELIVERED_STATUSES.includes(status)) return false
  return now.getTime() > dueDate.getTime()
}

type SummaryRow = {
  id: string
  projectId: string
  milestoneId: string | null
  title: string
  status: string
  priority: string
  categoryId: string
  taskValue: { toFixed(dp: number): string }
  estimatedHours: { toFixed(dp: number): string }
  dueDate: Date
  assignee: { id: string; fullName: string; username: string } | null
  project: { name: string }
}

function toSummaryDto(row: SummaryRow, now: Date): TaskSummaryDto {
  const status = row.status as TaskStatus
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    milestoneId: row.milestoneId,
    title: row.title,
    status,
    priority: row.priority as TaskSummaryDto['priority'],
    categoryId: row.categoryId,
    assignee: row.assignee,
    taskValue: money(row.taskValue),
    estimatedHours: money(row.estimatedHours),
    dueDate: row.dueDate,
    isOverdue: isOverdue(status, row.dueDate, now),
  }
}

type DetailRow = SummaryRow & {
  description: string | null
  originalDueDate: Date
  assignedAt: Date | null
  startedAt: Date | null
  submittedAt: Date | null
  approvedAt: Date | null
  elapsedMinutesRaw: number
  elapsedMinutesWorking: number
  delayReason: string | null
  delayAttribution: string | null
  qualityRating: number | null
  createdAt: Date
  watchers: Array<{ user: { id: string; fullName: string; username: string } }>
}

function toDetailDto(row: DetailRow, now: Date): TaskDetailDto {
  return {
    ...toSummaryDto(row, now),
    description: row.description,
    originalDueDate: row.originalDueDate,
    assignedAt: row.assignedAt,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    elapsedMinutesRaw: row.elapsedMinutesRaw,
    elapsedMinutesWorking: row.elapsedMinutesWorking,
    delayReason: row.delayReason,
    delayAttribution: row.delayAttribution as TaskDetailDto['delayAttribution'],
    qualityRating: row.qualityRating,
    watchers: row.watchers.map((w) => w.user),
    createdAt: row.createdAt,
  }
}

export interface TaskMutationArgs {
  actor: Actor
  ip?: string | undefined
  /**
   * Injected rather than read from the clock inside, so that a transition's
   * task timestamp and its `TaskActivity.createdAt` are provably the same
   * instant — the activity feed is where SPEC §5.1 keeps the original
   * `submittedAt`, and "provably the same" is what makes reading it back
   * meaningful.
   */
  now?: Date | undefined
}

const nowOf = (args: TaskMutationArgs): Date => args.now ?? new Date()

/**
 * A task and its project must both be alive. Phase 3's axis-11 sweep found the
 * mirror of this bug in the project facets: a soft-deleted parent leaking its
 * children back into a list. `deleteProject` only sets `deletedAt`, so nothing
 * at the database level hides a live task hanging off a deleted project.
 */
const ALIVE = { deletedAt: null, project: { deletedAt: null } } as const

async function loadTask(db: Db, id: string) {
  const task = await db.task.findFirst({
    where: { id, ...ALIVE },
    select: {
      id: true,
      projectId: true,
      status: true,
      assigneeId: true,
      taskValue: true,
      dueDate: true,
      originalDueDate: true,
      assignedAt: true,
      startedAt: true,
      submittedAt: true,
      approvedAt: true,
    },
  })
  if (!task) throw new NotFoundError('Task', id)
  return task
}

async function detail(db: Db, id: string, now: Date): Promise<TaskDetailDto> {
  const row = await db.task.findFirst({ where: { id }, select: TASK_DETAIL_SELECT })
  if (!row) throw new NotFoundError('Task', id)
  return toDetailDto(row as DetailRow, now)
}

interface ActivityInput {
  taskId: string
  actorId: string | null
  type: TaskActivityKind
  from?: string | null
  to?: string | null
  at: Date
}

async function writeActivity(db: Db, input: ActivityInput): Promise<void> {
  await db.taskActivity.create({
    data: {
      taskId: input.taskId,
      actorId: input.actorId,
      type: input.type,
      from: input.from ?? null,
      to: input.to ?? null,
      createdAt: input.at,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Settings-defined categories (`tasks.categories`), passed in by the caller. */
export type TaskCategoryOption = { id: string }

function assertCategory(
  categoryId: string,
  categories: readonly TaskCategoryOption[],
): void {
  if (!categories.some((c) => c.id === categoryId)) {
    throw new DomainError('tasks.errors.unknownCategory', { categoryId })
  }
}

async function assertMilestoneInProject(
  db: Db,
  milestoneId: string | null,
  projectId: string,
): Promise<void> {
  if (milestoneId === null) return
  const milestone = await db.milestone.findFirst({
    where: { id: milestoneId },
    select: { projectId: true },
  })
  if (!milestone) throw new NotFoundError('Milestone', milestoneId)
  if (milestone.projectId !== projectId) {
    throw new DomainError('tasks.errors.milestoneNotInProject', { milestoneId })
  }
}

/**
 * A task may only be assigned to a live, active account. Assigning work to a
 * deactivated user would create an obligation nobody can discharge — and
 * Phase 1 already refuses to deactivate someone who still holds open tasks, so
 * allowing it here would let the two rules contradict each other.
 */
async function loadAssignable(db: Db, userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, fullName: true, isActive: true, defaultTaskRate: true },
  })
  if (!user) throw new NotFoundError('User', userId)
  if (!user.isActive) throw new DomainError('tasks.errors.assigneeInactive', { userId })
  return user
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

function taskOrderBy(sort?: string, dir?: 'asc' | 'desc') {
  const direction = dir ?? 'asc'
  const allowed = new Set(['dueDate', 'priority', 'status', 'title', 'createdAt'])
  const field = sort && allowed.has(sort) ? sort : 'dueDate'
  return { [field]: direction } as Record<string, 'asc' | 'desc'>
}

export interface ListTasksArgs {
  scope: WhereFragment
  filters: ListTasksInput
  now: Date
}

export async function listTasks(db: Db, args: ListTasksArgs): Promise<TaskPageDto> {
  const { filters, now } = args
  const conditions: WhereFragment[] = [args.scope, { project: { deletedAt: null } }]

  if (filters.projectId?.length) conditions.push({ projectId: { in: filters.projectId } })
  if (filters.milestoneId?.length) {
    conditions.push({ milestoneId: { in: filters.milestoneId } })
  }
  if (filters.status?.length) conditions.push({ status: { in: filters.status } })
  if (filters.priority?.length) conditions.push({ priority: { in: filters.priority } })
  if (filters.categoryId?.length) {
    conditions.push({ categoryId: { in: filters.categoryId } })
  }
  if (filters.assigneeId?.length) {
    conditions.push({ assigneeId: { in: filters.assigneeId } })
  }
  if (filters.overdueOnly) {
    conditions.push({ dueDate: { lt: now }, status: { notIn: [...DELIVERED_STATUSES] } })
  }

  const where: WhereFragment = { AND: conditions }
  const orderBy = taskOrderBy(filters.sort, filters.dir)

  // Arabic-aware search runs in application code, not as a Prisma `contains`:
  // Postgres ILIKE case-folds but does not fold `احمد`/`أحمد`. Same trade, and
  // the same SPEC §2 scale justification, as `listProjects`/`listClients`.
  if (filters.search) {
    const needle = normalizeArabic(filters.search)
    const candidates = await db.task.findMany({
      where,
      select: TASK_SUMMARY_SELECT,
      orderBy,
    })
    const matched = candidates.filter((row) =>
      normalizeArabic(row.title).includes(needle),
    )
    const start = (filters.page - 1) * filters.pageSize
    return {
      items: matched
        .slice(start, start + filters.pageSize)
        .map((row) => toSummaryDto(row as SummaryRow, now)),
      total: matched.length,
      page: filters.page,
      pageSize: filters.pageSize,
    }
  }

  const [rows, total] = await Promise.all([
    db.task.findMany({
      where,
      select: TASK_SUMMARY_SELECT,
      orderBy,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.task.count({ where }),
  ])

  return {
    items: rows.map((row) => toSummaryDto(row as SummaryRow, now)),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export interface GetTaskArgs {
  scope: WhereFragment
  id: string
  now: Date
}

/**
 * Scoped by `where`, never by a post-fetch filter. A `task.view.assigned` user
 * asking for someone else's task by direct id gets `NotFoundError` — the row is
 * not confirmed to exist, which is the same "restrictive is the safe direction"
 * reading `modules/project/queries.ts` documents.
 */
export async function getTask(db: Db, args: GetTaskArgs): Promise<TaskDetailDto> {
  const row = await db.task.findFirst({
    where: { AND: [args.scope, { id: args.id }, { project: { deletedAt: null } }] },
    select: TASK_DETAIL_SELECT,
  })
  if (!row) throw new NotFoundError('Task', args.id)
  return toDetailDto(row as DetailRow, args.now)
}

/**
 * Finish-to-start dependencies that are not yet satisfied.
 *
 * **Warning only, never a block** (SPEC §4, §5.1). Satisfied means the
 * dependency actually finished — APPROVED or DONE. A CANCELLED dependency
 * still warns: the thing this task was waiting on is never going to be
 * delivered, which is exactly when a human should look.
 */
export async function getDependencyWarnings(
  db: Db,
  taskId: string,
): Promise<DependencyWarningDto[]> {
  const rows = await db.taskDependency.findMany({
    where: {
      taskId,
      dependsOnTask: {
        deletedAt: null,
        status: { notIn: ['APPROVED', 'DONE'] },
      },
    },
    select: {
      dependsOnTask: {
        select: { id: true, title: true, status: true, projectId: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return rows.map((row) => ({
    taskId: row.dependsOnTask.id,
    title: row.dependsOnTask.title,
    status: row.dependsOnTask.status as TaskStatus,
    projectId: row.dependsOnTask.projectId,
  }))
}

export async function listComments(db: Db, taskId: string): Promise<TaskCommentDto[]> {
  const rows = await db.taskComment.findMany({
    where: { taskId },
    select: {
      id: true,
      taskId: true,
      body: true,
      mentions: true,
      createdAt: true,
      author: { select: PERSON_SELECT },
    },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((row) => ({ ...row, mentions: [...row.mentions] }))
}

export async function listActivity(db: Db, taskId: string): Promise<TaskActivityDto[]> {
  const rows = await db.taskActivity.findMany({
    where: { taskId },
    select: {
      id: true,
      taskId: true,
      type: true,
      from: true,
      to: true,
      createdAt: true,
      actor: { select: PERSON_SELECT },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map((row) => ({ ...row, type: row.type as TaskActivityKind }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Create & edit
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTaskArgs extends TaskMutationArgs {
  input: CreateTaskInput
  categories: readonly TaskCategoryOption[]
}

export async function createTask(
  db: Db,
  args: CreateTaskArgs,
): Promise<TaskTransitionResultDto> {
  const { input } = args
  const now = nowOf(args)

  const project = await db.project.findFirst({
    where: { id: input.projectId, deletedAt: null },
    select: { id: true },
  })
  if (!project) throw new NotFoundError('Project', input.projectId)

  assertCategory(input.categoryId, args.categories)
  await assertMilestoneInProject(db, input.milestoneId, input.projectId)

  // Creating with an assignee *is* an assignment, so it lands in ASSIGNED and
  // stamps `assignedAt` — the BACKLOG → ASSIGNED edge, taken at birth.
  const assignee = input.assigneeId ? await loadAssignable(db, input.assigneeId) : null
  const status: TaskStatus = assignee ? 'ASSIGNED' : 'BACKLOG'

  // "taskValue auto-fills from the assignee's defaultTaskRate and stays
  // editable per task." An explicit value always wins, including an explicit
  // zero — a task genuinely worth nothing is a real thing a manager may say.
  const taskValue =
    input.taskValue ?? (assignee?.defaultTaskRate ? money(assignee.defaultTaskRate) : '0')
  assertStorableMoney(taskValue)

  const watcherIds = [...new Set(input.watcherIds)].filter((id) => id !== assignee?.id)
  if (watcherIds.length > 0) {
    const found = await db.user.findMany({
      where: { id: { in: watcherIds }, deletedAt: null },
      select: { id: true },
    })
    if (found.length !== watcherIds.length) throw new NotFoundError('User')
  }

  const created = await db.task.create({
    data: {
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      title: input.title,
      description: input.description,
      assigneeId: assignee?.id ?? null,
      status,
      priority: input.priority,
      categoryId: input.categoryId,
      estimatedHours: input.estimatedHours,
      taskValue,
      dueDate: input.dueDate,
      // The deadline the task was first given. An approved extension (Phase 6)
      // moves `dueDate` and leaves this untouched (SPEC §5.3).
      originalDueDate: input.dueDate,
      assignedAt: assignee ? now : null,
      watchers: { create: watcherIds.map((userId) => ({ userId })) },
    },
    select: { id: true },
  })

  await writeActivity(db, {
    taskId: created.id,
    actorId: args.actor.id,
    type: 'CREATED',
    to: status,
    at: now,
  })

  if (assignee) {
    await writeActivity(db, {
      taskId: created.id,
      actorId: args.actor.id,
      type: 'ASSIGNED',
      to: assignee.id,
      at: now,
    })
    await writeActivity(db, {
      taskId: created.id,
      actorId: args.actor.id,
      type: 'STATUS_CHANGED',
      from: 'BACKLOG',
      to: 'ASSIGNED',
      at: now,
    })
  }

  for (const userId of watcherIds) {
    await writeActivity(db, {
      taskId: created.id,
      actorId: args.actor.id,
      type: 'WATCHER_ADDED',
      to: userId,
      at: now,
    })
  }

  await recordAudit(db, {
    actor: args.actor,
    action: 'task.created',
    entity: 'Task',
    entityId: created.id,
    after: {
      projectId: input.projectId,
      title: input.title,
      status,
      assigneeId: assignee?.id ?? null,
      taskValue,
      dueDate: input.dueDate,
      categoryId: input.categoryId,
      priority: input.priority,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return { task: await detail(db, created.id, now), warnings: [] }
}

function assertStorableMoney(amount: string): void {
  if (!fitsColumn(amount)) {
    throw new DomainError('validation.amountFormat', { amount })
  }
}

export interface UpdateTaskArgs extends TaskMutationArgs {
  input: UpdateTaskInput
  categories: readonly TaskCategoryOption[]
}

/**
 * Field edits only. Status and assignee have their own guarded paths — routing
 * either through here would sidestep the state machine and SPEC §6's separate
 * `task.assign` / `task.approve` / `task.cancel` permissions.
 */
export async function updateTask(db: Db, args: UpdateTaskArgs): Promise<TaskDetailDto> {
  const { input } = args
  const now = nowOf(args)

  const before = await db.task.findFirst({
    where: { id: input.id, ...ALIVE },
    select: {
      id: true,
      projectId: true,
      title: true,
      description: true,
      milestoneId: true,
      priority: true,
      categoryId: true,
      estimatedHours: true,
      taskValue: true,
      dueDate: true,
      delayReason: true,
      delayAttribution: true,
    },
  })
  if (!before) throw new NotFoundError('Task', input.id)

  assertCategory(input.categoryId, args.categories)
  await assertMilestoneInProject(db, input.milestoneId, before.projectId)

  const taskValue = input.taskValue ?? money(before.taskValue)
  assertStorableMoney(taskValue)

  await db.task.update({
    where: { id: before.id },
    data: {
      title: input.title,
      description: input.description,
      milestoneId: input.milestoneId,
      priority: input.priority,
      categoryId: input.categoryId,
      estimatedHours: input.estimatedHours,
      taskValue,
      dueDate: input.dueDate,
      delayReason: input.delayReason,
      delayAttribution: input.delayAttribution,
      // `originalDueDate` is deliberately absent: it records the deadline the
      // task was *first* given and never moves, whether the date changes by an
      // edit here or by an approved extension in Phase 6 (SPEC §5.3).
    },
  })

  const dueDateChanged = before.dueDate.getTime() !== input.dueDate.getTime()
  const valueChanged = money(before.taskValue) !== taskValue

  if (dueDateChanged) {
    await writeActivity(db, {
      taskId: before.id,
      actorId: args.actor.id,
      type: 'DUE_DATE_CHANGED',
      from: before.dueDate.toISOString(),
      to: input.dueDate.toISOString(),
      at: now,
    })
  }
  if (valueChanged) {
    await writeActivity(db, {
      taskId: before.id,
      actorId: args.actor.id,
      type: 'VALUE_CHANGED',
      from: money(before.taskValue),
      to: taskValue,
      at: now,
    })
  }
  if (!dueDateChanged && !valueChanged) {
    await writeActivity(db, {
      taskId: before.id,
      actorId: args.actor.id,
      type: 'UPDATED',
      at: now,
    })
  }

  await recordAudit(db, {
    actor: args.actor,
    action: 'task.updated',
    entity: 'Task',
    entityId: before.id,
    before: {
      title: before.title,
      description: before.description,
      milestoneId: before.milestoneId,
      priority: before.priority,
      categoryId: before.categoryId,
      estimatedHours: money(before.estimatedHours),
      taskValue: money(before.taskValue),
      dueDate: before.dueDate,
      delayReason: before.delayReason,
      delayAttribution: before.delayAttribution,
    },
    after: {
      title: input.title,
      description: input.description,
      milestoneId: input.milestoneId,
      priority: input.priority,
      categoryId: input.categoryId,
      estimatedHours: input.estimatedHours.toFixed(2),
      taskValue,
      dueDate: input.dueDate,
      delayReason: input.delayReason,
      delayAttribution: input.delayAttribution,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return detail(db, before.id, now)
}

// ─────────────────────────────────────────────────────────────────────────────
// Assignment (SPEC M4)
// ─────────────────────────────────────────────────────────────────────────────

export interface AssignTaskArgs extends TaskMutationArgs {
  input: AssignTaskInput
  /** Where the partial-payment decision goes. Phase 7 replaces the no-op. */
  ledger?: LedgerPort
}

/**
 * One accountable assignee, set or replaced.
 *
 * ── The SPEC M4 decision ─────────────────────────────────────────────────
 *
 * Reassigning a task that is already under way opens *"pay the previous
 * assignee a partial amount?"*. `partialAmount` is the manager's answer.
 * Absent means "no" — never automatic, per the SPEC. Present means an
 * `ADJUSTMENT` intent for the **previous** assignee, handed to the ledger port.
 *
 * ── Why `taskValue` is not refreshed on reassignment ─────────────────────
 *
 * Auto-fill from `defaultTaskRate` happens on the **first** assignment only,
 * and only when the task has no value yet. Silently repricing a task because a
 * different person picked it up would make someone's earnings change without
 * anybody deciding it — the exact thing this product exists to prevent. A
 * manager who wants the new rate passes it.
 *
 * "First assignment" is `previousAssigneeId === null`, not "the value is
 * currently zero". The distinction was found by the axis-1 boundary sweep: a
 * zero-valued task being reassigned used to pick up the *incoming* worker's
 * rate, which not only repriced it silently but also raised the ceiling that
 * the outgoing worker's partial payment is checked against — so a manager
 * could pay out against a value that only existed because of the reassignment
 * they were making.
 */
export async function assignTask(db: Db, args: AssignTaskArgs): Promise<TaskDetailDto> {
  const { input } = args
  const now = nowOf(args)
  const ledger = args.ledger ?? noopLedgerPort

  const task = await loadTask(db, input.taskId)
  const previousAssigneeId = task.assigneeId

  if (previousAssigneeId === input.assigneeId) {
    throw new ConflictError('tasks.errors.assigneeUnchanged', { taskId: task.id })
  }

  const assignee = await loadAssignable(db, input.assigneeId)
  const status = task.status as TaskStatus

  // A first assignment takes the BACKLOG → ASSIGNED edge. A reassignment does
  // not move the task: the work is where it is, only the person changed.
  const movesToAssigned = status === 'BACKLOG'
  if (movesToAssigned) assertTransition(status, 'ASSIGNED')

  const currentValue = money(task.taskValue)
  const isFirstAssignment = previousAssigneeId === null
  const taskValue =
    input.taskValue ??
    (isFirstAssignment && currentValue === '0.00' && assignee.defaultTaskRate
      ? money(assignee.defaultTaskRate)
      : currentValue)
  assertStorableMoney(taskValue)

  const timestamps = stampTimestamps(
    'ASSIGNED',
    {
      assignedAt: task.assignedAt,
      startedAt: task.startedAt,
      submittedAt: task.submittedAt,
      approvedAt: task.approvedAt,
    },
    now,
  )

  await db.task.update({
    where: { id: task.id },
    data: {
      assigneeId: assignee.id,
      taskValue,
      ...(movesToAssigned ? { status: 'ASSIGNED', ...timestamps } : {}),
      // The task is no longer watched by its own assignee implicitly if that
      // person is now a watcher instead; membership is left to the explicit
      // watcher calls, so nothing is silently added or dropped here.
    },
  })

  await writeActivity(db, {
    taskId: task.id,
    actorId: args.actor.id,
    type: 'ASSIGNED',
    from: previousAssigneeId,
    to: assignee.id,
    at: now,
  })
  if (movesToAssigned) {
    await writeActivity(db, {
      taskId: task.id,
      actorId: args.actor.id,
      type: 'STATUS_CHANGED',
      from: 'BACKLOG',
      to: 'ASSIGNED',
      at: now,
    })
  }
  if (currentValue !== taskValue) {
    await writeActivity(db, {
      taskId: task.id,
      actorId: args.actor.id,
      type: 'VALUE_CHANGED',
      from: currentValue,
      to: taskValue,
      at: now,
    })
  }

  await recordAudit(db, {
    actor: args.actor,
    action: previousAssigneeId ? 'task.reassigned' : 'task.assigned',
    entity: 'Task',
    entityId: task.id,
    before: { assigneeId: previousAssigneeId, taskValue: currentValue, status },
    after: {
      assigneeId: assignee.id,
      taskValue,
      status: movesToAssigned ? 'ASSIGNED' : status,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  if (input.partialAmount !== undefined) {
    await recordPartialPayment(db, {
      actor: args.actor,
      ledger,
      taskId: task.id,
      previousAssigneeId,
      amount: input.partialAmount,
      taskValue,
      at: now,
      ...(args.ip ? { ip: args.ip } : {}),
    })
  }

  return detail(db, task.id, now)
}

interface PartialPaymentArgs {
  actor: Actor
  ledger: LedgerPort
  taskId: string
  previousAssigneeId: string | null
  amount: string
  taskValue: string
  at: Date
  ip?: string
}

/**
 * The audit row is written **before** the port call, deliberately.
 *
 * `noopLedgerPort` is today's implementation, so without this the manager's
 * decision would exist nowhere until Phase 7. With it, every intent is durably
 * recorded with its amount, its recipient and its author, and Phase 7 can
 * replay the ones raised while the port was dark.
 */
async function recordPartialPayment(db: Db, args: PartialPaymentArgs): Promise<void> {
  if (!args.previousAssigneeId) {
    throw new DomainError('tasks.errors.partialAmountRequiresPreviousAssignee', {
      taskId: args.taskId,
    })
  }

  const amount = toStorageString(toMoney(args.amount))
  assertStorableMoney(amount)

  // Paying more for partial work than the whole task is worth is always a
  // typo — three zeroes, or a monthly rate pasted into a per-task field.
  if (gt(amount, args.taskValue)) {
    throw new DomainError('tasks.errors.partialAmountTooLarge', {
      amount,
      taskValue: args.taskValue,
    })
  }

  /**
   * The note becomes `LedgerEntry.note`, which the worker reads on their own
   * مستحقاتي page — so it is real Arabic prose, from the one template file,
   * not an id pair. The template is the same string the reassignment dialog
   * shows, which is the point: the manager and the worker see one wording.
   *
   * Importing `ar` into a service follows the `modules/<domain>/schema.ts`
   * precedent, and is distinct from `lib/`'s rule (errors carry i18n *keys*
   * because they are rendered later). This value is persisted, so it has to be
   * resolved now.
   */
  const previous = await db.user.findUnique({
    where: { id: args.previousAssigneeId },
    select: { fullName: true },
  })
  const note = ar.tasks.assignment.payPreviousNote.replace(
    '{name}',
    previous?.fullName ?? args.previousAssigneeId,
  )

  await recordAudit(db, {
    actor: args.actor,
    action: 'task.partialPaymentIntent',
    entity: 'Task',
    entityId: args.taskId,
    after: {
      userId: args.previousAssigneeId,
      amount,
      taskValue: args.taskValue,
      type: 'ADJUSTMENT',
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await args.ledger.recordAdjustment(db, {
    userId: args.previousAssigneeId,
    taskId: args.taskId,
    amount,
    note,
    createdById: args.actor.id,
    at: args.at,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchers
// ─────────────────────────────────────────────────────────────────────────────

export interface WatcherArgs extends TaskMutationArgs {
  input: TaskWatcherInput
}

export async function addWatcher(db: Db, args: WatcherArgs): Promise<void> {
  const { input } = args
  const now = nowOf(args)
  const task = await loadTask(db, input.taskId)

  // The assignee already sees and is notified about their own task
  // (`scopeTasks` ORs on `assigneeId`). A watcher row for them would be a
  // second, redundant reason for the same access.
  if (task.assigneeId === input.userId) {
    throw new ConflictError('tasks.errors.sameAssigneeAsWatcher', {
      userId: input.userId,
    })
  }

  const user = await db.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true },
  })
  if (!user) throw new NotFoundError('User', input.userId)

  const existing = await db.taskWatcher.findUnique({
    where: { taskId_userId: { taskId: task.id, userId: user.id } },
    select: { taskId: true },
  })
  if (existing) return

  await db.taskWatcher.create({ data: { taskId: task.id, userId: user.id } })
  await writeActivity(db, {
    taskId: task.id,
    actorId: args.actor.id,
    type: 'WATCHER_ADDED',
    to: user.id,
    at: now,
  })
  await recordAudit(db, {
    actor: args.actor,
    action: 'task.watcherAdded',
    entity: 'Task',
    entityId: task.id,
    after: { userId: user.id },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

export async function removeWatcher(db: Db, args: WatcherArgs): Promise<void> {
  const { input } = args
  const now = nowOf(args)
  const task = await loadTask(db, input.taskId)

  const existing = await db.taskWatcher.findUnique({
    where: { taskId_userId: { taskId: task.id, userId: input.userId } },
    select: { taskId: true },
  })
  if (!existing) throw new NotFoundError('TaskWatcher', input.userId)

  await db.taskWatcher.delete({
    where: { taskId_userId: { taskId: task.id, userId: input.userId } },
  })
  await writeActivity(db, {
    taskId: task.id,
    actorId: args.actor.id,
    type: 'WATCHER_REMOVED',
    to: input.userId,
    at: now,
  })
  await recordAudit(db, {
    actor: args.actor,
    action: 'task.watcherRemoved',
    entity: 'Task',
    entityId: task.id,
    before: { userId: input.userId },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies — finish-to-start, warning only
// ─────────────────────────────────────────────────────────────────────────────

export interface DependencyArgs extends TaskMutationArgs {
  input: TaskDependencyInput
}

export async function addDependency(db: Db, args: DependencyArgs): Promise<void> {
  const { input } = args
  const now = nowOf(args)

  if (input.taskId === input.dependsOnTaskId) {
    throw new DomainError('tasks.errors.selfDependency', { taskId: input.taskId })
  }

  const task = await loadTask(db, input.taskId)
  const dependsOn = await loadTask(db, input.dependsOnTaskId)

  const existing = await db.taskDependency.findUnique({
    where: {
      taskId_dependsOnTaskId: { taskId: task.id, dependsOnTaskId: dependsOn.id },
    },
    select: { taskId: true },
  })
  if (existing) {
    throw new ConflictError('tasks.errors.duplicateDependency', { taskId: task.id })
  }

  // A ↔ B is nonsense in either direction and cheap to catch. Longer cycles
  // are deliberately *not* walked: resolution is one level deep (a task warns
  // about its direct predecessors only), so a cycle costs a confusing banner,
  // never a hang — and a traversal on every write would be a real cost for a
  // rule that never blocks anything.
  const reciprocal = await db.taskDependency.findUnique({
    where: {
      taskId_dependsOnTaskId: { taskId: dependsOn.id, dependsOnTaskId: task.id },
    },
    select: { taskId: true },
  })
  if (reciprocal) {
    throw new DomainError('tasks.errors.reciprocalDependency', {
      taskId: task.id,
      dependsOnTaskId: dependsOn.id,
    })
  }

  await db.taskDependency.create({
    data: { taskId: task.id, dependsOnTaskId: dependsOn.id },
  })
  await writeActivity(db, {
    taskId: task.id,
    actorId: args.actor.id,
    type: 'DEPENDENCY_ADDED',
    to: dependsOn.id,
    at: now,
  })
  await recordAudit(db, {
    actor: args.actor,
    action: 'task.dependencyAdded',
    entity: 'Task',
    entityId: task.id,
    after: { dependsOnTaskId: dependsOn.id },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

export async function removeDependency(db: Db, args: DependencyArgs): Promise<void> {
  const { input } = args
  const now = nowOf(args)
  const task = await loadTask(db, input.taskId)

  const existing = await db.taskDependency.findUnique({
    where: {
      taskId_dependsOnTaskId: {
        taskId: task.id,
        dependsOnTaskId: input.dependsOnTaskId,
      },
    },
    select: { taskId: true },
  })
  if (!existing) throw new NotFoundError('TaskDependency', input.dependsOnTaskId)

  await db.taskDependency.delete({
    where: {
      taskId_dependsOnTaskId: {
        taskId: task.id,
        dependsOnTaskId: input.dependsOnTaskId,
      },
    },
  })
  await writeActivity(db, {
    taskId: task.id,
    actorId: args.actor.id,
    type: 'DEPENDENCY_REMOVED',
    to: input.dependsOnTaskId,
    at: now,
  })
  await recordAudit(db, {
    actor: args.actor,
    action: 'task.dependencyRemoved',
    entity: 'Task',
    entityId: task.id,
    before: { dependsOnTaskId: input.dependsOnTaskId },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Comments
// ─────────────────────────────────────────────────────────────────────────────

export interface AddCommentArgs extends TaskMutationArgs {
  input: AddCommentInput
}

/**
 * `@handles` are parsed from the body and resolved to user ids. Handles that
 * resolve to nobody are dropped rather than rejected: a comment is prose, and
 * refusing to save someone's paragraph because they typed an `@` in front of a
 * word would be the wrong trade. Phase 5's editor offers autocomplete, which is
 * where "did you mean" belongs.
 */
export async function addComment(db: Db, args: AddCommentArgs): Promise<TaskCommentDto> {
  const { input } = args
  const now = nowOf(args)
  const task = await loadTask(db, input.taskId)

  const handles = parseMentions(input.body)
  const mentioned = handles.length
    ? await db.user.findMany({
        where: { username: { in: handles }, deletedAt: null },
        select: { id: true, username: true },
      })
    : []

  // Ordered by first appearance in the body, not by whatever the database
  // returned, so the stored array is stable across re-parses.
  const byHandle = new Map(mentioned.map((u) => [u.username, u.id]))
  const mentions = handles
    .map((handle) => byHandle.get(handle))
    .filter((id): id is string => id !== undefined)

  const comment = await db.taskComment.create({
    data: {
      taskId: task.id,
      authorId: args.actor.id,
      body: input.body,
      mentions,
      createdAt: now,
    },
    select: {
      id: true,
      taskId: true,
      body: true,
      mentions: true,
      createdAt: true,
      author: { select: PERSON_SELECT },
    },
  })

  await writeActivity(db, {
    taskId: task.id,
    actorId: args.actor.id,
    type: 'COMMENTED',
    to: comment.id,
    at: now,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'task.commented',
    entity: 'Task',
    entityId: task.id,
    after: { commentId: comment.id, mentions },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return { ...comment, mentions: [...comment.mentions] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transitions (SPEC §5.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which permission each edge needs (SPEC §6). Exported so `actions.ts` and its
 * tests read the same table — a second copy in the action layer is how a
 * `task.approve`-only edge quietly becomes a `task.edit` one.
 */
export const TRANSITION_PERMISSION: Readonly<Record<TaskStatus, Permission>> = {
  BACKLOG: 'task.edit',
  ASSIGNED: 'task.assign',
  IN_PROGRESS: 'task.edit',
  SUBMITTED: 'task.edit',
  IN_REVIEW: 'task.edit',
  REVISION_REQUESTED: 'task.approve',
  APPROVED: 'task.approve',
  DONE: 'task.approve',
  BLOCKED: 'task.edit',
  CANCELLED: 'task.cancel',
}

export function permissionForTransition(to: TaskStatus): Permission {
  return TRANSITION_PERMISSION[to]
}

/**
 * The status a task was blocked out of, recovered from its activity feed.
 *
 * There is no `statusBeforeBlock` column on purpose: the feed already records
 * every `STATUS_CHANGED` with its `from`, and a second copy of the same fact is
 * a second thing that can be wrong. Ordered by `id` as well as `createdAt`
 * because a frozen clock in a test can produce two rows at the same instant.
 */
async function statusBeforeBlock(db: Db, taskId: string): Promise<TaskStatus | null> {
  const row = await db.taskActivity.findFirst({
    where: { taskId, type: 'STATUS_CHANGED', to: 'BLOCKED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { from: true },
  })
  return (row?.from as TaskStatus | undefined) ?? null
}

export interface TransitionTaskArgs extends TaskMutationArgs {
  input: TransitionTaskInput
  /** Required for APPROVED. */
  qualityRating?: number | undefined
  /** Required for REVISION_REQUESTED (SPEC T4: a revision sets a new due date). */
  newDueDate?: Date | undefined
  events?: TaskEventBus
  /**
   * Optional today. `lib/calendar` throws `NotImplementedError` until Phase 6,
   * so production passes nothing and only `elapsedMinutesRaw` — pure
   * arithmetic — is written on submission. `elapsedMinutesWorking` stays the
   * job-updated column SPEC §4 calls it, filled by `recomputeElapsed` once
   * Phase 6 lands. Tests pass a fake and get both.
   */
  calendar?: Calendar | undefined
}

/**
 * The single write path for every status change. Named wrappers below exist for
 * readability at the call site; they all come back through here, so there is
 * exactly one place that validates an edge, stamps a timestamp and records the
 * two histories.
 *
 * ── Who may move a task is a permission, not an ownership check ───────────
 *
 * Nothing here requires the caller to *be* the assignee. SPEC §6 gates these
 * edges by key (`task.edit` to start/submit, `task.approve` to approve,
 * `task.cancel` to cancel) and says nothing about ownership, and a manager
 * submitting on behalf of a worker who is out sick is an ordinary day at an
 * agency of this size. What stops a منفّذ touching someone else's task is
 * `scopeTasks`: they cannot read it, so they cannot name its id.
 *
 * If a later phase wants "only the assignee may submit", that is a policy
 * addition and belongs in docs/SPEC.md §6 first — recorded here so the absence
 * reads as a decision rather than an oversight.
 */
export async function transitionTask(
  db: Db,
  args: TransitionTaskArgs,
): Promise<TaskTransitionResultDto> {
  const { input } = args
  const now = nowOf(args)
  const events = args.events ?? noopTaskEvents

  const task = await loadTask(db, input.taskId)
  const from = task.status as TaskStatus
  const to = input.to

  const context =
    from === 'BLOCKED' ? { previousStatus: await statusBeforeBlock(db, task.id) } : {}

  assertTransition(from, to, context)

  // Approval is the event that creates money (SPEC §5.1), so its one required
  // input is checked here in the service and not only in the Zod schema — a
  // caller reaching `transitionTask` directly must not be able to approve
  // without the rating the performance score depends on (SPEC §5.6).
  const rating = args.qualityRating
  if (to === 'APPROVED') {
    if (rating === undefined || rating === null) {
      throw new DomainError('tasks.errors.ratingRequired', { taskId: task.id })
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new DomainError('tasks.errors.ratingRange', { rating })
    }
  }
  if (to === 'REVISION_REQUESTED' && !args.newDueDate) {
    throw new DomainError('validation.required', { field: 'newDueDate' })
  }
  if ((to === 'BLOCKED' || to === 'CANCELLED') && !input.reason) {
    throw new DomainError('validation.required', { field: 'reason' })
  }

  const timestamps: TaskTimestamps = {
    assignedAt: task.assignedAt,
    startedAt: task.startedAt,
    submittedAt: task.submittedAt,
    approvedAt: task.approvedAt,
  }
  const stamps = stampTimestamps(to, timestamps, now, from)

  // SPEC §5.2. Measured against the `submittedAt` the row will actually hold
  // after this update — `now` for a real delivery, and the preserved original
  // when this is a resume out of BLOCKED that stamps nothing.
  const elapsed =
    to === 'SUBMITTED'
      ? await computeElapsed(args.calendar ?? RAW_ONLY_CALENDAR, {
          assignedAt: task.assignedAt,
          submittedAt: stamps.submittedAt ?? task.submittedAt,
          assigneeId: task.assigneeId,
        })
      : null

  await db.task.update({
    where: { id: task.id },
    data: {
      status: to,
      ...stamps,
      ...(to === 'APPROVED' ? { qualityRating: args.qualityRating } : {}),
      // SPEC T4: the revision accrues against a new deadline, while
      // `originalDueDate` keeps pointing at the first one.
      ...(to === 'REVISION_REQUESTED' && args.newDueDate
        ? { dueDate: args.newDueDate }
        : {}),
      // A block is, by definition, a cause of delay, so its reason lands in
      // `delayReason` where the task itself shows it. A *cancellation* reason
      // does not: the task is not delayed, it is gone, and writing "the client
      // dropped the scope" into a field that feeds delay reporting would
      // mislabel it. That reason lives in the AuditLog row and the
      // `TaskCancelled` event, both written below.
      ...(to === 'BLOCKED' && input.reason ? { delayReason: input.reason } : {}),
      ...(elapsed
        ? {
            elapsedMinutesRaw: elapsed.raw,
            // Only overwrite the working figure when a real calendar answered.
            ...(args.calendar ? { elapsedMinutesWorking: elapsed.working } : {}),
          }
        : {}),
    },
  })

  await writeActivity(db, {
    taskId: task.id,
    actorId: args.actor.id,
    type: 'STATUS_CHANGED',
    from,
    to,
    at: now,
  })

  if (to === 'REVISION_REQUESTED' && args.newDueDate) {
    await writeActivity(db, {
      taskId: task.id,
      actorId: args.actor.id,
      type: 'DUE_DATE_CHANGED',
      from: task.dueDate.toISOString(),
      to: args.newDueDate.toISOString(),
      at: now,
    })
  }

  await recordAudit(db, {
    actor: args.actor,
    action: auditActionFor(to),
    entity: 'Task',
    entityId: task.id,
    before: { status: from },
    after: {
      status: to,
      ...(to === 'APPROVED' ? { qualityRating: args.qualityRating } : {}),
      ...(to === 'REVISION_REQUESTED' && args.newDueDate
        ? { dueDate: args.newDueDate }
        : {}),
      ...(elapsed ? { elapsedMinutesRaw: elapsed.raw } : {}),
    },
    ...(input.reason ? { reason: input.reason } : {}),
    ...(args.ip ? { ip: args.ip } : {}),
  })

  if (to === 'APPROVED') {
    await events.emit(db, {
      type: 'TaskApproved',
      taskId: task.id,
      projectId: task.projectId,
      assigneeId: task.assigneeId,
      taskValue: money(task.taskValue),
      qualityRating: args.qualityRating as number,
      approvedAt: now,
      approvedById: args.actor.id,
    })
  }

  if (to === 'CANCELLED') {
    await events.emit(db, {
      type: 'TaskCancelled',
      taskId: task.id,
      projectId: task.projectId,
      assigneeId: task.assigneeId,
      // Phase 7 needs this to know whether an EARNING already exists and a
      // REVERSAL is owed — SPEC §5.1 lets APPROVED → CANCELLED happen.
      wasApproved: from === 'APPROVED',
      cancelledAt: now,
      cancelledById: args.actor.id,
      reason: input.reason ?? '',
    })
  }

  return {
    task: await detail(db, task.id, now),
    // Finish-to-start is checked where it means something: at the moment work
    // starts. It informs; it never gates — the update above has already
    // committed by the time this is computed.
    warnings: to === 'IN_PROGRESS' ? await getDependencyWarnings(db, task.id) : [],
  }
}

/**
 * Answers only the raw half. Used when no real calendar was supplied, so that
 * `computeElapsed` keeps its single code path instead of the caller branching
 * around it. `computeElapsed` clamps working into `[0, raw]`, so the zero here
 * is never written unless a real calendar was passed.
 */
const RAW_ONLY_CALENDAR: Calendar = {
  isWorkingDay: async () => true,
  workingDaysBetween: async () => 0,
  workingMinutesBetween: async () => 0,
  addWorkingDays: async (date) => date,
  nextWorkingDay: async (date) => date,
}

function auditActionFor(to: TaskStatus): string {
  if (to === 'APPROVED') return 'task.approved'
  if (to === 'REVISION_REQUESTED') return 'task.revisionRequested'
  if (to === 'CANCELLED') return 'task.cancelled'
  return 'task.statusChanged'
}

// ── Named wrappers ───────────────────────────────────────────────────────────

type SimpleTransitionArgs = TaskMutationArgs & {
  input: { taskId: string }
  events?: TaskEventBus
  calendar?: Calendar | undefined
}

export async function startTask(
  db: Db,
  args: SimpleTransitionArgs,
): Promise<TaskTransitionResultDto> {
  return transitionTask(db, {
    ...args,
    input: { taskId: args.input.taskId, to: 'IN_PROGRESS', reason: null },
  })
}

export async function submitTask(
  db: Db,
  args: SimpleTransitionArgs,
): Promise<TaskTransitionResultDto> {
  return transitionTask(db, {
    ...args,
    input: { taskId: args.input.taskId, to: 'SUBMITTED', reason: null },
  })
}

export async function reviewTask(
  db: Db,
  args: SimpleTransitionArgs,
): Promise<TaskTransitionResultDto> {
  return transitionTask(db, {
    ...args,
    input: { taskId: args.input.taskId, to: 'IN_REVIEW', reason: null },
  })
}

export async function approveTask(
  db: Db,
  args: TaskMutationArgs & { input: ApproveTaskInput; events?: TaskEventBus },
): Promise<TaskTransitionResultDto> {
  return transitionTask(db, {
    ...args,
    input: { taskId: args.input.taskId, to: 'APPROVED', reason: null },
    qualityRating: args.input.qualityRating,
  })
}

export async function requestRevision(
  db: Db,
  args: TaskMutationArgs & { input: RequestRevisionInput; events?: TaskEventBus },
): Promise<TaskTransitionResultDto> {
  return transitionTask(db, {
    ...args,
    input: {
      taskId: args.input.taskId,
      to: 'REVISION_REQUESTED',
      reason: args.input.reason,
    },
    newDueDate: args.input.newDueDate,
  })
}

export async function completeTask(
  db: Db,
  args: SimpleTransitionArgs,
): Promise<TaskTransitionResultDto> {
  return transitionTask(db, {
    ...args,
    input: { taskId: args.input.taskId, to: 'DONE', reason: null },
  })
}

export async function blockTask(
  db: Db,
  args: TaskMutationArgs & { input: BlockTaskInput },
): Promise<TaskTransitionResultDto> {
  return transitionTask(db, {
    ...args,
    input: { taskId: args.input.taskId, to: 'BLOCKED', reason: args.input.reason },
  })
}

/**
 * SPEC §5.1's `BLOCKED → previous`. The target is not the caller's to choose —
 * it is whatever the activity feed says the task was doing when it was blocked.
 */
export async function unblockTask(
  db: Db,
  args: SimpleTransitionArgs,
): Promise<TaskTransitionResultDto> {
  const task = await loadTask(db, args.input.taskId)
  if (task.status !== 'BLOCKED') {
    throw new DomainError('tasks.errors.notBlocked', { taskId: task.id })
  }

  const previous = await statusBeforeBlock(db, task.id)
  if (!previous) {
    throw new DomainError('tasks.errors.noPreviousStatus', { taskId: task.id })
  }

  return transitionTask(db, {
    ...args,
    input: { taskId: task.id, to: previous, reason: null },
  })
}

export async function cancelTask(
  db: Db,
  args: TaskMutationArgs & { input: CancelTaskInput; events?: TaskEventBus },
): Promise<TaskTransitionResultDto> {
  return transitionTask(db, {
    ...args,
    input: { taskId: args.input.taskId, to: 'CANCELLED', reason: args.input.reason },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Elapsed time — the job-updated columns (SPEC §4, §5.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface RecomputeElapsedArgs {
  taskId: string
  calendar: Calendar
  actor?: Actor | null
  now?: Date
}

/**
 * Recompute both denormalised elapsed columns for one task.
 *
 * This is what Phase 6's 03:00 job calls. Idempotent by construction — it is a
 * pure function of `assignedAt`, `submittedAt` and the calendar, so running it
 * ten times writes the same two numbers. An activity row is written only when a
 * value actually changed, so a nightly no-op does not spam the feed.
 */
export async function recomputeElapsed(
  db: Db,
  args: RecomputeElapsedArgs,
): Promise<{ raw: number; working: number }> {
  const task = await db.task.findFirst({
    where: { id: args.taskId, ...ALIVE },
    select: {
      id: true,
      assigneeId: true,
      assignedAt: true,
      submittedAt: true,
      elapsedMinutesRaw: true,
      elapsedMinutesWorking: true,
    },
  })
  if (!task) throw new NotFoundError('Task', args.taskId)

  const elapsed = await computeElapsed(args.calendar, {
    assignedAt: task.assignedAt,
    submittedAt: task.submittedAt,
    assigneeId: task.assigneeId,
  })

  const changed =
    elapsed.raw !== task.elapsedMinutesRaw ||
    elapsed.working !== task.elapsedMinutesWorking

  if (!changed) return elapsed

  await db.task.update({
    where: { id: task.id },
    data: {
      elapsedMinutesRaw: elapsed.raw,
      elapsedMinutesWorking: elapsed.working,
    },
  })

  await writeActivity(db, {
    taskId: task.id,
    actorId: args.actor?.id ?? null,
    type: 'ELAPSED_RECOMPUTED',
    from: String(task.elapsedMinutesWorking),
    to: String(elapsed.working),
    at: args.now ?? new Date(),
  })

  return elapsed
}
