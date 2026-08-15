import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { fromNextSearchParams } from '@/components/shared/data-table/next-search-params'
import { parseTableState } from '@/components/shared/data-table/state'
import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { TASK_VIEW_COOKIE, parseTaskView } from '@/lib/preferences'
import { can } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'
import { getProjectOptions } from '@/modules/project/queries'
import {
  getTaskBoard,
  getTaskCalendar,
  getTaskCategories,
  getTasks,
} from '@/modules/task/queries'
import { getUserOptions } from '@/modules/user/queries'

import { fromDateParam, monthGridRange, weekRange } from './calendar/date-grid'
import { toTaskQueryFilters } from './task-filters'
import { TasksClient } from './tasks-client'

export const metadata: Metadata = { title: ar.tasks.title }

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requireActor()
  const params = await searchParams
  const usp = fromNextSearchParams(params)
  const cookieStore = await cookies()

  // The view itself: the URL wins when present (so a switch is instant and
  // linkable), the remembered cookie is the default for a fresh visit, and
  // "board" is the default for a person who has never chosen (SPEC §9's
  // ClickUp-flavoured default).
  const viewParam = usp.get('view')
  const view =
    viewParam === 'board' || viewParam === 'list' || viewParam === 'calendar'
      ? viewParam
      : parseTaskView(cookieStore.get(TASK_VIEW_COOKIE)?.value)

  const state = parseTableState(usp)
  const filters = toTaskQueryFilters(state)
  const now = new Date()

  const calMode = usp.get('cm') === 'week' ? 'week' : 'month'
  const calReference = fromDateParam(usp.get('cd'), now)
  const calRange =
    calMode === 'week' ? weekRange(calReference) : monthGridRange(calReference)

  const permissions = {
    canCreate: can(actor, 'task.create'),
    canAssign: can(actor, 'task.assign'),
    canEdit: can(actor, 'task.edit'),
    canApprove: can(actor, 'task.approve'),
    canCancel: can(actor, 'task.cancel'),
    canComment: can(actor, 'task.comment'),
  }

  // `getTaskBoard`/`getTasks`/`getTaskCalendar` all take `Record<string,
  // unknown>` because their real boundary is the Zod parse inside them
  // (`listTasksSchema`, `modules/task/schema.ts`) — the cast here is just
  // TypeScript's "a named interface needs an index signature to satisfy a
  // mapped type" rule, not a loosening of validation.
  const rawFilters = filters as Record<string, unknown>

  const [
    board,
    list,
    calendar,
    projectOptions,
    userOptions,
    categories,
    pollingIntervalSeconds,
  ] = await Promise.all([
    view === 'board' ? getTaskBoard(rawFilters, now) : Promise.resolve(null),
    view === 'list'
      ? getTasks(
          {
            ...rawFilters,
            sort: state.sort ?? undefined,
            dir: state.dir,
            page: state.page,
            pageSize: state.pageSize,
          },
          now,
        )
      : Promise.resolve(null),
    view === 'calendar'
      ? getTaskCalendar(rawFilters, { from: calRange.from, to: calRange.to }, now)
      : Promise.resolve(null),
    getProjectOptions(),
    getUserOptions(),
    getTaskCategories(),
    getSetting('notifications.pollingIntervalSeconds'),
  ])

  return (
    <TasksClient
      view={view}
      state={state}
      board={board}
      list={list}
      calendar={calendar}
      calMode={calMode}
      calReferenceIso={calReference.toISOString()}
      projectOptions={projectOptions}
      userOptions={userOptions}
      categories={categories}
      permissions={permissions}
      pollingIntervalSeconds={pollingIntervalSeconds}
      currentUserId={actor.id}
    />
  )
}
