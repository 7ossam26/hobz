'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import { HealthBadge } from '@/components/data/health-badge'
import { Dialog } from '@/components/shared/dialog'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import { setProjectHealthOverrideAction } from '@/modules/project/actions'
import {
  setProjectHealthOverrideSchema,
  type ComputedHealthInput,
} from '@/modules/project/schema'
import type { ProjectDetailDto } from '@/modules/project/types'

/**
 * SPEC §5.7: a manual RAG override that REQUIRES a reason and is
 * audit-logged. The reason is required in both directions here — setting an
 * override and clearing one back to automatic — see the comment on
 * `setProjectHealthOverrideSchema`.
 */
export function ProjectHealthDialog({
  open,
  onClose,
  project,
}: {
  open: boolean
  onClose: () => void
  project: ProjectDetailDto
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [value, setValue] = React.useState<'' | ComputedHealthInput>('')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setValue(project.health.overridden ? project.health.health : '')
      setReason('')
      setError(null)
    }
  }, [open, project.health.health, project.health.overridden])

  function submit() {
    setError(null)
    const payload = {
      id: project.id,
      health: value === '' ? null : value,
      reason,
    }
    const parsed = setProjectHealthOverrideSchema.safeParse(payload)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        await setProjectHealthOverrideAction(payload)
        toast({
          title:
            value === ''
              ? ar.projects.health.overrideCleared
              : ar.projects.health.overrideSet,
          tone: 'success',
        })
        onClose()
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        value === ''
          ? ar.projects.health.clearOverrideTitle
          : ar.projects.health.setOverrideTitle
      }
      busy={pending}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            {ar.common.cancel}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={pending || reason.trim().length === 0}
          >
            {pending ? ar.common.saving : ar.common.confirm}
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

        <div className="flex items-center gap-2 text-sm">
          <span className="text-fg-muted">{ar.projects.health.computed}:</span>
          <HealthBadge health={project.health.computed} size="sm" />
        </div>

        <FormField name="health" label={ar.projects.health.selectHealth} required>
          {(field) => (
            <Select
              {...field}
              value={value}
              onChange={(e) => setValue(e.target.value as '' | ComputedHealthInput)}
            >
              <option value="">{ar.projects.health.clearOverride}</option>
              <option value="GREEN">{ar.health.GREEN}</option>
              <option value="AMBER">{ar.health.AMBER}</option>
              <option value="RED">{ar.health.RED}</option>
            </Select>
          )}
        </FormField>

        <FormField name="reason" label={ar.common.reason} required>
          {(field) => (
            <Textarea
              {...field}
              value={reason}
              rows={3}
              placeholder={ar.projects.health.overrideReasonRequired}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  )
}
