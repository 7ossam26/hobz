'use client'

import { TriangleAlert, X } from 'lucide-react'
import * as React from 'react'

import { StatusChip } from '@/components/data/status-chip'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import {
  addTaskDependencyAction,
  getTaskOptionsForProjectAction,
  removeTaskDependencyAction,
} from '@/modules/task/actions'
import type { TaskOptionDto } from '@/modules/task/queries'
import type { DependencyRowDto, TaskDetailDto } from '@/modules/task/types'

import type { TaskPermissions } from '../tasks-client'

/**
 * SPEC §4/§5.1: finish-to-start, **warning only, never a block**. The banner
 * above the list is the whole enforcement of that rule in this tab — nothing
 * here disables anything else in the sheet while a dependency is open.
 */
export function TaskDependenciesTab({
  task,
  dependencies,
  dependents,
  permissions,
  onMutated,
}: {
  task: TaskDetailDto
  dependencies: DependencyRowDto[]
  dependents: DependencyRowDto[]
  permissions: TaskPermissions
  onMutated: () => void
}) {
  const { toast } = useToast()
  const [options, setOptions] = React.useState<TaskOptionDto[] | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [picked, setPicked] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const unsatisfied = dependencies.filter((d) => !d.satisfied)
  const existingIds = new Set(dependencies.map((d) => d.taskId))

  async function openAdd() {
    setAdding(true)
    if (options === null) {
      try {
        const list = await getTaskOptionsForProjectAction(task.projectId)
        setOptions(list.filter((o) => o.id !== task.id && !existingIds.has(o.id)))
      } catch {
        setOptions([])
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    }
  }

  async function add() {
    if (!picked) return
    setBusy(true)
    try {
      await addTaskDependencyAction({ taskId: task.id, dependsOnTaskId: picked })
      toast({ title: ar.tasks.dependencies.added, tone: 'success' })
      onMutated()
      setAdding(false)
      setPicked('')
      setOptions(null)
    } catch {
      toast({ title: ar.errors.unexpected, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(dependsOnTaskId: string) {
    try {
      await removeTaskDependencyAction({ taskId: task.id, dependsOnTaskId })
      toast({ title: ar.tasks.dependencies.removed, tone: 'success' })
      onMutated()
    } catch {
      toast({ title: ar.errors.unexpected, tone: 'error' })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {unsatisfied.length > 0 ? (
        <div
          data-hue="amber"
          className="bg-hue-surface text-hue-text flex items-start gap-2 rounded-lg border p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {ar.tasks.dependencies.warningTitle.replace(
              '{count}',
              String(unsatisfied.length),
            )}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{ar.tasks.dependencies.dependsOn}</p>
          {permissions.canEdit && !adding ? (
            <Button type="button" variant="outline" size="sm" onClick={openAdd}>
              {ar.tasks.dependencies.add}
            </Button>
          ) : null}
        </div>

        {dependencies.length === 0 ? (
          <p className="text-fg-subtle text-sm">{ar.tasks.dependencies.empty}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {dependencies.map((dep) => (
              <li
                key={dep.taskId}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StatusChip status={dep.status} size="sm" />
                  <span className="truncate">{dep.title}</span>
                </span>
                {permissions.canEdit ? (
                  <button
                    type="button"
                    aria-label={ar.common.remove}
                    title={ar.common.remove}
                    onClick={() => void remove(dep.taskId)}
                    className="text-fg-subtle hover:text-destructive shrink-0 rounded p-1"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="flex items-center gap-2">
            <Select
              aria-label={ar.tasks.dependencyPicker.placeholder}
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
              className="flex-1"
            >
              <option value="">{ar.tasks.dependencyPicker.placeholder}</option>
              {(options ?? []).length === 0 && options !== null ? (
                <option value="" disabled>
                  {ar.tasks.dependencyPicker.empty}
                </option>
              ) : null}
              {(options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
            <Button type="button" size="sm" disabled={!picked || busy} onClick={add}>
              {ar.common.add}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              {ar.common.cancel}
            </Button>
          </div>
        ) : null}
      </div>

      {dependents.length > 0 ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm font-medium">{ar.tasks.dependencies.dependents}</p>
          <ul className="flex flex-col gap-1.5">
            {dependents.map((dep) => (
              <li
                key={dep.taskId}
                className="flex items-center gap-2 rounded-md border p-2 text-sm"
              >
                <StatusChip status={dep.status} size="sm" />
                <span className="truncate">{dep.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
