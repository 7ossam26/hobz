'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requireAuth, requirePermission } from '@/lib/auth/session'
import { calendarFor } from '@/lib/calendar'
import { prisma } from '@/lib/db'
import { ForbiddenError } from '@/lib/errors'
import { fanOut } from '@/lib/events'
import { can, type Actor } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'
import { getExtensionList } from '@/modules/extension/queries'
import type { ExtensionRequestDto } from '@/modules/extension/types'
import { prismaLeaveLookup } from '@/modules/leave/lookup'
import { ledgerTaskEvents } from '@/modules/ledger/earnings'
import { prismaLedgerPort } from '@/modules/ledger/port'
import { notificationTaskEvents } from '@/modules/notification/bus'
import { prismaPenaltyPort } from '@/modules/penalty/port'
import { getTaskPenaltyPanel } from '@/modules/penalty/queries'
import type { TaskPenaltyPanelDto } from '@/modules/penalty/types'
import type { TaskEventBus } from '@/modules/task/ports'

import {
  getTaskActivity,
  getTaskById,
  getTaskComments,
  getTaskDependencyGraph,
  getTaskDependencyWarnings,
  getTaskOptionsForProject,
  type TaskOptionDto,
} from './queries'
import {
  addCommentSchema,
  approveTaskSchema,
  assignTaskSchema,
  blockTaskSchema,
  bulkAssignTasksSchema,
  bulkSetDueDateSchema,
  bulkSetPrioritySchema,
  cancelTaskSchema,
  createTaskSchema,
  requestRevisionSchema,
  taskDependencySchema,
  taskIdSchema,
  taskWatcherSchema,
  updateTaskSchema,
} from './schema'
import {
  addComment,
  addDependency,
  addWatcher,
  approveTask,
  assignTask,
  blockTask,
  cancelTask,
  completeTask,
  createTask,
  removeDependency,
  removeWatcher,
  requestRevision,
  reviewTask,
  startTask,
  submitTask,
  unblockTask,
  permissionForTransition,
  updateTask,
} from './service'
import type {
  DependencyRowDto,
  DependencyWarningDto,
  TaskActivityDto,
  TaskAssignmentResultDto,
  TaskCommentDto,
  TaskCreationResultDto,
  TaskDetailDto,
  TaskTransitionResultDto,
} from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate
 * (CLAUDE.md invariant 3).
 *
 * Every transition action reads its permission from `permissionForTransition`
 * rather than repeating a literal. The table lives in `service.ts` next to the
 * machine it describes, and deriving from it is what stops the two from
 * drifting — a `task.approve` edge quietly becoming a `task.edit` one is
 * exactly the kind of change that looks like a typo in review and is a
 * privilege escalation in production. The mapping is SPEC §6's:
 *   approve / request revision / complete  → `task.approve`
 *   cancel                                 → `task.cancel`
 *   assign / reassign                      → `task.assign`
 *   start / submit / review / block        → `task.edit`
 *   comment                                → `task.comment`
 *
 * `unblockTaskAction` is the one that cannot derive: its target is whatever
 * the task was doing before it was blocked, which is only known after a read.
 * It gates on `task.edit`, the permission every blockable status carries.
 *
 * Note what is *not* here: no `deleteTaskAction`. SPEC §6 has no `task.delete`
 * key, and inventing one to match the `deletedAt` column would be inventing a
 * permission. Cancellation is how a task stops existing for its worker.
 */

/**
 * SPEC §5.1's EARNING/REVERSAL and SPEC §8's notification both react to
 * `TaskApproved`/`TaskCancelled` — two subscribers on one bus, composed once
 * here rather than at each call site (CLAUDE.md: "subscribe to events
 * centrally"). The ledger runs first, so a notification describing a payment
 * never fires before the payment exists.
 */
const approvalAndCancellationEvents: TaskEventBus = fanOut([
  ledgerTaskEvents,
  notificationTaskEvents,
])

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

