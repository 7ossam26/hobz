'use client'

import * as React from 'react'

import { useToast } from '@/components/shared/toast'
import { ar } from '@/i18n/ar'
import type { TaskBoardDto } from '@/modules/task/queries'
import {
  canTransition,
  isFinal,
  TASK_STATUSES,
  type TaskStatus,
} from '@/modules/task/state-machine'
import type { TaskSummaryDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

import { classifyDrop, type TransitionDialogKind } from '../task-transitions'
import type { TaskPermissions } from '../tasks-client'
import {
  AssignDialog,
  ApproveDialog,
  ReasonTransitionDialog,
  RevisionDialog,
} from '../transition-dialogs'

import { BoardColumn } from './board-column'

/** Only BACKLOG and ASSIGNED are legal creation targets (`createTask`, SPEC §5.1). */
const CREATABLE_COLUMNS: ReadonlySet<TaskStatus> = new Set(['BACKLOG', 'ASSIGNED'])

function groupByStatus(board: TaskBoardDto): Record<TaskStatus, TaskSummaryDto[]> {
  const map = {} as Record<TaskStatus, TaskSummaryDto[]>
  for (const status of TASK_STATUSES) map[status] = []
  for (const column of board.columns) map[column.status] = column.tasks
  return map
}

export function BoardView({
  board,
  userOptions,
  permissions,
  onOpenTask,
  onQuickCreate,
  onMutated,
}: {
  board: TaskBoardDto
  userOptions: UserOptionDto[]
  permissions: TaskPermissions
  onOpenTask: (id: string) => void
  onQuickCreate: (preset: { requireAssignee: boolean }) => void
  onMutated: () => void
}) {
  const { toast } = useToast()
  const [columns, setColumns] = React.useState(() => groupByStatus(board))
  React.useEffect(() => setColumns(groupByStatus(board)), [board])

  const [dragging, setDragging] = React.useState<{ id: string; from: TaskStatus } | null>(
    null,
  )
  const [dialog, setDialog] = React.useState<{
    kind: TransitionDialogKind
    taskId: string
    from: TaskStatus
  } | null>(null)

  function moveLocally(id: string, from: TaskStatus, to: TaskStatus) {
    setColumns((prev) => {
      const task = prev[from]?.find((t) => t.id === id)
      if (!task) return prev
      return {
        ...prev,
        [from]: prev[from]?.filter((t) => t.id !== id) ?? [],
        [to]: [{ ...task, status: to }, ...(prev[to] ?? [])],
      }
    })
  }

  /**
   * A card dragged out of BLOCKED or a final status can never predict a legal
   * target client-side: BLOCKED's one legal destination depends on activity
   * history a card summary does not carry, and a final status has none. Both
   * are non-draggable (`BoardColumn` sets `draggable={false}` for them), so
   * this only guards against a stale `dragging` ref, never a real drop.
   */
  function isDraggableSource(status: TaskStatus): boolean {
    return !isFinal(status) && status !== 'BLOCKED'
  }

  async function handleDrop(to: TaskStatus) {
    const drag = dragging
    setDragging(null)
    if (!drag) return

    const outcome = classifyDrop(drag.from, to, permissions)

    switch (outcome.kind) {
      case 'noop':
        return
      case 'illegal':
        toast({ title: ar.tasks.board.illegalDrop, tone: 'error' })
        return
      case 'forbidden':
        toast({ title: ar.errors.forbidden, tone: 'error' })
        return
      case 'dialog':
        setDialog({ kind: outcome.dialogKind, taskId: drag.id, from: drag.from })
        return
      case 'direct':
        moveLocally(drag.id, drag.from, to)
        try {
          await outcome.run(drag.id)
          onMutated()
        } catch {
          moveLocally(drag.id, to, drag.from)
          toast({ title: ar.errors.unexpected, tone: 'error' })
        }
        return
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-full min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {TASK_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={columns[status] ?? []}
            draggable={isDraggableSource(status)}
            draggingId={dragging?.id ?? null}
            onDragStart={(id) => setDragging({ id, from: status })}
            onDragEnd={() => setDragging(null)}
            onDropColumn={() => void handleDrop(status)}
            canDropHere={
              dragging !== null &&
              dragging.from !== status &&
              isDraggableSource(dragging.from) &&
              canTransition(dragging.from, status)
            }
            onOpenTask={onOpenTask}
            onQuickCreate={
              CREATABLE_COLUMNS.has(status) && permissions.canCreate
                ? () => onQuickCreate({ requireAssignee: status === 'ASSIGNED' })
                : undefined
            }
          />
        ))}
      </div>

      {dialog?.kind === 'assign' ? (
        <AssignDialog
          open
          onClose={() => setDialog(null)}
          taskId={dialog.taskId}
          userOptions={userOptions}
          onDone={onMutated}
        />
      ) : null}
      {dialog?.kind === 'approve' ? (
        <ApproveDialog
          open
          onClose={() => setDialog(null)}
          taskId={dialog.taskId}
          onDone={onMutated}
        />
      ) : null}
      {dialog?.kind === 'revision' ? (
        <RevisionDialog
          open
          onClose={() => setDialog(null)}
          taskId={dialog.taskId}
          onDone={onMutated}
        />
      ) : null}
      {dialog?.kind === 'block' || dialog?.kind === 'cancel' ? (
        <ReasonTransitionDialog
          open
          onClose={() => setDialog(null)}
          taskId={dialog.taskId}
          kind={dialog.kind}
          onDone={onMutated}
        />
      ) : null}
    </div>
  )
}
