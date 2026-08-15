'use client'

import { Plus, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { DateText } from '@/components/data/date-text'
import { ProjectMark } from '@/components/data/entity-marks'
import { HealthBadge } from '@/components/data/health-badge'
import { ProjectStatusChip } from '@/components/data/status-chip'
import { UserChip } from '@/components/data/user-chip'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { ColumnDef, FacetDef } from '@/components/shared/data-table/types'
import type { TableState } from '@/components/shared/data-table/types'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { healthHue, projectStatusHue } from '@/lib/palette'
import { NO_CLIENT_FACET_VALUE, type EngagementType } from '@/modules/project/schema'
import type {
  ProjectFacetOptionsDto,
  ProjectPageDto,
  ProjectSummaryDto,
} from '@/modules/project/types'
import type { ProjectTemplateSummaryDto } from '@/modules/project-template/types'

import { ProjectCreateSheet } from './project-create-sheet'
import { PROJECT_STATUSES } from './project-fields-form'
import { ProjectFromTemplateSheet } from './project-from-template-sheet'

interface Props {
  state: TableState
  page: ProjectPageDto
  facets: ProjectFacetOptionsDto
  clientOptions: Array<{ id: string; name: string }>
  userOptions: Array<{ id: string; fullName: string; username: string }>
  engagementTypes: readonly EngagementType[]
  templates: ProjectTemplateSummaryDto[]
  canCreate: boolean
  currentUserId: string
}

const HEALTH_KEYS = ['RED', 'AMBER', 'GREEN'] as const

export function ProjectsClient({
  state,
  page,
  facets,
  clientOptions,
  userOptions,
  engagementTypes,
  templates,
  canCreate,
  currentUserId,
}: Props) {
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const [creatingFromTemplate, setCreatingFromTemplate] = React.useState(false)

  const columns: ColumnDef<ProjectSummaryDto>[] = [
    {
      id: 'name',
      header: ar.projects.name,
      hideable: false,
      sortable: true,
      cell: (row) => (
        <ProjectMark project={{ id: row.id, code: row.code, name: row.name }} />
      ),
    },
    {
      id: 'client',
      header: ar.projects.client,
      cell: (row) =>
        row.client ? (
          row.client.name
        ) : (
          <span className="text-fg-subtle">{ar.projects.noClient}</span>
        ),
    },
    {
      id: 'owner',
      header: ar.projects.owner,
      cell: (row) => <UserChip user={row.owner} size="sm" showWhatsapp={false} />,
    },
    {
      id: 'status',
      header: ar.projects.status,
      sortable: true,
      cell: (row) => <ProjectStatusChip status={row.status} size="sm" />,
    },
    {
      id: 'health',
      header: ar.projects.facets.health,
      cell: (row) => (
        <HealthBadge
          health={row.health.health}
          overridden={row.health.overridden}
          {...(row.health.reason ? { reason: row.health.reason } : {})}
          size="sm"
        />
      ),
    },
    {
      id: 'dueDate',
      header: ar.projects.dueDate,
      sortable: true,
      align: 'end',
      cell: (row) => <DateText value={row.dueDate} variant="short" />,
    },
  ]

  const facetDefs: FacetDef[] = [
    {
      id: 'status',
      label: ar.projects.facets.status,
      options: PROJECT_STATUSES.map((status) => ({
        value: status,
        label: ar.enums.projectStatus[status],
        hue: projectStatusHue(status),
        ...(facets.statusCounts[status] === undefined
          ? {}
          : { count: facets.statusCounts[status] }),
      })),
    },
    {
      id: 'health',
      label: ar.projects.facets.health,
      options: HEALTH_KEYS.map((health) => ({
        value: health,
        label: ar.health[health],
        hue: healthHue(health),
      })),
    },
    {
      id: 'owner',
      label: ar.projects.facets.owner,
      options: facets.owners.map((owner) => ({ value: owner.id, label: owner.fullName })),
    },
    {
      id: 'client',
      label: ar.projects.facets.client,
      options: [
        { value: NO_CLIENT_FACET_VALUE, label: ar.projects.noClient },
        ...facets.clients.map((client) => ({ value: client.id, label: client.name })),
      ],
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{ar.projects.title}</h1>
        {canCreate ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCreatingFromTemplate(true)}>
              <Sparkles />
              {ar.projects.createFromTemplate}
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {ar.projects.create}
            </Button>
          </div>
        ) : null}
      </header>

      <DataTable
        id="projects"
        columns={columns}
        rows={page.items}
        total={page.total}
        state={state}
        facets={facetDefs}
        rowKey={(row) => row.id}
        onRowClick={(row) => router.push(`/projects/${row.id}`)}
        searchPlaceholder={ar.projects.searchPlaceholder}
        empty={
          <EmptyState
            title={ar.projects.empty}
            className="rounded-none border-0"
            action={
              canCreate ? (
                <Button onClick={() => setCreating(true)}>
                  {ar.projects.emptyAction}
                </Button>
              ) : undefined
            }
          />
        }
      />

      {canCreate ? (
        <>
          <ProjectCreateSheet
            open={creating}
            onClose={() => setCreating(false)}
            currentUserId={currentUserId}
            clientOptions={clientOptions}
            userOptions={userOptions}
            engagementTypes={engagementTypes}
          />
          <ProjectFromTemplateSheet
            open={creatingFromTemplate}
            onClose={() => setCreatingFromTemplate(false)}
            currentUserId={currentUserId}
            templates={templates}
            clientOptions={clientOptions}
            userOptions={userOptions}
            engagementTypes={engagementTypes}
          />
        </>
      ) : null}
    </div>
  )
}
