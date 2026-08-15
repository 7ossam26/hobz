'use client'

import * as React from 'react'

import { DateText } from '@/components/data/date-text'
import { ProjectMark } from '@/components/data/entity-marks'
import { PriorityFlag } from '@/components/data/priority-flag'
import { StatusChip } from '@/components/data/status-chip'
import { UserChip } from '@/components/data/user-chip'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  ColumnDef,
  FacetDef,
  TableState,
} from '@/components/shared/data-table/types'
import { ar } from '@/i18n/ar'
import {
  PRIORITY_HUE,
  priorityHue,
  taskStatusHue,
  hueForIndexed,
  type Priority,
} from '@/lib/palette'
import type { TaxonomyEntry } from '@/lib/settings'
import type { ProjectOptionDto } from '@/modules/project/queries'
import { TASK_STATUSES } from '@/modules/task/state-machine'
import type { TaskPageDto, TaskSummaryDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

import { BOOLEAN_FACET_VALUE } from '../task-filters'
import type { TaskPermissions } from '../tasks-client'

import {
  BulkAssignDialog,
  BulkDueDateDialog,
  BulkPriorityDialog,
} from './bulk-action-dialogs'
import { TaskBulkBar } from './task-bulk-bar'

const PRIORITIES = Object.keys(PRIORITY_HUE) as Priority[]

export function ListView({
  state,
  page,
  projectOptions,
  userOptions,
  categories,
  permissions,
  onOpenTask,
  onMutated,
}: {
  state: TableState
  page: TaskPageDto
  projectOptions: ProjectOptionDto[]
  userOptions: UserOptionDto[]
  categories: readonly TaxonomyEntry[]
  permissions: TaskPermissions
  onOpenTask: (id: string) => void
  onMutated: () => void
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [bulkDialog, setBulkDialog] = React.useState<
    'assign' | 'priority' | 'dueDate' | null
  >(null)

  // A filter/sort/page change is a new result set — a selection made against
  // the previous one no longer means anything.
  React.useEffect(() => {
    setSelected(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.page, state.sort, state.dir, state.search, JSON.stringify(state.filters)])

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAllOnPage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const row of page.items) {
        if (checked) next.add(row.id)
        else next.delete(row.id)
      }
      return next
    })
  }

  const allOnPageSelected =
    page.items.length > 0 && page.items.every((row) => selected.has(row.id))

  const columns: ColumnDef<TaskSummaryDto>[] = [
    {
      id: 'select',
      header: (
        <input
          type="checkbox"
          aria-label={ar.tasks.list.selectAllPage}
          checked={allOnPageSelected}
          onChange={(event) => toggleAllOnPage(event.target.checked)}
          className="size-4 rounded"
        />
      ),
      hideable: false,
      sortable: false,
      width: '2.5rem',
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={ar.tasks.list.selectRow}
          checked={selected.has(row.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => toggleRow(row.id, event.target.checked)}
          className="size-4 rounded"
        />
      ),
    },
    {
      id: 'title',
      header: ar.tasks.taskTitle,
      hideable: false,
      sortable: true,
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{row.title}</span>
          <ProjectMark
            project={{ id: row.projectId, code: row.projectCode, name: row.projectName }}
            className="text-fg-subtle"
          />
        </div>
      ),
    },
    {
      id: 'assignee',
      header: ar.tasks.assignee,
      cell: (row) =>
        row.assignee ? (
          <UserChip user={row.assignee} size="sm" showWhatsapp={false} />
        ) : (
          <span className="text-fg-subtle text-xs">{ar.tasks.unassigned}</span>
        ),
    },
    {
      id: 'status',
      header: ar.tasks.status,
      sortable: true,
      cell: (row) => <StatusChip status={row.status} size="sm" />,
    },
    {
      id: 'priority',
      header: ar.tasks.priority,
      sortable: true,
      cell: (row) => <PriorityFlag priority={row.priority} />,
    },
    {
      id: 'category',
      header: ar.tasks.category,
      defaultHidden: true,
      cell: (row) => {
        const index = categories.findIndex((c) => c.id === row.categoryId)
        const label = categories[index]?.label ?? row.categoryId
        return (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span
              aria-hidden
              data-hue={hueForIndexed(index, row.categoryId)}
              className="bg-hue-solid size-2 shrink-0 rounded-full"
            />
            {label}
          </span>
        )
      },
    },
    {
      id: 'dueDate',
      header: ar.tasks.dueDate,
      sortable: true,
      align: 'end',
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5">
          {row.isOverdue ? (
            <span data-hue="red" className="text-hue-text text-xs font-medium">
              {ar.tasks.overdue}
            </span>
          ) : null}
          <DateText value={row.dueDate} variant="short" />
        </span>
      ),
    },
  ]

  const facets: FacetDef[] = [
    {
      id: 'project',
      label: ar.tasks.facets.project,
      options: projectOptions.map((p) => ({
        value: p.id,
        label: `${p.code} — ${p.name}`,
      })),
    },
    {
      id: 'assignee',
      label: ar.tasks.facets.assignee,
      options: userOptions.map((u) => ({ value: u.id, label: u.fullName })),
    },
    {
      id: 'status',
      label: ar.tasks.facets.status,
      options: TASK_STATUSES.map((status) => ({
        value: status,
        label: ar.enums.taskStatus[status],
        hue: taskStatusHue(status),
      })),
    },
    {
      id: 'priority',
      label: ar.tasks.facets.priority,
      options: PRIORITIES.map((priority) => ({
        value: priority,
        label: ar.enums.priority[priority],
        hue: priorityHue(priority),
      })),
    },
    {
      id: 'category',
      label: ar.tasks.facets.category,
      options: categories.map((c, index) => ({
        value: c.id,
        label: c.label,
        hue: hueForIndexed(index, c.id),
      })),
    },
    {
      id: 'overdueOnly',
      label: ar.tasks.facets.overdueOnly,
      options: [
        { value: BOOLEAN_FACET_VALUE, label: ar.tasks.facets.overdueOnly, hue: 'red' },
      ],
    },
    {
      id: 'dueThisWeek',
      label: ar.tasks.facets.dueThisWeek,
      options: [
        { value: BOOLEAN_FACET_VALUE, label: ar.tasks.facets.dueThisWeek, hue: 'amber' },
      ],
    },
  ]

  const selectedIds = React.useMemo(() => [...selected], [selected])

  return (
    <div className="flex flex-col gap-3">
      <TaskBulkBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        canAssign={permissions.canAssign}
        canEdit={permissions.canEdit}
        onAssign={() => setBulkDialog('assign')}
        onPriority={() => setBulkDialog('priority')}
        onDueDate={() => setBulkDialog('dueDate')}
      />

      <DataTable
        id="tasks-list"
        columns={columns}
        rows={page.items}
        total={page.total}
        state={state}
        facets={facets}
        rowKey={(row) => row.id}
        onRowClick={(row) => onOpenTask(row.id)}
        searchPlaceholder={ar.tasks.searchPlaceholder}
      />

      <BulkAssignDialog
        open={bulkDialog === 'assign'}
        onClose={() => setBulkDialog(null)}
        taskIds={selectedIds}
        userOptions={userOptions}
        onDone={() => {
          setSelected(new Set())
          onMutated()
        }}
      />
      <BulkPriorityDialog
        open={bulkDialog === 'priority'}
        onClose={() => setBulkDialog(null)}
        taskIds={selectedIds}
        onDone={() => {
          setSelected(new Set())
          onMutated()
        }}
      />
      <BulkDueDateDialog
        open={bulkDialog === 'dueDate'}
        onClose={() => setBulkDialog(null)}
        taskIds={selectedIds}
        onDone={() => {
          setSelected(new Set())
          onMutated()
        }}
      />
    </div>
  )
}
