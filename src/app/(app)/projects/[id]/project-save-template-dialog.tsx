'use client'

import * as React from 'react'

import { Dialog } from '@/components/shared/dialog'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ar } from '@/i18n/ar'
import { saveProjectAsTemplateAction } from '@/modules/project-template/actions'
import { saveProjectAsTemplateSchema } from '@/modules/project-template/schema'

export function ProjectSaveTemplateDialog({
  open,
  onClose,
  projectId,
  defaultName,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  defaultName: string
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [name, setName] = React.useState(defaultName)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setName(defaultName)
      setError(null)
    }
  }, [open, defaultName])

  function submit() {
    setError(null)
    const payload = { projectId, name }
    const parsed = saveProjectAsTemplateSchema.safeParse(payload)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        await saveProjectAsTemplateAction(payload)
        toast({ title: ar.projects.templates.saved, tone: 'success' })
        onClose()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ar.projects.templates.saveAsTemplateTitle}
      description={ar.projects.templates.saveAsTemplateDescription}
      busy={pending}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            {ar.common.cancel}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={pending || name.trim().length === 0}
          >
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
        <FormField name="name" label={ar.projects.templates.templateName} required>
          {(field) => (
            <Input {...field} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </FormField>
      </div>
    </Dialog>
  )
}
