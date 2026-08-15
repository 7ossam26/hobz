'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'

import {
  addCommentSchema,
  approveTaskSchema,
  assignTaskSchema,
  blockTaskSchema,
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
import type { TaskDetailDto, TaskTransitionResultDto } from './types'

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

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

async function categories() {
  return getSetting('tasks.categories')
}

function revalidateTask(taskId: string, projectId?: string): void {
  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  if (projectId) revalidatePath(`/projects/${projectId}`)
}

export const createTaskAction = requirePermission(
  'task.create',
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const input = createTaskSchema.parse(raw)
    const result = await createTask(prisma, {
      actor,
      input,
      categories: await categories(),
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
  async (actor, raw: unknown): Promise<TaskDetailDto> => {
    const input = assignTaskSchema.parse(raw)
    const task = await assignTask(prisma, { actor, input, ip: await ip() })
    revalidateTask(task.id, task.projectId)
    return task
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

export const startTaskAction = requirePermission(
  permissionForTransition('IN_PROGRESS'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const { id } = taskIdSchema.parse(raw)
    const result = await startTask(prisma, {
      actor,
      input: { taskId: id },
      ip: await ip(),
    })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const submitTaskAction = requirePermission(
  permissionForTransition('SUBMITTED'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const { id } = taskIdSchema.parse(raw)
    const result = await submitTask(prisma, {
      actor,
      input: { taskId: id },
      ip: await ip(),
    })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const reviewTaskAction = requirePermission(
  permissionForTransition('IN_REVIEW'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const { id } = taskIdSchema.parse(raw)
    const result = await reviewTask(prisma, {
      actor,
      input: { taskId: id },
      ip: await ip(),
    })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const approveTaskAction = requirePermission(
  permissionForTransition('APPROVED'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const input = approveTaskSchema.parse(raw)
    const result = await approveTask(prisma, { actor, input, ip: await ip() })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const requestRevisionAction = requirePermission(
  permissionForTransition('REVISION_REQUESTED'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const input = requestRevisionSchema.parse(raw)
    const result = await requestRevision(prisma, { actor, input, ip: await ip() })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const completeTaskAction = requirePermission(
  permissionForTransition('DONE'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const { id } = taskIdSchema.parse(raw)
    const result = await completeTask(prisma, {
      actor,
      input: { taskId: id },
      ip: await ip(),
    })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const blockTaskAction = requirePermission(
  permissionForTransition('BLOCKED'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const input = blockTaskSchema.parse(raw)
    const result = await blockTask(prisma, { actor, input, ip: await ip() })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const unblockTaskAction = requirePermission(
  'task.edit',
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const { id } = taskIdSchema.parse(raw)
    const result = await unblockTask(prisma, {
      actor,
      input: { taskId: id },
      ip: await ip(),
    })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const cancelTaskAction = requirePermission(
  permissionForTransition('CANCELLED'),
  async (actor, raw: unknown): Promise<TaskTransitionResultDto> => {
    const input = cancelTaskSchema.parse(raw)
    const result = await cancelTask(prisma, { actor, input, ip: await ip() })
    revalidateTask(result.task.id, result.task.projectId)
    return result
  },
)

export const addTaskCommentAction = requirePermission(
  'task.comment',
  async (actor, raw: unknown) => {
    const input = addCommentSchema.parse(raw)
    const comment = await addComment(prisma, { actor, input, ip: await ip() })
    revalidateTask(input.taskId)
    return comment
  },
)
