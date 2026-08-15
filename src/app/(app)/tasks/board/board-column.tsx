'use client'

import { Plus } from 'lucide-react'
import * as React from 'react'

import { StatusChip } from '@/components/data/status-chip'
import { useVirtualRows } from '@/components/shared/data-table/use-virtual-rows'
import { ar } from '@/i18n/ar'
import { taskStatusHue } from '@/lib/palette'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '@/modules/task/state-machine'
import type { TaskSummaryDto } from '@/modules/task/types'

import { TaskCard } from '../task-card'

/**
 * One column. RTL needs no direction-specific code here — the columns are
 * laid out by `BoardView` as a plain `flex` row inside a `dir="rtl"` page, so
 * the browser places the first column (`BACKLOG`, the pipeline's start) at
 * the inline start, the right edge, and progresses left exactly the way the
 * rest of the product's reading order does (`app-sidebar.tsx`'s doc comment
 * makes the identical point about its own flex row).
 *
 * Native HTML5 drag and drop, not a library — Phase 0/2's precedent for the
 * whole component library (hand-written focus trap, hand-written table
 * virtualization) applied to the one remaining heavy interaction. It has no
 * keyboard story of its own, which is why every drag transition here also has
 * a keyboard-reachable equivalent: the detail sheet's status control
 * (`sheet/task-status-control.tsx`) drives the exact same named actions.
 */
export function BoardColumn({
  status,
  tasks,
  draggable,
  draggingId,
  onDragStart,
  onDragEnd,
  onDropColumn,
  canDropHere,
  onOpenTask,
  onQuickCreate,
}: {
  status: TaskStatus
  tasks: TaskSummaryDto[]
  draggable: boolean
  draggingId: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropColumn: () => void
  canDropHere: boolean
  onOpenTask: (id: string) => void
  onQuickCreate?: () => void
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const cardRef = React.useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = React.useState(false)

  const virtual = useVirtualRows({ count: tasks.length, scrollRef, rowRef: cardRef })
  const windowed = virtual.enabled
    ? tasks.slice(virtual.startIndex, virtual.endIndex)
    : tasks

  return (
    <div
      data-hue={taskStatusHue(status)}
      data-status={status}
      aria-label={ar.enums.taskStatus[status]}
      className="bg-surface-sunken flex h-full w-72 shrink-0 flex-col rounded-lg border"
      onDragOver={(event) => {
        if (!canDropHere) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        onDropColumn()
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b p-2.5">
        <StatusChip status={status} size="sm" />
        <span className="text-fg-subtle text-xs tabular-nums">{tasks.length}</span>
      </div>

      <div
        ref={scrollRef}
        className={cn(
          'flex-1 overflow-y-auto p-2 transition-colors',
          dragOver &&
            canDropHere &&
            'bg-hue-surface/50 outline-hue-solid outline-2 -outline-offset-2 outline-dashed',
        )}
      >
        {virtual.paddingTop > 0 ? (
          <div aria-hidden style={{ height: virtual.paddingTop }} />
        ) : null}

        <div className="flex flex-col gap-2">
          {windowed.map((task, index) => (
            <TaskCard
              key={task.id}
              ref={index === 0 ? cardRef : undefined}
              task={task}
              dragging={draggingId === task.id}
              onClick={() => onOpenTask(task.id)}
              draggable={draggable}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', task.id)
                onDragStart(task.id)
              }}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>

        {virtual.paddingBottom > 0 ? (
          <div aria-hidden style={{ height: virtual.paddingBottom }} />
        ) : null}

        {tasks.length === 0 ? (
          <p className="text-fg-subtle px-1 py-4 text-center text-xs">
            {ar.tasks.board.emptyColumn}
          </p>
        ) : null}
      </div>

      {onQuickCreate ? (
        <button
          type="button"
          onClick={onQuickCreate}
          className="text-fg-muted hover:text-foreground hover:bg-accent flex shrink-0 items-center gap-1.5 rounded-b-lg border-t p-2.5 text-xs font-medium transition-colors"
        >
          <Plus className="size-3.5 shrink-0" aria-hidden />
          {ar.tasks.board.addTask}
        </button>
      ) : null}
    </div>
  )
}
