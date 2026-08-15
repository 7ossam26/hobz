'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import { EntitySheet, EntitySheetFooter } from '@/components/shared/entity-sheet'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { toCairoDateInput } from '@/lib/datetime'
import { updateProjectAction } from '@/modules/project/actions'
import { updateProjectSchema, type EngagementType } from '@/modules/project/schema'
import type { ProjectDetailDto } from '@/modules/project/types'

import {
  draftToPayload,
  ProjectFieldsForm,
  type ProjectDraft,
} from '../project-fields-form'

function detailToDraft(project: ProjectDetailDto): ProjectDraft {
  return {
    code: project.code,
    name: project.name,
    clientId: project.client?.id ?? '',
    ownerId: project.owner.id,
    engagementType: project.engagementType,
    status: project.status,
    startDate: toCairoDateInput(project.startDate),
    dueDate: toCairoDateInput(project.dueDate),
    gracePeriodHours:
      project.gracePeriodHours === null ? '' : String(project.gracePeriodHours),
    penalizeRevisionLateness:
      project.penalizeRevisionLateness === null
        ? ''
        : project.penalizeRevisionLateness
          ? 'true'
          : 'false',
  }
}

interface Props {
  open: boolean
  onClose: () => void
  project: ProjectDetailDto
  clientOptions: Array<{ id: string; name: string }>
  userOptions: Array<{ id: string; fullName: string; username: string }>
  engagementTypes: readonly EngagementType[]
}

export function ProjectEditSheet({
  open,
  onClose,
  project,
  clientOptions,
  userOptions,
  engagementTypes,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [draft, setDraft] = React.useState<ProjectDraft>(() => detailToDraft(project))
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setDraft(detailToDraft(project))
      setError(null)
    }
    // `project` is intentionally excluded: re-opening the same sheet with a
    // fresher server-refetched `project` object must not silently discard
    // whatever the user is mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function save() {
    setError(null)
    const payload = { id: project.id, ...draftToPayload(draft) }
    const parsed = updateProjectSchema.safeParse(payload)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        await updateProjectAction(payload)
        toast({ title: ar.projects.updated, tone: 'success' })
        onClose()
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <EntitySheet
      open={open}
      onClose={onClose}
      title={ar.projects.edit}
      subtitle={project.name}
      busy={pending}
      dirty
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
          codeRequired
        />
      </div>
    </EntitySheet>
  )
}
