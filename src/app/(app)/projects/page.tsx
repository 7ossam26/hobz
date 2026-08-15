import type { Metadata } from 'next'

import { fromNextSearchParams } from '@/components/shared/data-table/next-search-params'
import { parseTableState } from '@/components/shared/data-table/state'
import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'
import { getClientOptions } from '@/modules/client/queries'
import { getProjectFacets, getProjects } from '@/modules/project/queries'
import { getProjectTemplates } from '@/modules/project-template/queries'
import { getUserOptions } from '@/modules/user/queries'

import { ProjectsClient } from './projects-client'

export const metadata: Metadata = { title: ar.projects.title }

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requireActor()
  const state = parseTableState(fromNextSearchParams(await searchParams))
  const canCreate = can(actor, 'project.create')

  // `getProjects()`/`getProjectFacets()` apply `scopeProjects(actor)`
  // themselves (CLAUDE.md invariant 3) — a `view.assigned` user simply gets
  // fewer rows and narrower facet options, never a thrown error.
  const [page, facets, clientOptions, userOptions, engagementTypes, templates] =
    await Promise.all([
      getProjects({
        search: state.search || undefined,
        status: state.filters.status,
        health: state.filters.health,
        ownerId: state.filters.owner,
        clientId: state.filters.client,
        sort: state.sort ?? undefined,
        dir: state.dir,
        page: state.page,
        pageSize: state.pageSize,
      }),
      getProjectFacets(),
      can(actor, 'client.view') ? getClientOptions() : Promise.resolve([]),
      getUserOptions(),
      getSetting('projects.engagementTypes'),
      canCreate ? getProjectTemplates() : Promise.resolve([]),
    ])

  return (
    <ProjectsClient
      state={state}
      page={page}
      facets={facets}
      clientOptions={clientOptions}
      userOptions={userOptions}
      engagementTypes={engagementTypes}
      templates={templates}
      canCreate={canCreate}
      currentUserId={actor.id}
    />
  )
}
