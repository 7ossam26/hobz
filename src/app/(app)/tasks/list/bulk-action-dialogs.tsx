'use client'

import * as React from 'react'

import { Dialog } from '@/components/shared/dialog'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import { PRIORITY_HUE, type Priority } from '@/lib/palette'
import {
  bulkAssignTaskAction,
  bulkChangeTaskDueDateAction,
  bulkChangeTaskPriorityAction,
  type BulkTaskResultDto,
} from '@/modules/task/actions'
import type { UserOptionDto } from '@/modules/user/queries'

/**
 * The three list-view bulk actions. Non-optimistic on purpose — a batch
 * touching dozens of rows at once is exactly the case CLAUDE.md's "no layout
 * shift on optimistic update" constraint would fight, so these show a pending
 * state, report a count, and let `onDone` trigger the ordinary server refresh
 * (`ProjectCreateSheet` sets the same precedent for the project module: a
 * pending state and a toast, not a speculative row).
 */

const PRIORITIES = Object.keys(PRIORITY_HUE) as Priority[]

function summarize(
  toast: ReturnType<typeof useToast>['toast'],
  result: BulkTaskResultDto,
) {
  if (result.failed === 0) {
    toast({
      title: ar.tasks.list.bulkApplied.replace('{count}', String(result.succeeded)),
      tone: 'success',
    })
  } else if (result.succeeded === 0) {
    toast({ title: ar.tasks.list.bulkFailed, tone: 'error' })
  } else {
    toast({
      title: ar.tasks.list.bulkPartial.replace('{count}', String(result.succeeded)),
      tone: 'info',
    })
  }
}

export function BulkAssignDialog({
  open,
  onClose,
  taskIds,
  userOptions,
  onDone,
}: {
  open: boolean
  onClose: () => void
  taskIds: string[]
  userOptions: UserOptionDto[]
  onDone: () => void
}) {
  const { toast } = useToast()
  const [assigneeId, setAssigneeId] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setAssigneeId('')
  }, [open])

  async function submit() {
    setBusy(true)
    try {
      const result = await bulkAssignTaskAction({ taskIds, assigneeId })
      summarize(toast, result)
      onClose()
      onDone()
    } catch {
      toast({ title: ar.tasks.list.bulkFailed, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ar.tasks.list.bulkAssign}
      description={ar.table.selectedCount.replace('{count}', String(taskIds.length))}
      busy={busy}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {ar.common.cancel}
          </Button>
          <Button size="sm" disabled={!assigneeId || busy} onClick={submit}>
            {ar.common.confirm}
          </Button>
        </>
      }
    >
      <FormField name="bulk-assignee" label={ar.tasks.assignee} required>
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
    </Dialog>
  )
}

export function BulkPriorityDialog({
  open,
  onClose,
  taskIds,
  onDone,
}: {
  open: boolean
  onClose: () => void
  taskIds: string[]
  onDone: () => void
}) {
  const { toast } = useToast()
  const [priority, setPriority] = React.useState<Priority>('MEDIUM')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setPriority('MEDIUM')
  }, [open])

  async function submit() {
    setBusy(true)
    try {
      const result = await bulkChangeTaskPriorityAction({ taskIds, priority })
      summarize(toast, result)
      onClose()
      onDone()
    } catch {
      toast({ title: ar.tasks.list.bulkFailed, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ar.tasks.list.bulkPriority}
      description={ar.table.selectedCount.replace('{count}', String(taskIds.length))}
      busy={busy}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {ar.common.cancel}
          </Button>
          <Button size="sm" disabled={busy} onClick={submit}>
            {ar.common.confirm}
          </Button>
        </>
      }
    >
      <FormField name="bulk-priority" label={ar.tasks.priority} required>
        {(field) => (
          <Select
            {...field}
            data-autofocus
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {ar.enums.priority[value]}
              </option>
            ))}
          </Select>
        )}
      </FormField>
    </Dialog>
  )
}

export function BulkDueDateDialog({
  open,
  onClose,
  taskIds,
  onDone,
}: {
  open: boolean
  onClose: () => void
  taskIds: string[]
  onDone: () => void
}) {
  const { toast } = useToast()
  const [dueDate, setDueDate] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setDueDate('')
  }, [open])

  async function submit() {
    setBusy(true)
    try {
      const result = await bulkChangeTaskDueDateAction({
        taskIds,
        dueDate: new Date(dueDate),
      })
      summarize(toast, result)
      onClose()
      onDone()
    } catch {
      toast({ title: ar.tasks.list.bulkFailed, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ar.tasks.list.bulkDueDate}
      description={ar.table.selectedCount.replace('{count}', String(taskIds.length))}
      busy={busy}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {ar.common.cancel}
          </Button>
          <Button size="sm" disabled={!dueDate || busy} onClick={submit}>
            {ar.common.confirm}
          </Button>
        </>
      }
    >
      <FormField name="bulk-due-date" label={ar.tasks.dueDate} required>
        {(field) => (
          <Input
            {...field}
            data-autofocus
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        )}
      </FormField>
    </Dialog>
  )
}
