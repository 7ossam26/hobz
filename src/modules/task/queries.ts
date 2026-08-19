import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { scopeTasks } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'

import { listTasksSchema } from './schema'
import {
  getDependencyGraph,
  getDependencyWarnings,
  getTask,
  listActivity,
  listComments,
  listTasks,
} from './service'
import { TASK_STATUSES, type TaskStatus } from './state-machine'
import type {
  DependencyRowDto,
  DependencyWarningDto,
  TaskActivityDto,
  TaskCommentDto,
  TaskDetailDto,
  TaskPageDto,
  TaskSummaryDto,
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

/** The "مستحقة قريبًا" facet's horizon (Settings, never a literal here). */
async function dueSoonDays() {
  return getSetting('tasks.dueSoonDays')
}

export async function getTasks(
  raw: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<TaskPageDto> {
  const actor = await requireActor()
  const filters = listTasksSchema.parse(raw)
  return listTasks(prisma, {
    scope: scopeTasks(actor),
    filters,
    now,
    dueSoonDays: await dueSoonDays(),
  })
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

/** The full dependency graph (both directions, satisfied and not) — the sheet's manage-able list. */
export async function getTaskDependencyGraph(
  taskId: string,
): Promise<{ dependencies: DependencyRowDto[]; dependents: DependencyRowDto[] }> {
  await getTaskById(taskId)
  return getDependencyGraph(prisma, taskId)
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

export interface TaskOptionDto {
  id: string
  title: string
}

/**
 * The lean per-project task list the dependency picker needs (Phase 5's
 * dependencies tab) — scoped exactly like every other task read, so a
 * `task.view.assigned` holder is offered only tasks they could otherwise
 * open, mirroring `getUserOptions`/`getProjectOptions`.
 */
export async function getTaskOptionsForProject(
  projectId: string,
): Promise<TaskOptionDto[]> {
  const actor = await requireActor()
  return prisma.task.findMany({
    where: {
      AND: [
        scopeTasks(actor),
        { projectId, deletedAt: null, project: { deletedAt: null } },
      ],
    },
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
    take: 200,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — board and calendar reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The whole scoped-and-filtered set once, grouped or windowed in the app
 * rather than the database — the same trade `listTasks`'s Arabic-search
 * branch already makes at SPEC §2's ~100-person scale (`modules/task/
 * service.ts`), extended here because a Kanban column and a calendar month
 * both need "all of it, sliced a different way" rather than one server page.
 *
 * `pageSize: 1000` is `listTasksSchema`'s ceiling. `truncated` says whether
 * that ceiling was actually hit, so a caller can tell the user rather than
 * silently showing an incomplete board — CLAUDE.md's explainability rule
 * applies to "is this the whole list" as much as it does to a deduction.
 */
async function scopedTaskSet(
  raw: Record<string, unknown>,
  now: Date,
): Promise<{ items: TaskSummaryDto[]; truncated: boolean }> {
  const actor = await requireActor()
  const filters = listTasksSchema.parse({ ...raw, page: 1, pageSize: 1000 })
  const page = await listTasks(prisma, {
    scope: scopeTasks(actor),
    filters,
    now,
    dueSoonDays: await dueSoonDays(),
  })
  return { items: page.items, truncated: page.total > page.items.length }
}

export interface TaskBoardColumnDto {
  status: TaskStatus
  tasks: TaskSummaryDto[]
}

export interface TaskBoardDto {
  columns: TaskBoardColumnDto[]
  truncated: boolean
}

/** Grouped by status, in `TASK_STATUS` pipeline order — the board's columns. */
export async function getTaskBoard(
  raw: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<TaskBoardDto> {
  const { items, truncated } = await scopedTaskSet(raw, now)

  const byStatus = new Map<TaskStatus, TaskSummaryDto[]>(
    TASK_STATUSES.map((status) => [status, []]),
  )
  for (const task of items) byStatus.get(task.status)?.push(task)

  return {
    columns: TASK_STATUSES.map((status) => ({
      status,
      tasks: byStatus.get(status) ?? [],
    })),
    truncated,
  }
}

export interface TaskCalendarDto {
  items: TaskSummaryDto[]
  truncated: boolean
}

/**
 * Tasks due inside `[from, to]` — a calendar grid's one query per range.
 *
 * The range is part of the `where`, not a filter applied afterwards. It used to
 * fetch the whole scoped set up to the 1000-row ceiling and discard everything
 * outside the visible month in application code, so a month view of a busy
 * agency read — and serialised — roughly thirty times the rows it drew. It also
 * made `truncated` mean the wrong thing: the ceiling could be hit by tasks in
 * *other* months and warn the user their calendar was incomplete when it was
 * not. Both follow from pushing two comparisons into SQL on an indexed column.
 */
export async function getTaskCalendar(
  raw: Record<string, unknown>,
  range: { from: Date; to: Date },
  now: Date = new Date(),
): Promise<TaskCalendarDto> {
  return scopedTaskSet({ ...raw, dueFrom: range.from, dueTo: range.to }, now)
}
