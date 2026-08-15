'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import { EntitySheet, EntitySheetFooter } from '@/components/shared/entity-sheet'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { createProjectAction } from '@/modules/project/actions'
import { createProjectSchema, type EngagementType } from '@/modules/project/schema'

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
  clientOptions: Array<{ id: string; name: string }>
  userOptions: Array<{ id: string; fullName: string; username: string }>
  engagementTypes: readonly EngagementType[]
}

export function ProjectCreateSheet({
  open,
  onClose,
  currentUserId,
  clientOptions,
  userOptions,
  engagementTypes,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [draft, setDraft] = React.useState<ProjectDraft>(() =>
    emptyProjectDraft(currentUserId),
  )
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setDraft(emptyProjectDraft(currentUserId))
      setError(null)
    }
  }, [open, currentUserId])

  function save() {
    setError(null)
    const payload = draftToPayload(draft)
    const parsed = createProjectSchema.safeParse(payload)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        const result = await createProjectAction(payload)
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
      title={ar.projects.create}
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
            <Button onClick={save} disabled={pending}>
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
