import { timed } from '@/lib/perf'
import { getProjects } from '@/modules/project/queries'
import { getTaskCalendar } from '@/modules/task/queries'

/**
 * modules/calendar/queries.ts — the global deadlines view (phase brief item
 * 6): "all deadlines, filterable by project/worker."
 *
 * Composed entirely from `getTaskCalendar` and `getProjects` — both already
 * RBAC-scoped (CLAUDE.md invariant 3) and already the calendar/list reads
 * Phase 5 built, so a `task.view.assigned` worker opening this page sees
 * exactly their own scope here too, with no second scoping rule to keep in
 * sync with `lib/rbac`.
 *
 * Milestones are deliberately not a third event type: a milestone has no
 * assignee, so "filterable by... worker" cannot apply to it the way it does
 * to a task, and it is already visible inside its own project's milestone
 * list. Deadlines here means the two entities SPEC §4 actually gives a
 * `dueDate` a person is accountable for.
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

  const [taskCalendar, projectPage] = await Promise.all([
    timed('calendar.global.tasks', () => getTaskCalendar(taskFilters, range, now)),
    // A worker filter narrows to deadlines that are theirs — a project has no
    // single accountable assignee, so it is skipped entirely rather than
    // fetched and then discarded.
    filters.workerId
      ? Promise.resolve(null)
      : timed('calendar.global.projects', () => getProjects({ pageSize: 100 }, now)),
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
    href: `/tasks/${task.id}`,
  }))

  const projectEvents: CalendarEventDto[] = (projectPage?.items ?? [])
    .filter((project) => project.dueDate >= range.from && project.dueDate <= range.to)
    .filter((project) => !filters.projectId || project.id === filters.projectId)
    .map((project) => ({
      id: `project:${project.id}`,
      type: 'PROJECT',
      title: project.name,
      date: project.dueDate,
      projectId: project.id,
      projectName: project.name,
      projectCode: project.code,
      workerId: null,
      workerName: null,
      status: project.status,
      href: `/projects/${project.id}`,
    }))

  const events = [...taskEvents, ...projectEvents].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  )

  return {
    events,
    truncated: taskCalendar.truncated || (projectPage?.total ?? 0) > (projectPage?.items.length ?? 0),
  }
}
