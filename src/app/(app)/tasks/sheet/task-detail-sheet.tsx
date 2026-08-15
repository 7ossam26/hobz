'use client'

import { PriorityFlag } from '@/components/data/priority-flag'
import { EntitySheet, type EntitySheetTab } from '@/components/shared/entity-sheet'
import { ar } from '@/i18n/ar'
import { taskStatusHue } from '@/lib/palette'
import type { TaxonomyEntry } from '@/lib/settings'
import type { TaskSheetDataDto } from '@/modules/task/actions'
import type { UserOptionDto } from '@/modules/user/queries'

import type { TaskPermissions } from '../tasks-client'

import { TaskActivityTab } from './task-activity-tab'
import { TaskCommentsTab } from './task-comments-tab'
import { TaskDependenciesTab } from './task-dependencies-tab'
import { TaskDetailsTab } from './task-details-tab'
import { TaskStatusControl } from './task-status-control'

/**
 * "Task detail EntitySheet — the heart of the app" (Phase 5 brief, item 5).
 * Fetches on open (`tasks-client.tsx`'s `openTask`), so this component only
 * renders what it is handed — never its own effect, per `EntitySheet`'s own
 * documented data rule.
 */
export function TaskDetailSheet({
  open,
  onClose,
  pending,
  data,
  userOptions,
  categories,
  permissions,
  onMutated,
}: {
  open: boolean
  onClose: () => void
  pending: boolean
  data: TaskSheetDataDto | null
  userOptions: UserOptionDto[]
  categories: readonly TaxonomyEntry[]
  permissions: TaskPermissions
  onMutated: () => void
}) {
  const task = data?.task ?? null

  const tabs: EntitySheetTab[] | undefined = task
    ? [
        {
          id: 'details',
          label: ar.tasks.detail.tabs.details,
          content: (
            <TaskDetailsTab
              task={task}
              userOptions={userOptions}
              categories={categories}
              permissions={permissions}
              onMutated={onMutated}
            />
          ),
        },
        {
          id: 'dependencies',
          label: ar.tasks.detail.tabs.dependencies,
          ...(data && data.dependencies.some((d) => !d.satisfied)
            ? { count: data.dependencies.filter((d) => !d.satisfied).length }
            : {}),
          content: (
            <TaskDependenciesTab
              task={task}
              dependencies={data?.dependencies ?? []}
              dependents={data?.dependents ?? []}
              permissions={permissions}
              onMutated={onMutated}
            />
          ),
        },
        {
          id: 'comments',
          label: ar.tasks.detail.tabs.comments,
          ...(data && data.comments.length > 0 ? { count: data.comments.length } : {}),
          content: (
            <TaskCommentsTab
              taskId={task.id}
              comments={data?.comments ?? []}
              userOptions={userOptions}
              permissions={permissions}
              onMutated={onMutated}
            />
          ),
        },
        {
          id: 'activity',
          label: ar.tasks.detail.tabs.activity,
          content: (
            <TaskActivityTab activity={data?.activity ?? []} userOptions={userOptions} />
          ),
        },
      ]
    : undefined

  return (
    <EntitySheet
      open={open}
      onClose={onClose}
      title={task?.title ?? ar.common.loading}
      subtitle={task?.projectName}
      size="xl"
      busy={pending}
      {...(task ? { hue: taskStatusHue(task.status) } : {})}
      meta={
        task ? (
          <>
            <TaskStatusControl
              task={task}
              userOptions={userOptions}
              permissions={permissions}
              onMutated={onMutated}
            />
            <PriorityFlag priority={task.priority} />
            {task.isOverdue ? (
              <span data-hue="red" className="text-hue-text text-xs font-medium">
                {ar.tasks.overdue}
              </span>
            ) : null}
          </>
        ) : undefined
      }
      tabs={tabs}
    >
      <div className="flex flex-col gap-3" aria-hidden={!pending}>
        <div className="bg-muted h-5 w-2/3 animate-pulse rounded" />
        <div className="bg-muted h-20 w-full animate-pulse rounded" />
        <div className="bg-muted h-5 w-1/3 animate-pulse rounded" />
        <div className="bg-muted h-5 w-1/2 animate-pulse rounded" />
      </div>
    </EntitySheet>
  )
}
