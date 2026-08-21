import { taskHref } from '@/lib/entity-href'
import { timed } from '@/lib/perf'
import { getProjects } from '@/modules/project/queries'
import { getTaskCalendar } from '@/modules/task/queries'

/**
 * modules/calendar/queries.ts — the global deadlines view (phase brief item
 * 6): "all deadlines, filterable by project/worker."
 *
 * Composed entirely from `getTaskCalendar` and `getProjects` — both already
 * RBAC-scoped (CLAUDE.md invariant 3). Facets only narrow those existing
 * scopes: a worker means `Task.assigneeId` for a task and `Project.ownerId`
 * for a project, while a project facet intersects either entity's worker
 * predicate rather than replacing it.
 *
 * Milestones are deliberately not a third event type: a milestone has no
 * assignee, so "filterable by... worker" cannot apply to it the way it does
 * to a task, and it is already visible inside its own project's milestone
 * list. Deadlines here means the two entities SPEC §4 actually gives a
 * `dueDate` a person is accountable for. Project rows are range-filtered in
 * SQL before the 100-row calendar ceiling, ordered by due date so any real
 * truncation keeps the earliest deadlines visible and reports that omission.
 */

export type CalendarEventType = 'TASK' | 'PROJECT'

export interface CalendarEventDto {
  id: string
  type: CalendarEventType
  title: string
  date: Date
  projectId: string
  projectName: string
  projectCode: string
  workerId: string | null
  workerName: string | null
  /** `TaskStatus` for a task event, `ProjectStatus` for a project event. */
  status: string
  href: string
}

export interface GlobalCalendarFilters {
  projectId?: string
  workerId?: string
}

export interface GlobalCalendarDto {
  events: CalendarEventDto[]
  /** True when either underlying read hit its own page ceiling. */
  truncated: boolean
}

export async function getGlobalCalendarEvents(
  range: { from: Date; to: Date },
  filters: GlobalCalendarFilters = {},
  now: Date = new Date(),
): Promise<GlobalCalendarDto> {
  const taskFilters: Record<string, unknown> = {}
  if (filters.projectId) taskFilters.projectId = [filters.projectId]
  if (filters.workerId) taskFilters.assigneeId = [filters.workerId]

  const projectFilters: Record<string, unknown> = {
    dueFrom: range.from,
    dueTo: range.to,
    sort: 'dueDate',
    dir: 'asc',
    pageSize: 100,
  }
  if (filters.projectId) projectFilters.id = [filters.projectId]
  // The one accountable person on a project (SPEC §4 `ownerId`,
  // «مسؤول المشروع») — the project-side answer to `assigneeId` on a task.
  if (filters.workerId) projectFilters.ownerId = [filters.workerId]

  const [taskCalendar, projectPage] = await Promise.all([
    timed('calendar.global.tasks', () => getTaskCalendar(taskFilters, range, now)),
    timed('calendar.global.projects', () => getProjects(projectFilters, now)),
  ])

  const taskEvents: CalendarEventDto[] = taskCalendar.items.map((task) => ({
    id: `task:${task.id}`,
    type: 'TASK',
    title: task.title,
    date: task.dueDate,
    projectId: task.projectId,
    projectName: task.projectName,
    projectCode: task.projectCode,
    workerId: task.assignee?.id ?? null,
    workerName: task.assignee?.fullName ?? null,
    status: task.status,
    // Mirrors `modules/notification/service.ts`'s `hrefFor` — the same target
    // a `TASK_DUE_SOON` notification already links to.
    href: taskHref(task.id),
  }))

  const projectEvents: CalendarEventDto[] = projectPage.items.map((project) => ({
    id: `project:${project.id}`,
    type: 'PROJECT',
    title: project.name,
    date: project.dueDate,
    projectId: project.id,
    projectName: project.name,
    projectCode: project.code,
    workerId: project.owner.id,
    workerName: project.owner.fullName,
    status: project.status,
    href: `/projects/${project.id}`,
  }))

  const events = [...taskEvents, ...projectEvents].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  )

  return {
    events,
    truncated: taskCalendar.truncated || projectPage.total > projectPage.items.length,
  }
}
