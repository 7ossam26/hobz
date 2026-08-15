'use client'

import * as React from 'react'

import { Dialog } from '@/components/shared/dialog'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import { toCairoDateInput } from '@/lib/datetime'
import { createMilestoneAction, updateMilestoneAction } from '@/modules/milestone/actions'
import {
  createMilestoneSchema,
  updateMilestoneSchema,
  type MilestoneStatusInput,
} from '@/modules/milestone/schema'
import type { MilestoneDto } from '@/modules/milestone/types'

const MILESTONE_STATUSES: MilestoneStatusInput[] = [
  'PENDING',
  'IN_PROGRESS',
  'DONE',
  'DELAYED',
]

export function ProjectMilestoneDialog({
  open,
  onClose,
  projectId,
  milestone,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  /** `null` creates a new milestone; a value edits it. */
  milestone: MilestoneDto | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [name, setName] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [status, setStatus] = React.useState<MilestoneStatusInput>('PENDING')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setName(milestone?.name ?? '')
    setDueDate(milestone?.dueDate ? toCairoDateInput(milestone.dueDate) : '')
    setStatus(milestone?.status ?? 'PENDING')
    setError(null)
  }, [open, milestone])

  function submit() {
    setError(null)
    const dueDateValue = dueDate === '' ? null : dueDate
    const payload = milestone
      ? { id: milestone.id, name, dueDate: dueDateValue, status }
      : { projectId, name, dueDate: dueDateValue, status }
    const parsed = milestone
      ? updateMilestoneSchema.safeParse(payload)
      : createMilestoneSchema.safeParse(payload)

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        if (milestone) await updateMilestoneAction(payload)
        else await createMilestoneAction(payload)
        toast({
          title: milestone
            ? ar.projects.milestones.updated
            : ar.projects.milestones.created,
          tone: 'success',
        })
        onClose()
        onSaved()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={milestone ? ar.projects.milestones.edit : ar.projects.milestones.add}
      busy={pending}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            {ar.common.cancel}
          </Button>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? ar.common.saving : ar.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        <FormField name="name" label={ar.projects.milestones.name} required>
          {(field) => (
            <Input {...field} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </FormField>

        <FormField name="dueDate" label={ar.projects.milestones.dueDate}>
          {(field) => (
            <Input
              {...field}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          )}
        </FormField>

        <FormField name="status" label={ar.projects.milestones.status} required>
          {(field) => (
            <Select
              {...field}
              value={status}
              onChange={(e) => setStatus(e.target.value as MilestoneStatusInput)}
            >
              {MILESTONE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ar.enums.milestoneStatus[s]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
    </Dialog>
  )
}
