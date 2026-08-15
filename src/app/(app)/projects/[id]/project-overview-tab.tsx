'use client'

import { Settings2 } from 'lucide-react'
import * as React from 'react'

import { DateText } from '@/components/data/date-text'
import { HealthBadge } from '@/components/data/health-badge'
import { ProjectStatusChip } from '@/components/data/status-chip'
import { UserChip } from '@/components/data/user-chip'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import type { ProjectDetailDto } from '@/modules/project/types'

import { ProjectHealthDialog } from './project-health-dialog'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-fg-subtle text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function ProjectOverviewTab({
  project,
  canEdit,
}: {
  project: ProjectDetailDto
  canEdit: boolean
}) {
  const [healthDialogOpen, setHealthDialogOpen] = React.useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2 rounded-md border p-3">
        <div className="flex items-center gap-3">
          <HealthBadge
            health={project.health.health}
            overridden={project.health.overridden}
            {...(project.health.reason ? { reason: project.health.reason } : {})}
          />
          {project.health.overridden ? (
            <span className="text-fg-muted text-xs">
              {ar.projects.health.computed}:{' '}
              <HealthBadge health={project.health.computed} size="sm" />
            </span>
          ) : null}
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setHealthDialogOpen(true)}>
            <Settings2 />
            {ar.projects.health.overrideAction}
          </Button>
        ) : null}
      </div>

      {project.health.overridden && project.health.reason ? (
        <p className="text-fg-muted -mt-3 text-xs">
          {ar.common.reason}: {project.health.reason}
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={ar.projects.client}>
          {project.client ? (
            project.client.name
          ) : (
            <span className="text-fg-subtle">{ar.projects.noClient}</span>
          )}
        </Field>

        <Field label={ar.projects.owner}>
          <UserChip user={project.owner} size="sm" />
        </Field>

        <Field label={ar.projects.engagementType}>
          {ar.enums.engagementType[project.engagementType]}
        </Field>

        <Field label={ar.projects.status}>
          <ProjectStatusChip status={project.status} size="sm" />
        </Field>

        <Field label={ar.projects.startDate}>
          <DateText value={project.startDate} />
        </Field>

        <Field label={ar.projects.dueDate}>
          <DateText value={project.dueDate} />
        </Field>

        <Field label={ar.projects.gracePeriodHours}>
          {project.gracePeriodHours === null ? (
            <span className="text-fg-subtle">{ar.projects.usesDefault}</span>
          ) : (
            <span className="tabular-nums">{project.gracePeriodHours}</span>
          )}
        </Field>

        <Field label={ar.projects.penalizeRevisionLateness}>
          {project.penalizeRevisionLateness === null ? (
            <span className="text-fg-subtle">{ar.projects.usesDefault}</span>
          ) : project.penalizeRevisionLateness ? (
            ar.common.yes
          ) : (
            ar.common.no
          )}
        </Field>
      </dl>

      <ProjectHealthDialog
        open={healthDialogOpen}
        onClose={() => setHealthDialogOpen(false)}
        project={project}
      />
    </div>
  )
}
