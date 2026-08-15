'use client'

import { Calendar, Kanban, List, Plus } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import type { TableState } from '@/components/shared/data-table/types'
import { useToast } from '@/components/shared/toast'
import { useAutoRefresh } from '@/components/shared/use-auto-refresh'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { preferenceCookie, TASK_VIEW_COOKIE, type TaskView } from '@/lib/preferences'
import type { TaxonomyEntry } from '@/lib/settings'
import { cn } from '@/lib/utils'
import type { ProjectOptionDto } from '@/modules/project/queries'
import { getTaskSheetDataAction, type TaskSheetDataDto } from '@/modules/task/actions'
import type { TaskBoardDto, TaskCalendarDto } from '@/modules/task/queries'
import type { TaskPageDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

import { BoardView } from './board/board-view'
import { CalendarView } from './calendar/calendar-view'
import { ListView } from './list/list-view'
import { TaskDetailSheet } from './sheet/task-detail-sheet'
import { TaskQuickCreateDialog } from './task-quick-create-dialog'

export interface TaskPermissions {
  canCreate: boolean
  canAssign: boolean
  canEdit: boolean
  canApprove: boolean
  canCancel: boolean
  canComment: boolean
}

interface Props {
  view: TaskView
  state: TableState
  board: TaskBoardDto | null
  list: TaskPageDto | null
  calendar: TaskCalendarDto | null
  calMode: 'month' | 'week'
  calReferenceIso: string
  projectOptions: ProjectOptionDto[]
  userOptions: UserOptionDto[]
  categories: readonly TaxonomyEntry[]
  permissions: TaskPermissions
  pollingIntervalSeconds: number
  currentUserId: string
}

const VIEW_TABS: Array<{ id: TaskView; icon: typeof Kanban }> = [
  { id: 'board', icon: Kanban },
  { id: 'list', icon: List },
  { id: 'calendar', icon: Calendar },
]

/**
 * The Phase 5 shell: switches between board/list/calendar, owns the one task
 * detail sheet every view opens into, and polls.
 *
 * Nothing here fetches its *own* list data — `board`/`list`/`calendar` all
 * arrive from the Server Component (CLAUDE.md: never a client waterfall). The
 * one deliberate exception is the detail sheet, which fetches on open exactly
 * as `EntitySheet`'s own doc comment describes, because a board card or a
 * list row only ever carries a summary.
 */
export function TasksClient({
  view,
  state,
  board,
  list,
  calendar,
  calMode,
  calReferenceIso,
  projectOptions,
  userOptions,
  categories,
  permissions,
  pollingIntervalSeconds,
  currentUserId,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)
  const [sheetData, setSheetData] = React.useState<TaskSheetDataDto | null>(null)
  const [sheetPending, startSheetTransition] = React.useTransition()

  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false)
  const [quickCreatePreset, setQuickCreatePreset] = React.useState<{
    requireAssignee: boolean
  }>({ requireAssignee: false })

  // Tab visibility pauses the whole thing; open sheets/dialogs do not need to,
  // because they hold their own local state and a background `router.refresh()`
  // only touches the server-driven list beneath them.
  useAutoRefresh(pollingIntervalSeconds, true)

  // `?new=1` — the command palette's quick-create deep link.
  React.useEffect(() => {
    if (searchParams.get('new') !== '1') return
    if (permissions.canCreate) {
      setQuickCreatePreset({ requireAssignee: false })
      setQuickCreateOpen(true)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    // Intentionally only on mount / when the param appears — stripping it
    // below must not re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('new')])

  function switchView(next: TaskView) {
    document.cookie = preferenceCookie(TASK_VIEW_COOKIE, next)
    const usp = new URLSearchParams(searchParams)
    usp.set('view', next)
    router.push(`${pathname}?${usp.toString()}`, { scroll: false })
  }

  function openTask(id: string) {
    setOpenTaskId(id)
    setSheetData(null)
    startSheetTransition(async () => {
      try {
        const data = await getTaskSheetDataAction(id)
        setSheetData(data)
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
        setOpenTaskId(null)
      }
    })
  }

  function closeTask() {
    setOpenTaskId(null)
    setSheetData(null)
  }

  function refreshOpenTask() {
    if (!openTaskId) return
    startSheetTransition(async () => {
      try {
        const data = await getTaskSheetDataAction(openTaskId)
        setSheetData(data)
      } catch {
        // The sheet keeps showing its last-known-good state; the surrounding
        // list/board still reconciles on the next poll or router.refresh().
      }
    })
  }

  function onMutated() {
    refreshOpenTask()
    router.refresh()
  }

  function openQuickCreate(
    preset: { requireAssignee: boolean } = { requireAssignee: false },
  ) {
    setQuickCreatePreset(preset)
    setQuickCreateOpen(true)
  }

  // "مهامي" — a one-click shortcut onto the same `assignee` facet every view
  // already reads (`task-filters.ts`), not a parallel filtering path.
  const mineActive =
    state.filters.assignee?.length === 1 && state.filters.assignee[0] === currentUserId

  function toggleMine() {
    const usp = new URLSearchParams(searchParams)
    if (mineActive) usp.delete('f_assignee')
    else usp.set('f_assignee', currentUserId)
    usp.delete('page')
    router.push(`${pathname}?${usp.toString()}`, { scroll: false })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{ar.tasks.title}</h1>
          <div
            role="tablist"
            aria-label={ar.common.view}
            className="bg-surface-sunken flex items-center gap-0.5 rounded-lg border p-0.5"
          >
            {VIEW_TABS.map((tab) => {
              const Icon = tab.icon
              const active = view === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchView(tab.id)}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                    active
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-fg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {ar.tasks.views[tab.id]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={mineActive ? 'default' : 'outline'}
            size="sm"
            onClick={toggleMine}
            aria-pressed={mineActive}
          >
            {ar.tasks.mine}
          </Button>
          {permissions.canCreate ? (
            <Button onClick={() => openQuickCreate({ requireAssignee: false })}>
              <Plus />
              {ar.tasks.create}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {view === 'board' && board ? (
          <BoardView
            board={board}
            userOptions={userOptions}
            permissions={permissions}
            onOpenTask={openTask}
            onQuickCreate={openQuickCreate}
            onMutated={() => router.refresh()}
          />
        ) : null}

        {view === 'list' && list ? (
          <ListView
            state={state}
            page={list}
            projectOptions={projectOptions}
            userOptions={userOptions}
            categories={categories}
            permissions={permissions}
            onOpenTask={openTask}
            onMutated={() => router.refresh()}
          />
        ) : null}

        {view === 'calendar' && calendar ? (
          <CalendarView
            data={calendar}
            mode={calMode}
            referenceIso={calReferenceIso}
            onOpenTask={openTask}
          />
        ) : null}
      </div>

      <TaskDetailSheet
        open={openTaskId !== null}
        onClose={closeTask}
        pending={sheetPending && !sheetData}
        data={sheetData}
        userOptions={userOptions}
        categories={categories}
        permissions={permissions}
        onMutated={onMutated}
      />

      {permissions.canCreate ? (
        <TaskQuickCreateDialog
          open={quickCreateOpen}
          onClose={() => setQuickCreateOpen(false)}
          requireAssignee={quickCreatePreset.requireAssignee}
          projectOptions={projectOptions}
          userOptions={userOptions}
          categories={categories}
          onCreated={(task) => {
            setQuickCreateOpen(false)
            router.refresh()
            openTask(task.id)
          }}
        />
      ) : null}
    </div>
  )
}
