import Link from 'next/link'

import { DateText } from '@/components/data/date-text'
import { ProjectMark } from '@/components/data/entity-marks'
import { HealthBadge } from '@/components/data/health-badge'
import { StatusChip } from '@/components/data/status-chip'
import { UserChip } from '@/components/data/user-chip'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import type { ProjectSummaryDto } from '@/modules/project/types'
import type { TaskSummaryDto } from '@/modules/task/types'

/**
 * The dashboard widget shell — a title, a count, and a "view all" link when
 * the underlying list has more than the preview shows. Shared by every
 * primary and secondary card on both dashboards so the same card reads the
 * same way regardless of what it counts.
 */
export function DashboardCard({
  title,
  total,
  viewAllHref,
  children,
}: {
  title: string
  total?: number
  viewAllHref?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
          {total !== undefined ? (
            <span className="text-muted-foreground ms-2 font-normal">({total})</span>
          ) : null}
        </CardTitle>
        {viewAllHref && total ? (
          <Link
            href={viewAllHref}
            className="text-accent-solid shrink-0 text-xs font-medium hover:underline"
          >
            {ar.dashboard.manager.viewAll}
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function TaskListWidget({
  tasks,
  emptyLabel,
  showAssignee = false,
}: {
  tasks: TaskSummaryDto[]
  emptyLabel: string
  showAssignee?: boolean
}) {
  if (tasks.length === 0) {
    return <EmptyState className="border-0 py-6" title={emptyLabel} />
  }

  return (
    <ul className="flex flex-col gap-3" role="list">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-medium">{task.title}</span>
            <ProjectMark
              project={{
                id: task.projectId,
                code: task.projectCode,
                name: task.projectName,
              }}
              showName
              className="text-fg-subtle"
            />
            {showAssignee && task.assignee ? (
              <UserChip user={task.assignee} size="sm" showWhatsapp={false} />
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusChip status={task.status} size="sm" />
            <DateText value={task.dueDate} variant="short" className="text-xs" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ProjectListWidget({
  projects,
  emptyLabel,
}: {
  projects: ProjectSummaryDto[]
  emptyLabel: string
}) {
  if (projects.length === 0) {
    return <EmptyState className="border-0 py-6" title={emptyLabel} />
  }

  return (
    <ul className="flex flex-col gap-3" role="list">
      {projects.map((project) => (
        <li key={project.id} className="flex items-center justify-between gap-3">
          <ProjectMark project={project} showName className="min-w-0" />
          <HealthBadge
            health={project.health.health}
            overridden={project.health.overridden}
            reason={project.health.reason ?? undefined}
          />
        </li>
      ))}
    </ul>
  )
}
