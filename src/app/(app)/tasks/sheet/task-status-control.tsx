'use client'

import { ChevronDown } from 'lucide-react'
import * as React from 'react'

import { StatusChip } from '@/components/data/status-chip'
import { Popover, PopoverItem, PopoverLabel } from '@/components/shared/popover'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { unblockTaskAction } from '@/modules/task/actions'
import { nextStatuses, type TaskStatus } from '@/modules/task/state-machine'
import type { TaskDetailDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

import {
  TRANSITION_DIALOG_TARGETS,
  TRANSITION_DIRECT_ACTIONS,
  TRANSITION_PERMISSION,
  type TransitionDialogKind,
} from '../task-transitions'
import type { TaskPermissions } from '../tasks-client'
import {
  ApproveDialog,
  AssignDialog,
  ReasonTransitionDialog,
  RevisionDialog,
} from '../transition-dialogs'

const ACTION_LABEL: Record<TaskStatus, string> = {
  BACKLOG: ar.tasks.actions.unblock,
  ASSIGNED: ar.tasks.actions.assign,
  IN_PROGRESS: ar.tasks.actions.start,
  SUBMITTED: ar.tasks.actions.submit,
  IN_REVIEW: ar.tasks.actions.sendToReview,
  REVISION_REQUESTED: ar.tasks.actions.requestRevision,
  APPROVED: ar.tasks.actions.approve,
  DONE: ar.tasks.actions.complete,
  BLOCKED: ar.tasks.actions.block,
  CANCELLED: ar.tasks.actions.cancel,
}

/**
 * "In one sheet: … status transition control" (Phase 5 brief, item 5). Every
 * legal next status (`nextStatuses`, `modules/task/state-machine.ts` — pure,
 * so it is safe to import into a client bundle unlike `service.ts`) becomes a
 * menu entry, filtered by permission first so the menu never offers a click
 * the server would refuse. `BLOCKED → previous` is the one edge the client
 * cannot predict (the target depends on activity history this component does
 * not have), so a blocked task gets a single "استئناف" button that calls
 * `unblockTaskAction` and lets the server work out where it resumes.
 */
export function TaskStatusControl({
  task,
  userOptions,
  permissions,
  onMutated,
}: {
  task: TaskDetailDto
  userOptions: UserOptionDto[]
  permissions: TaskPermissions
  onMutated: () => void
}) {
  const { toast } = useToast()
  const [dialog, setDialog] = React.useState<{ kind: TransitionDialogKind } | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function runDirect(run: (id: string) => Promise<unknown>) {
    setBusy(true)
    try {
      await run(task.id)
      onMutated()
    } catch {
      toast({ title: ar.errors.unexpected, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (task.status === 'BLOCKED') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || !permissions.canWork}
        onClick={() => runDirect((id) => unblockTaskAction({ id }))}
      >
        {ar.tasks.actions.unblock}
      </Button>
    )
  }

  const targets = nextStatuses(task.status).filter(
    (to) => permissions[TRANSITION_PERMISSION[to]],
  )

  if (targets.length === 0) return <StatusChip status={task.status} />

  return (
    <>
      <Popover
        label={ar.tasks.status}
        trigger={({ toggle, ...triggerProps }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggle}
            disabled={busy}
            {...triggerProps}
          >
            <StatusChip status={task.status} size="sm" />
            <ChevronDown className="size-3.5" aria-hidden />
          </Button>
        )}
      >
        {({ close }) => (
          <>
            <PopoverLabel>{ar.common.actions}</PopoverLabel>
            {targets.map((to) => (
              <PopoverItem
                key={to}
                onClick={() => {
                  close()
                  const dialogKind = TRANSITION_DIALOG_TARGETS[to]
                  if (dialogKind) {
                    setDialog({ kind: dialogKind })
                    return
                  }
                  const run = TRANSITION_DIRECT_ACTIONS[to]
                  if (run) void runDirect(run)
                }}
              >
                {ACTION_LABEL[to]}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>

      {dialog?.kind === 'assign' ? (
        <AssignDialog
          open
          onClose={() => setDialog(null)}
          taskId={task.id}
          userOptions={userOptions}
          onDone={onMutated}
        />
      ) : null}
      {dialog?.kind === 'approve' ? (
        <ApproveDialog
          open
          onClose={() => setDialog(null)}
          taskId={task.id}
          onDone={onMutated}
        />
      ) : null}
      {dialog?.kind === 'revision' ? (
        <RevisionDialog
          open
          onClose={() => setDialog(null)}
          taskId={task.id}
          onDone={onMutated}
        />
      ) : null}
      {dialog?.kind === 'block' || dialog?.kind === 'cancel' ? (
        <ReasonTransitionDialog
          open
          onClose={() => setDialog(null)}
          taskId={task.id}
          kind={dialog.kind}
          onDone={onMutated}
        />
      ) : null}
    </>
  )
}
