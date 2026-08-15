'use client'

import * as React from 'react'

import { Dialog } from '@/components/shared/dialog'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import { assignTaskAction } from '@/modules/task/actions'
import type { TaskDetailDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

/**
 * SPEC M4: reassigning a task already under way opens *"pay the previous
 * assignee a partial amount?"*. Distinct from the plain `AssignDialog` used
 * by the board and the status control for a *first* assignment out of
 * BACKLOG — that path has no previous assignee, so the M4 question does not
 * apply there.
 */
export function ReassignDialog({
  open,
  onClose,
  task,
  userOptions,
  onDone,
}: {
  open: boolean
  onClose: () => void
  task: TaskDetailDto
  userOptions: UserOptionDto[]
  onDone: () => void
}) {
  const { toast } = useToast()
  const [assigneeId, setAssigneeId] = React.useState('')
  const [partialAmount, setPartialAmount] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setAssigneeId('')
      setPartialAmount('')
    }
  }, [open])

  const hasPreviousAssignee = task.assignee !== null

  async function submit() {
    setBusy(true)
    try {
      await assignTaskAction({
        taskId: task.id,
        assigneeId,
        ...(partialAmount.trim() ? { partialAmount: partialAmount.trim() } : {}),
      })
      toast({ title: ar.tasks.assignment.reassigned, tone: 'success' })
      onClose()
      onDone()
    } catch {
      toast({ title: ar.errors.unexpected, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={hasPreviousAssignee ? ar.tasks.assignment.title : ar.tasks.actions.assign}
      description={
        hasPreviousAssignee ? ar.tasks.assignment.payPreviousDescription : undefined
      }
      busy={busy}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            {ar.common.cancel}
          </Button>
          <Button type="button" size="sm" disabled={!assigneeId || busy} onClick={submit}>
            {ar.common.confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField name="reassign-assignee" label={ar.tasks.assignee} required>
          {(field) => (
            <Select
              {...field}
              data-autofocus
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">{ar.tasks.assignment.selectAssignee}</option>
              {userOptions
                .filter((user) => user.id !== task.assignee?.id)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
            </Select>
          )}
        </FormField>

        {hasPreviousAssignee ? (
          <FormField
            name="reassign-partial"
            label={ar.tasks.assignment.payPreviousAmount}
            hint={ar.tasks.assignment.payPreviousSkip}
          >
            {(field) => (
              <Input
                {...field}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.00"
                value={partialAmount}
                onChange={(event) => setPartialAmount(event.target.value)}
              />
            )}
          </FormField>
        ) : null}
      </div>
    </Dialog>
  )
}
