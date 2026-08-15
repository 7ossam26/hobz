'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import { EntitySheet, EntitySheetFooter } from '@/components/shared/entity-sheet'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import type { EngagementType } from '@/modules/project/schema'
import { createProjectFromTemplateAction } from '@/modules/project-template/actions'
import { createProjectFromTemplateSchema } from '@/modules/project-template/schema'
import type { ProjectTemplateSummaryDto } from '@/modules/project-template/types'

import {
  draftToPayload,
  emptyProjectDraft,
  ProjectFieldsForm,
  type ProjectDraft,
} from './project-fields-form'

interface Props {
  open: boolean
  onClose: () => void
  currentUserId: string
  templates: ProjectTemplateSummaryDto[]
  clientOptions: Array<{ id: string; name: string }>
  userOptions: Array<{ id: string; fullName: string; username: string }>
  engagementTypes: readonly EngagementType[]
}

export function ProjectFromTemplateSheet({
  open,
  onClose,
  currentUserId,
  templates,
  clientOptions,
  userOptions,
  engagementTypes,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [templateId, setTemplateId] = React.useState('')
  const [draft, setDraft] = React.useState<ProjectDraft>(() =>
    emptyProjectDraft(currentUserId),
  )
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setTemplateId(templates[0]?.id ?? '')
      setDraft(emptyProjectDraft(currentUserId))
      setError(null)
    }
  }, [open, currentUserId, templates])

  function save() {
    setError(null)
    if (!templateId) {
      setError(ar.projects.templates.noTemplates)
      return
    }

    const payload = { ...draftToPayload(draft), templateId }
    const parsed = createProjectFromTemplateSchema.safeParse(payload)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        const result = await createProjectFromTemplateAction(payload)
        toast({ title: ar.projects.created, tone: 'success' })
        onClose()
        router.push(`/projects/${result.id}`)
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <EntitySheet
      open={open}
      onClose={onClose}
      title={ar.projects.templates.createFromTemplateTitle}
      busy={pending}
      dirty={draft.name !== ''}
      footer={
        <EntitySheetFooter
          secondary={
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              {ar.common.cancel}
            </Button>
          }
          primary={
            <Button onClick={save} disabled={pending || templates.length === 0}>
              {pending ? ar.common.saving : ar.common.save}
            </Button>
          }
        />
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

        {templates.length === 0 ? (
          <p className="text-fg-muted text-sm">{ar.projects.templates.noTemplates}</p>
        ) : (
          <FormField
            name="templateId"
            label={ar.projects.templates.selectTemplate}
            required
          >
            {(field) => (
              <Select
                {...field}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.milestoneCount}{' '}
                    {ar.projects.milestones.title})
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        )}

        <ProjectFieldsForm
          draft={draft}
          onChange={setDraft}
          clientOptions={clientOptions}
          userOptions={userOptions}
          engagementTypes={engagementTypes}
        />
      </div>
    </EntitySheet>
  )
}
