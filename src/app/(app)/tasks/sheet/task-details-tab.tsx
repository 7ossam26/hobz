'use client'

import { X } from 'lucide-react'
import * as React from 'react'

import { DurationText } from '@/components/data/date-text'
import { UserChip } from '@/components/data/user-chip'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import { PRIORITY_HUE, type Priority } from '@/lib/palette'
import type { TaxonomyEntry } from '@/lib/settings'
import {
  addTaskWatcherAction,
  removeTaskWatcherAction,
  updateTaskAction,
} from '@/modules/task/actions'
import type { TaskDetailDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

import type { TaskPermissions } from '../tasks-client'

import { ReassignDialog } from './reassign-dialog'

const PRIORITIES = Object.keys(PRIORITY_HUE) as Priority[]

/**
 * Every field in `updateTaskSchema`'s core shape must be resent together
 * (status and assignee have their own guarded paths — see `modules/task/
 * service.ts`'s `updateTask` doc comment), so this hook always saves the
 * *whole* draft, not a single-field patch. That is also what keeps a
 * `delayReason`/`delayAttribution` a task already carries from being wiped
 * out by an unrelated edit: the draft always forwards its current value.
 */
function useInlineUpdate(task: TaskDetailDto, onMutated: () => void) {
  const { toast } = useToast()
  const [draft, setDraft] = React.useState(task)
  React.useEffect(() => setDraft(task), [task])
  const [savingField, setSavingField] = React.useState<string | null>(null)

  async function save(field: string, patch: Partial<TaskDetailDto>) {
    const previous = draft
    const next = { ...draft, ...patch }
    setDraft(next)
    setSavingField(field)
    try {
      await updateTaskAction({
        id: next.id,
        title: next.title,
        description: next.description ?? undefined,
        milestoneId: next.milestoneId ?? undefined,
        priority: next.priority,
        categoryId: next.categoryId,
        estimatedHours: Number(next.estimatedHours),
        dueDate: next.dueDate,
        taskValue: next.taskValue,
        delayReason: next.delayReason ?? undefined,
        delayAttribution: next.delayAttribution,
      })
      onMutated()
    } catch {
      setDraft(previous)
      toast({ title: ar.errors.unexpected, tone: 'error' })
    } finally {
      setSavingField(null)
    }
  }

  return { draft, save, savingField }
}

export function TaskDetailsTab({
  task,
  userOptions,
  categories,
  permissions,
  onMutated,
}: {
  task: TaskDetailDto
  userOptions: UserOptionDto[]
  categories: readonly TaxonomyEntry[]
  permissions: TaskPermissions
  onMutated: () => void
}) {
  const { toast } = useToast()
  const { draft, save, savingField } = useInlineUpdate(task, onMutated)
  const [titleText, setTitleText] = React.useState(draft.title)
  const [valueText, setValueText] = React.useState(draft.taskValue)
  const [reassigning, setReassigning] = React.useState(false)
  const [addingWatcher, setAddingWatcher] = React.useState(false)
  const [pickedWatcher, setPickedWatcher] = React.useState('')

  React.useEffect(() => setTitleText(draft.title), [draft.title])
  React.useEffect(() => setValueText(draft.taskValue), [draft.taskValue])

  const canEdit = permissions.canEdit
  const disabled = !canEdit || savingField !== null

  const availableForWatching = userOptions.filter(
    (user) =>
      user.id !== draft.assignee?.id && !draft.watchers.some((w) => w.id === user.id),
  )

  async function addWatcher() {
    if (!pickedWatcher) return
    try {
      await addTaskWatcherAction({ taskId: draft.id, userId: pickedWatcher })
      onMutated()
      setAddingWatcher(false)
      setPickedWatcher('')
    } catch {
      toast({ title: ar.errors.unexpected, tone: 'error' })
    }
  }

  async function removeWatcher(userId: string) {
    try {
      await removeTaskWatcherAction({ taskId: draft.id, userId })
      onMutated()
    } catch {
      toast({ title: ar.errors.unexpected, tone: 'error' })
    }
  }

  const notStarted = draft.assignedAt === null

  return (
    <div className="flex flex-col gap-5">
      <FormField name="detail-title" label={ar.tasks.taskTitle} required>
        {(field) => (
          <Input
            {...field}
            value={titleText}
            disabled={disabled}
            onChange={(event) => setTitleText(event.target.value)}
            onBlur={() => {
              if (titleText.trim() && titleText !== draft.title) {
                void save('title', { title: titleText.trim() })
              } else {
                setTitleText(draft.title)
              }
            }}
          />
        )}
      </FormField>

      <FormField name="detail-description" label={ar.tasks.description}>
        {(field) => (
          <Textarea
            {...field}
            rows={4}
            disabled={disabled}
            defaultValue={draft.description ?? ''}
            key={draft.description}
            onBlur={(event) => {
              const value = event.target.value.trim() || null
              if (value !== draft.description)
                void save('description', { description: value })
            }}
          />
        )}
      </FormField>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{ar.tasks.assignee}</p>
        <div className="flex items-center gap-2">
          {draft.assignee ? (
            <UserChip user={draft.assignee} size="sm" showWhatsapp={false} />
          ) : (
            <span className="text-fg-subtle text-sm">{ar.tasks.noAssignee}</span>
          )}
          {permissions.canAssign ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReassigning(true)}
            >
              {draft.assignee ? ar.tasks.actions.reassign : ar.tasks.actions.assign}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{ar.tasks.watchers}</p>
        <div className="flex flex-wrap items-center gap-2">
          {draft.watchers.map((watcher) => (
            <span
              key={watcher.id}
              className="bg-muted flex items-center gap-1 rounded-full py-0.5 ps-2 pe-1"
            >
              <UserChip user={watcher} size="sm" showWhatsapp={false} />
              {permissions.canAssign ? (
                <button
                  type="button"
                  aria-label={ar.tasks.actions.removeWatcher}
                  title={ar.tasks.actions.removeWatcher}
                  onClick={() => void removeWatcher(watcher.id)}
                  className="text-fg-subtle hover:text-destructive rounded-full p-0.5"
                >
                  <X className="size-3" aria-hidden />
                </button>
              ) : null}
            </span>
          ))}

          {permissions.canAssign ? (
            addingWatcher ? (
              <span className="flex items-center gap-1">
                <Select
                  aria-label={ar.tasks.watcherPicker.placeholder}
                  value={pickedWatcher}
                  onChange={(event) => setPickedWatcher(event.target.value)}
                  className="h-8 w-40"
                >
                  <option value="">{ar.tasks.watcherPicker.placeholder}</option>
                  {availableForWatching.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  size="sm"
                  disabled={!pickedWatcher}
                  onClick={addWatcher}
                >
                  {ar.common.add}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingWatcher(false)}
                >
                  {ar.common.cancel}
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddingWatcher(true)}
              >
                {ar.tasks.actions.addWatcher}
              </Button>
            )
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField name="detail-priority" label={ar.tasks.priority}>
          {(field) => (
            <Select
              {...field}
              disabled={disabled}
              value={draft.priority}
              onChange={(event) =>
                void save('priority', { priority: event.target.value as Priority })
              }
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {ar.enums.priority[value]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField name="detail-category" label={ar.tasks.category}>
          {(field) => (
            <Select
              {...field}
              disabled={disabled}
              value={draft.categoryId}
              onChange={(event) =>
                void save('categoryId', { categoryId: event.target.value })
              }
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField name="detail-due-date" label={ar.tasks.dueDate}>
          {(field) => (
            <Input
              {...field}
              type="date"
              disabled={disabled}
              value={draft.dueDate.toISOString().slice(0, 10)}
              onChange={(event) => {
                if (!event.target.value) return
                void save('dueDate', { dueDate: new Date(event.target.value) })
              }}
            />
          )}
        </FormField>

        <FormField name="detail-estimated-hours" label={ar.tasks.estimatedHours}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min={0}
              step={0.25}
              dir="ltr"
              disabled={disabled}
              defaultValue={draft.estimatedHours}
              key={draft.estimatedHours}
              onBlur={(event) => {
                const value = event.target.value
                if (value && value !== draft.estimatedHours) {
                  void save('estimatedHours', { estimatedHours: value })
                }
              }}
            />
          )}
        </FormField>
      </div>

      <FormField
        name="detail-task-value"
        label={ar.tasks.taskValue}
        hint={ar.tasks.taskValueHint}
      >
        {(field) => (
          <Input
            {...field}
            inputMode="decimal"
            dir="ltr"
            disabled={disabled}
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
            onBlur={() => {
              if (
                /^\d{1,10}(\.\d{1,2})?$/.test(valueText) &&
                valueText !== draft.taskValue
              ) {
                void save('taskValue', { taskValue: valueText })
              } else {
                setValueText(draft.taskValue)
              }
            }}
          />
        )}
      </FormField>

      <div className="grid grid-cols-2 gap-3 border-t pt-4">
        <div className="flex flex-col gap-1">
          <p className="text-fg-muted text-xs font-medium">{ar.tasks.elapsed.raw}</p>
          {notStarted ? (
            <span className="text-fg-subtle text-sm">{ar.tasks.elapsed.notStarted}</span>
          ) : (
            <DurationText minutes={draft.elapsedMinutesRaw} className="text-sm" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-fg-muted text-xs font-medium">{ar.tasks.elapsed.working}</p>
          {notStarted ? (
            <span className="text-fg-subtle text-sm">{ar.tasks.elapsed.notStarted}</span>
          ) : (
            <DurationText minutes={draft.elapsedMinutesWorking} className="text-sm" />
          )}
        </div>
        <p className="text-fg-subtle col-span-2 text-xs">{ar.tasks.elapsed.hint}</p>
      </div>

      <ReassignDialog
        open={reassigning}
        onClose={() => setReassigning(false)}
        task={draft}
        userOptions={userOptions}
        onDone={onMutated}
      />
    </div>
  )
}
