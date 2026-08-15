import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { scopeTasks } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'

import { listTasksSchema } from './schema'
import {
  getDependencyWarnings,
  getTask,
  listActivity,
  listComments,
  listTasks,
} from './service'
import type {
  DependencyWarningDto,
  TaskActivityDto,
  TaskCommentDto,
  TaskDetailDto,
  TaskPageDto,
} from './types'

/**
 * modules/task/queries.ts — read paths with RBAC scoping baked in (CLAUDE.md
 * invariant 3, SPEC §6).
 *
 * As in `modules/project/queries.ts` there is no `assertCan` gate: `task.view.*`
 * is scoped rather than all-or-nothing, and `scopeTasks()` *is* the
 * enforcement. A user holding neither permission gets a fragment that matches
 * nothing, so `getTaskById` on any task resolves to `NotFoundError` — never a
 * row, and never even a confirmation that the row exists.
 *
 * Per SPEC §6 as Phase 1 settled it, `task.view.assigned` means assignee or
 * watcher — literally. A project owner who wants to see every task in their
 * project holds `task.view.all`.
 */

async function categories() {
  return getSetting('tasks.categories')
}

export async function getTasks(
  raw: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<TaskPageDto> {
  const actor = await requireActor()
  const filters = listTasksSchema.parse(raw)
  return listTasks(prisma, { scope: scopeTasks(actor), filters, now })
}

export async function getTaskById(
  id: string,
  now: Date = new Date(),
): Promise<TaskDetailDto> {
  const actor = await requireActor()
  return getTask(prisma, { scope: scopeTasks(actor), id, now })
}

/**
 * The warning banner's data (SPEC §4: warning only, never blocking).
 *
 * Reached only after `getTaskById` has already proven the caller may see the
 * task, so the dependency rows themselves are not re-scoped — a dependency the
 * viewer cannot otherwise open is still a legitimate reason their own task is
 * waiting, and hiding it would produce a banner that says nothing.
 */
export async function getTaskDependencyWarnings(
  taskId: string,
): Promise<DependencyWarningDto[]> {
  await getTaskById(taskId)
  return getDependencyWarnings(prisma, taskId)
}

export async function getTaskComments(taskId: string): Promise<TaskCommentDto[]> {
  await getTaskById(taskId)
  return listComments(prisma, taskId)
}

export async function getTaskActivity(taskId: string): Promise<TaskActivityDto[]> {
  await getTaskById(taskId)
  return listActivity(prisma, taskId)
}

/** The Settings-defined category list, for the task form's select. */
export async function getTaskCategories() {
  await requireActor()
  return categories()
}
