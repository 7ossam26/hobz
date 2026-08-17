'use client'

import * as React from 'react'

import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Dialog } from '@/components/shared/dialog'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import {
  approveTaskAction,
  assignTaskAction,
  blockTaskAction,
  cancelTaskAction,
  requestRevisionAction,
} from '@/modules/task/actions'
import type { TaskAssignmentResultDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

import { AssigneeCapacityHint } from './assignee-capacity-hint'
import { leaveWarningMessage } from './leave-warnings'

/**
 * The five transitions that need more than a status to land — shared by the
 * Kanban board (a drop onto one of these columns opens the matching dialog
 * instead of moving the card) and the detail sheet's status control, so the
 * decision looks and behaves identically wherever it is made.
 */

/**
 * `onResult` exists for exactly one caller: an assignment can come back with a
 * non-blocking leave warning (Phase 6), and `run`'s boolean is about whether
 * the call *succeeded*, not about what it returned. Keeping the two separate
 * means the other four dialogs are unchanged.
 */
function useBusyAction<Args extends unknown[], R>(
  action: (...args: Args) => Promise<R>,
  onResult?: (result: R) => void,
): { busy: boolean; run: (...args: Args) => Promise<boolean> } {
  const { toast } = useToast()
  const [busy, setBusy] = React.useState(false)

  const run = React.useCallback(
    async (...args: Args) => {
      setBusy(true)
      try {
        onResult?.(await action(...args))
        return true
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
        return false
      } finally {
        setBusy(false)
      }
    },
    [action, onResult, toast],
  )

  return { busy, run }
}

export function AssignDialog({
  open,
  onClose,
  taskId,
  userOptions,
  onDone,
}: {
  open: boolean
  onClose: () => void
  taskId: string
  userOptions: UserOptionDto[]
  onDone: () => void
}) {
  const [assigneeId, setAssigneeId] = React.useState('')
  const { toast } = useToast()

  // A warning, never a block: the assignment has already landed by the time
  // this runs (SPEC §4 Calendar, Phase 6).
  const warnAboutLeave = React.useCallback(
    (result: TaskAssignmentResultDto) => {
      for (const warning of result.leaveWarnings) {
        toast({ title: leaveWarningMessage(warning), tone: 'info' })
      }
    },
    [toast],
  )
  const { busy, run } = useBusyAction(assignTaskAction, warnAboutLeave)

  React.useEffect(() => {
    if (open) setAssigneeId('')
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ar.tasks.assignment.title}
      busy={busy}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {ar.common.cancel}
          </Button>
          <Button
            size="sm"
            disabled={!assigneeId || busy}
            onClick={async () => {
              if (await run({ taskId, assigneeId })) {
                onClose()
                onDone()
              }
            }}
          >
            {ar.common.confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField name="assignee" label={ar.tasks.assignee} required>
          {(field) => (
            <Select
              {...field}
              data-autofocus
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">{ar.tasks.assignment.selectAssignee}</option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <AssigneeCapacityHint userOptions={userOptions} assigneeId={assigneeId} />
      </div>
    </Dialog>
  )
}

export function ApproveDialog({
  open,
  onClose,
  taskId,
  onDone,
}: {
  open: boolean
  onClose: () => void
  taskId: string
  onDone: () => void
}) {
  const [rating, setRating] = React.useState(5)
  const { busy, run } = useBusyAction(approveTaskAction)

  React.useEffect(() => {
    if (open) setRating(5)
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ar.tasks.approval.title}
      busy={busy}
      hue="emerald"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {ar.common.cancel}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (await run({ taskId, qualityRating: rating })) {
                onClose()
                onDone()
              }
            }}
          >
            {ar.tasks.actions.approve}
          </Button>
        </>
      }
    >
      <FormField
        name="rating"
        label={ar.tasks.approval.ratingLabel}
        hint={ar.tasks.approval.ratingHint}
        required
      >
        {() => (
          <div
            role="group"
            aria-label={ar.tasks.approval.ratingLabel}
            className="flex items-center gap-1"
          >
            {[1, 2, 3, 4, 5].map((value, index) => (
              <button
                key={value}
                type="button"
                {...(index === 0 ? { 'data-autofocus': true } : {})}
                onClick={() => setRating(value)}
                aria-pressed={rating === value}
                data-hue="amber"
                className={
                  value <= rating
                    ? 'bg-hue-solid text-accent-on-solid flex size-9 items-center justify-center rounded-md text-sm font-semibold'
                    : 'bg-muted text-fg-muted flex size-9 items-center justify-center rounded-md text-sm font-semibold'
                }
              >
                {value}
              </button>
            ))}
          </div>
        )}
      </FormField>
    </Dialog>
  )
}

export function RevisionDialog({
  open,
  onClose,
  taskId,
  onDone,
}: {
  open: boolean
  onClose: () => void
  taskId: string
  onDone: () => void
}) {
  const [reason, setReason] = React.useState('')
  const [newDueDate, setNewDueDate] = React.useState('')
  const { busy, run } = useBusyAction(requestRevisionAction)

  React.useEffect(() => {
    if (open) {
      setReason('')
      setNewDueDate('')
    }
  }, [open])

  const canSubmit = reason.trim().length > 0 && newDueDate.length > 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ar.tasks.approval.revisionTitle}
      busy={busy}
      hue="amber"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {ar.common.cancel}
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit || busy}
            onClick={async () => {
              if (
                await run({
                  taskId,
                  reason: reason.trim(),
                  newDueDate: new Date(newDueDate),
                })
              ) {
                onClose()
                onDone()
              }
            }}
          >
            {ar.tasks.actions.requestRevision}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField name="reason" label={ar.tasks.approval.revisionReason} required>
          {(field) => (
            <Textarea
              {...field}
              data-autofocus
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </FormField>
        <FormField
          name="newDueDate"
          label={ar.tasks.approval.revisionNewDueDate}
          required
        >
          {(field) => (
            <Input
              {...field}
              type="date"
              value={newDueDate}
              onChange={(event) => setNewDueDate(event.target.value)}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  )
}

/** BLOCKED and CANCELLED both need a mandatory reason and nothing else. */
export function ReasonTransitionDialog({
  open,
  onClose,
  taskId,
  kind,
  onDone,
}: {
  open: boolean
  onClose: () => void
  taskId: string
  kind: 'block' | 'cancel'
  onDone: () => void
}) {
  const action = kind === 'block' ? blockTaskAction : cancelTaskAction
  const { busy, run } = useBusyAction(action)

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      busy={busy}
      destructive={kind === 'cancel'}
      title={kind === 'block' ? ar.tasks.actions.block : ar.tasks.actions.cancel}
      reasonRequired
      confirmLabel={kind === 'block' ? ar.tasks.actions.block : ar.tasks.actions.cancel}
      onConfirm={async (reason) => {
        if (await run({ taskId, reason })) {
          onClose()
          onDone()
        }
      }}
    />
  )
}
