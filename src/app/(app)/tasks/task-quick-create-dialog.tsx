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
import type { TaxonomyEntry } from '@/lib/settings'
import type { ProjectOptionDto } from '@/modules/project/queries'
import { createTaskAction } from '@/modules/task/actions'
import type { TaskDetailDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

const PRIORITIES = Object.keys(PRIORITY_HUE) as Priority[]

/** `today + 7 days`, as a `YYYY-MM-DD` — a sensible starting point, always editable. */
function defaultDueDate(): string {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}

/**
 * "Quick" is the point: project, title, category and a due date — the four
 * fields `createTaskSchema` cannot default. Everything else (`description`,
 * `estimatedHours`, `taskValue`, `watcherIds`, `milestoneId`) stays at its
 * server default and is filled in later from the detail sheet, exactly the
 * way `modules/task/service.ts`'s `createTask` already expects.
 */
export function TaskQuickCreateDialog({
  open,
  onClose,
  requireAssignee = false,
  projectOptions,
  userOptions,
  categories,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  requireAssignee?: boolean
  projectOptions: ProjectOptionDto[]
  userOptions: UserOptionDto[]
  categories: readonly TaxonomyEntry[]
  onCreated: (task: TaskDetailDto) => void
}) {
  const { toast } = useToast()
  const [projectId, setProjectId] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [categoryId, setCategoryId] = React.useState(categories[0]?.id ?? '')
  const [assigneeId, setAssigneeId] = React.useState('')
  const [priority, setPriority] = React.useState<Priority>('MEDIUM')
  const [dueDate, setDueDate] = React.useState(defaultDueDate())
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setProjectId('')
    setTitle('')
    setCategoryId(categories[0]?.id ?? '')
    setAssigneeId('')
    setPriority('MEDIUM')
    setDueDate(defaultDueDate())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const canSubmit =
    projectId !== '' &&
    title.trim() !== '' &&
    categoryId !== '' &&
    dueDate !== '' &&
    (!requireAssignee || assigneeId !== '')

  async function submit() {
    setBusy(true)
    try {
      const result = await createTaskAction({
        projectId,
        title: title.trim(),
        categoryId,
        dueDate: new Date(dueDate),
        priority,
        assigneeId: assigneeId || undefined,
        watcherIds: [],
      })
      toast({ title: ar.tasks.created, tone: 'success' })
      onCreated(result.task)
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
      title={ar.tasks.quickCreate.title}
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
          <Button type="button" size="sm" disabled={!canSubmit || busy} onClick={submit}>
            {ar.tasks.quickCreate.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField name="quick-project" label={ar.tasks.project} required>
          {(field) => (
            <Select
              {...field}
              data-autofocus
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{ar.tasks.quickCreate.selectProject}</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} — {project.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField name="quick-title" label={ar.tasks.taskTitle} required>
          {(field) => (
            <Input
              {...field}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField name="quick-category" label={ar.tasks.category} required>
            {(field) => (
              <Select
                {...field}
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">{ar.tasks.quickCreate.selectCategory}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField name="quick-priority" label={ar.tasks.priority}>
            {(field) => (
              <Select
                {...field}
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            name="quick-assignee"
            label={ar.tasks.assignee}
            required={requireAssignee}
          >
            {(field) => (
              <Select
                {...field}
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
              >
                <option value="">{ar.tasks.noAssignee}</option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField name="quick-due-date" label={ar.tasks.dueDate} required>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            )}
          </FormField>
        </div>
      </div>
    </Dialog>
  )
}
