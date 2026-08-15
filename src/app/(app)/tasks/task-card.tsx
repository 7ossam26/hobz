import { CircleAlert } from 'lucide-react'
import * as React from 'react'

import { DateText } from '@/components/data/date-text'
import { ProjectMark } from '@/components/data/entity-marks'
import { PriorityFlag } from '@/components/data/priority-flag'
import { UserChip } from '@/components/data/user-chip'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'
import type { TaskSummaryDto } from '@/modules/task/types'

/**
 * The one card every view that shows a task-as-a-tile renders: the Kanban
 * board and a calendar day cell. No `'use client'` of its own — it takes its
 * interactivity (click, drag) as plain props from whichever client parent
 * renders it, the same division `StatusChip`/`UserChip` already draw.
 */
export const TaskCard = React.forwardRef<
  HTMLDivElement,
  {
    task: TaskSummaryDto
    onClick?: () => void
    dragging?: boolean
    className?: string
  } & Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick' | 'className'>
>(function TaskCard({ task, onClick, dragging = false, className, ...dragProps }, ref) {
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick?.()
      }}
      className={cn(
        'bg-card flex flex-col gap-2 rounded-lg border p-2.5 text-start transition-shadow',
        'hover:border-accent-solid/40 focus-visible:ring-ring/50 hover:shadow-sm focus-visible:ring-[3px] focus-visible:outline-none',
        dragging && 'opacity-40',
        className,
      )}
      {...dragProps}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 flex-1 text-sm font-medium">{task.title}</p>
        <PriorityFlag priority={task.priority} showLabel={false} />
      </div>

      <ProjectMark
        project={{ id: task.projectId, code: task.projectCode, name: task.projectName }}
        showName
        className="text-fg-subtle"
      />

      <div className="flex items-center justify-between gap-2">
        {task.assignee ? (
          <UserChip user={task.assignee} size="sm" showWhatsapp={false} />
        ) : (
          <span className="text-fg-subtle text-xs">{ar.tasks.unassigned}</span>
        )}

        <span
          className={cn(
            'flex items-center gap-1 text-xs whitespace-nowrap',
            task.isOverdue ? 'text-hue-text' : 'text-fg-subtle',
          )}
          {...(task.isOverdue ? { 'data-hue': 'red' } : {})}
        >
          {task.isOverdue ? (
            <CircleAlert className="size-3 shrink-0" aria-hidden />
          ) : null}
          <DateText value={task.dueDate} variant="short" />
        </span>
      </div>
    </div>
  )
})