async function categories() {
  return getSetting('tasks.categories')
}

function assignedWorkOnly(actor: Actor): boolean {
  if (can(actor, 'task.edit')) return false
  if (can(actor, 'task.work.assigned')) return true
  throw new ForbiddenError('task.work.assigned')
}

function revalidateTask(_taskId: string, projectId?: string): void {
  revalidatePath('/tasks')
  if (projectId) revalidatePath(`/projects/${projectId}`)
}

export const createTaskAction = requirePermission(
  'task.create',
  async (actor, raw: unknown): Promise<TaskCreationResultDto> => {
    const input = createTaskSchema.parse(raw)
    const result = await createTask(prisma, {
      actor,
      input,
      categories: await categories(),
      leave: prismaLeaveLookup,
      ip: await ip(),
    })
    revalidateTask(result.task.id, input.projectId)
    return result
  },
)

export const updateTaskAction = requirePermission(
  'task.edit',
  async (actor, raw: unknown): Promise<TaskDetailDto> => {
    const input = updateTaskSchema.parse(raw)
    const task = await updateTask(prisma, {
      actor,
      input,
      categories: await categories(),
      ip: await ip(),
    })
    revalidateTask(task.id, task.projectId)
    return task
  },
)

export const assignTaskAction = requirePermission(
  permissionForTransition('ASSIGNED'),
  async (actor, raw: unknown): Promise<TaskAssignmentResultDto> => {
    const input = assignTaskSchema.parse(raw)
    const clientIp = await ip()
    // One transaction, because SPEC M4's "pay the previous assignee?" answer now
    // reaches a real ledger: the reassignment and the ADJUSTMENT it authorises
    // must commit together or not at all.
    const result = await prisma.$transaction((tx) =>
      assignTask(tx, {
        actor,
        input,
        leave: prismaLeaveLookup,
        ledger: prismaLedgerPort,
        events: notificationTaskEvents,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const addTaskWatcherAction = requirePermission(
  'task.assign',
  async (actor, raw: unknown): Promise<void> => {
    const input = taskWatcherSchema.parse(raw)
    await addWatcher(prisma, { actor, input, ip: await ip() })
    revalidateTask(input.taskId)
  },
)

export const removeTaskWatcherAction = requirePermission(
  'task.assign',
  async (actor, raw: unknown): Promise<void> => {
    const input = taskWatcherSchema.parse(raw)
    await removeWatcher(prisma, { actor, input, ip: await ip() })
    revalidateTask(input.taskId)
  },
)

export const addTaskDependencyAction = requirePermission(
  'task.edit',
  async (actor, raw: unknown): Promise<void> => {
    const input = taskDependencySchema.parse(raw)
    await addDependency(prisma, { actor, input, ip: await ip() })
    revalidateTask(input.taskId)
  },
)

export const removeTaskDependencyAction = requirePermission(
  'task.edit',
  async (actor, raw: unknown): Promise<void> => {
    const input = taskDependencySchema.parse(raw)
    await removeDependency(prisma, { actor, input, ip: await ip() })
    revalidateTask(input.taskId)
  },
)

export const startTaskAction = requireAuth(
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const workOnly = assignedWorkOnly(actor)
    const { id } = taskIdSchema.parse(raw)
    const clientIp = await ip()
    const result = await prisma.$transaction((tx) =>
      startTask(tx, {
        actor,
        input: { taskId: id },
        penalty: prismaPenaltyPort,
        assignedWorkOnly: workOnly,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const submitTaskAction = requireAuth(
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const workOnly = assignedWorkOnly(actor)
    const { id } = taskIdSchema.parse(raw)
    const clientIp = await ip()
    // SPEC §5.4: delivery is the edge that *freezes* the accrual, so the
    // deduction is recomputed here and shares the transaction with the status
    // change — a منفّذ must never be able to read a task as delivered while
    // their deduction is still growing.
    const result = await prisma.$transaction((tx) =>
      submitTask(tx, {
        actor,
        input: { taskId: id },
        // Phase 4 had to pass nothing here: `lib/calendar` threw until Phase 6,
        // so only `elapsedMinutesRaw` was written on submission and the working
        // figure waited for a job that did not exist. Both are written now, at
        // the moment of delivery (SPEC §5.2).
        calendar: calendarFor(tx),
        penalty: prismaPenaltyPort,
        events: notificationTaskEvents,
        assignedWorkOnly: workOnly,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const reviewTaskAction = requirePermission(
  permissionForTransition('IN_REVIEW'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const { id } = taskIdSchema.parse(raw)
    const clientIp = await ip()
    const result = await prisma.$transaction((tx) =>
      reviewTask(tx, {
        actor,
        input: { taskId: id },
        penalty: prismaPenaltyPort,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const approveTaskAction = requirePermission(
  permissionForTransition('APPROVED'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const input = approveTaskSchema.parse(raw)
    const clientIp = await ip()
    // SPEC §5.1: approval is the one event that creates money. The task update
    // and the EARNING it triggers share a transaction, so there is no window in
    // which a task is approved and nobody was paid for it.
    const result = await prisma.$transaction((tx) =>
      approveTask(tx, {
        actor,
        input,
        events: approvalAndCancellationEvents,
        penalty: prismaPenaltyPort,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    revalidatePath('/my-earnings')
    return result
  },
)

export const requestRevisionAction = requirePermission(
  permissionForTransition('REVISION_REQUESTED'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const input = requestRevisionSchema.parse(raw)
    const clientIp = await ip()
    // SPEC T4: this is the edge that seals the previous delivery's deduction and
    // opens a new round against the new deadline. Same transaction, so there is
    // no instant in which the new due date exists and the old penalty is still
    // being recalculated against it.
    const result = await prisma.$transaction((tx) =>
      requestRevision(tx, {
        actor,
        input,
        penalty: prismaPenaltyPort,
        events: notificationTaskEvents,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const completeTaskAction = requirePermission(
  permissionForTransition('DONE'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const { id } = taskIdSchema.parse(raw)
    const clientIp = await ip()
    const result = await prisma.$transaction((tx) =>
      completeTask(tx, {
        actor,
        input: { taskId: id },
        penalty: prismaPenaltyPort,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const blockTaskAction = requireAuth(
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const workOnly = assignedWorkOnly(actor)
    const input = blockTaskSchema.parse(raw)
    const clientIp = await ip()
    const result = await prisma.$transaction((tx) =>
      blockTask(tx, {
        actor,
        input,
        penalty: prismaPenaltyPort,
        assignedWorkOnly: workOnly,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const unblockTaskAction = requireAuth(
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const workOnly = assignedWorkOnly(actor)
    const { id } = taskIdSchema.parse(raw)
    const clientIp = await ip()
    const result = await prisma.$transaction((tx) =>
      unblockTask(tx, {
        actor,
        input: { taskId: id },
        penalty: prismaPenaltyPort,
        assignedWorkOnly: workOnly,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const cancelTaskAction = requirePermission(
  permissionForTransition('CANCELLED'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const input = cancelTaskSchema.parse(raw)
    const clientIp = await ip()
    // SPEC §5.1 lets APPROVED → CANCELLED happen, so a cancellation can land
    // after the money did and owes a REVERSAL. Same transaction, same reason.
    const result = await prisma.$transaction((tx) =>
      cancelTask(tx, {
        actor,
        input,
        events: approvalAndCancellationEvents,
        penalty: prismaPenaltyPort,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )
    revalidateTask(result.task.id, result.task.projectId)
    revalidatePath('/my-earnings')
    return result
  },
)

export const addTaskCommentAction = requirePermission(
  'task.comment',
  async (actor, raw: unknown) => {
    const input = addCommentSchema.parse(raw)
    const comment = await addComment(prisma, {
      actor,
      input,
      events: notificationTaskEvents,
      enforceReadScope: true,
      ip: await ip(),
    })
    revalidateTask(input.taskId)
    return comment
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — the detail sheet's fetch-on-open, and list-view bulk actions
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskSheetDataDto {
  task: TaskDetailDto
  comments: TaskCommentDto[]
  activity: TaskActivityDto[]
  warnings: DependencyWarningDto[]
  dependencies: DependencyRowDto[]
  dependents: DependencyRowDto[]
  /**
   * SPEC §5.4's deduction, recomputed live (Phase 8). Null when the caller may
   * not read it — `getTaskPenaltyPanel` allows `penalty.view`, or the assignee
   * reading their own task, and nobody else. Null rather than a throw, so a
   * منفّذ without `ledger.view.own` still gets their task sheet.
   */
  penalty: TaskPenaltyPanelDto | null
  /**
   * SPEC §5.3's تمديد, on the task it belongs to (Phase 12).
   *
   * Fetched here rather than by the tab, for the same reason everything else
   * on this sheet is: one round trip on open, never a client waterfall
   * (CLAUDE.md UI rules). `getExtensionList` is `requireAuth`-level — asking
   * for more time is not confidential — and the decision is what
   * `task.extend` gates.
   */
  extensions: ExtensionRequestDto[]
  /**
   * SPEC §8's WhatsApp templates, fetched once for the whole sheet rather than
   * by the assignee chip reaching for Settings itself — the chip is a shared,
   * data-only component (`components/data/user-chip.tsx`) and stays that way.
   */
  whatsappTemplates: Record<string, string>
}

/**
 * The task detail `EntitySheet`'s one round trip. Board and list rows only
 * carry a `TaskSummaryDto` (CLAUDE.md: never fetch data in a client waterfall
 * — the list itself is server-rendered), so opening the sheet on a row click
 * needs its own fetch; this is that fetch, done once and combined, following
 * the sheet's own documented exception: "opens the sheet in a pending state
 * around a server action — never a `useEffect` waterfall"
 * (`components/shared/entity-sheet.tsx`). `requireAuth`, not
 * `requirePermission`, because every read it composes already self-scopes via
 * `scopeTasks` (`modules/task/queries.ts`) — the same reason those queries
 * carry no `assertCan` gate of their own.
 */
export const getTaskSheetDataAction = requireAuth(
  async (_actor, taskId: string): Promise<TaskSheetDataDto> => {
    const [
      task,
      comments,
      activity,
      warnings,
      graph,
      penalty,
      extensions,
      whatsappTemplates,
    ] = await Promise.all([
      getTaskById(taskId),
      getTaskComments(taskId),
      getTaskActivity(taskId),
      getTaskDependencyWarnings(taskId),
      getTaskDependencyGraph(taskId),
      // Reading a penalty must never *create* one, and it does not:
      // `taskPenaltyPanel` assesses without writing. A caller who may not see
      // it gets `null` rather than an error, so one missing key does not take
      // the whole sheet down.
      getTaskPenaltyPanel({ taskId }).catch(() => null),
      getExtensionList({ taskId, page: 1, pageSize: 25 }),
      getSetting('whatsapp.templates'),
    ])
    return {
      task,
      comments,
      activity,
      warnings,
      dependencies: graph.dependencies,
      dependents: graph.dependents,
      penalty,
      extensions: extensions.items,
      whatsappTemplates,
    }
  },
)

/** The dependency picker's task list, fetched once the project is known. */
export const getTaskOptionsForProjectAction = requireAuth(
  async (_actor, projectId: string): Promise<TaskOptionDto[]> =>
    getTaskOptionsForProject(projectId),
)

export interface BulkTaskResultDto {
  succeeded: number
  failed: number
}

/**
 * The current row, in exactly the shape `updateTask`'s full-core-shape input
 * needs (`modules/task/schema.ts`'s `updateTaskSchema` — status and assignee
 * have their own guarded paths, but every other field is required together,
 * so a partial bulk edit still has to resend the rest unchanged).
 */
async function loadUpdatableCore(taskId: string) {
  return prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      milestoneId: true,
      priority: true,
      categoryId: true,
      estimatedHours: true,
      dueDate: true,
      delayReason: true,
      delayAttribution: true,
    },
  })
}

/**
 * `Promise.allSettled` over the individually-permission-checked and
 * individually-audited `assignTask`/`updateTask` (`modules/task/service.ts`,
 * unmodified) — a bulk action is orchestration, not new domain logic: one bad
 * row (an inactive assignee, a task deleted between page load and click)
 * fails on its own and the rest still land, which is why this returns a
 * count rather than throwing on the first rejection.
 */
export const bulkAssignTaskAction = requirePermission(
  permissionForTransition('ASSIGNED'),
  async (actor, raw: unknown): Promise<BulkTaskResultDto> => {
    const input = bulkAssignTasksSchema.parse(raw)
    const requestIp = await ip()

    const results = await Promise.allSettled(
      input.taskIds.map((taskId) =>
        assignTask(prisma, {
          actor,
          // `taskValue: null` — no override. Matches what
          // `assignTaskSchema.parse()` itself produces for an omitted field
          // (`moneySchema`'s transform), since this call bypasses the schema
          // and constructs the already-parsed `AssignTaskInput` directly.
          input: { taskId, assigneeId: input.assigneeId, taskValue: null },
          events: notificationTaskEvents,
          ip: requestIp,
        }),
      ),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    revalidatePath('/tasks')
    return { succeeded, failed: results.length - succeeded }
  },
)

export const bulkChangeTaskPriorityAction = requirePermission(
  'task.edit',
  async (actor, raw: unknown): Promise<BulkTaskResultDto> => {
    const input = bulkSetPrioritySchema.parse(raw)
    const cats = await categories()
    const requestIp = await ip()

    const results = await Promise.allSettled(
      input.taskIds.map(async (taskId) => {
        const row = await loadUpdatableCore(taskId)
        if (!row) throw new Error(`task ${taskId} not found`)
        await updateTask(prisma, {
          actor,
          categories: cats,
          ip: requestIp,
          input: {
            id: row.id,
            title: row.title,
            description: row.description,
            milestoneId: row.milestoneId,
            priority: input.priority,
            categoryId: row.categoryId,
            estimatedHours: row.estimatedHours.toNumber(),
            dueDate: row.dueDate,
            taskValue: null,
            delayReason: row.delayReason,
            delayAttribution: row.delayAttribution,
          },
        })
      }),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    revalidatePath('/tasks')
    return { succeeded, failed: results.length - succeeded }
  },
)

export const bulkChangeTaskDueDateAction = requirePermission(
  'task.edit',
  async (actor, raw: unknown): Promise<BulkTaskResultDto> => {
    const input = bulkSetDueDateSchema.parse(raw)
    const cats = await categories()
    const requestIp = await ip()

    const results = await Promise.allSettled(
      input.taskIds.map(async (taskId) => {
        const row = await loadUpdatableCore(taskId)
        if (!row) throw new Error(`task ${taskId} not found`)
        await updateTask(prisma, {
          actor,
          categories: cats,
          ip: requestIp,
          input: {
            id: row.id,
            title: row.title,
            description: row.description,
            milestoneId: row.milestoneId,
            priority: row.priority,
            categoryId: row.categoryId,
            estimatedHours: row.estimatedHours.toNumber(),
            dueDate: input.dueDate,
            taskValue: null,
            delayReason: row.delayReason,
            delayAttribution: row.delayAttribution,
          },
        })
      }),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    revalidatePath('/tasks')
    return { succeeded, failed: results.length - succeeded }
  },
)
