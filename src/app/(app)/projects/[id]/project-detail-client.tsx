'use client'

import { Pencil, Save, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { HealthBadge } from '@/components/data/health-badge'
import { ProjectStatusChip } from '@/components/data/status-chip'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'
import type { MilestoneDto } from '@/modules/milestone/types'
import { deleteProjectAction } from '@/modules/project/actions'
import type { EngagementType } from '@/modules/project/schema'
import type { ProjectDetailDto } from '@/modules/project/types'

import { ProjectEditSheet } from './project-edit-sheet'
import { ProjectOverviewTab } from './project-overview-tab'
import { ProjectSaveTemplateDialog } from './project-save-template-dialog'
import { ProjectTeamTab } from './project-team-tab'
import { ProjectTimelineTab } from './project-timeline-tab'

interface Props {
  project: ProjectDetailDto
  milestones: MilestoneDto[]
  clientOptions: Array<{ id: string; name: string }>
  userOptions: Array<{ id: string; fullName: string; username: string }>
  engagementTypes: readonly EngagementType[]
  permissions: { edit: boolean; delete: boolean }
}

type TabId = 'overview' | 'tasks' | 'team' | 'timeline'

/**
 * The project detail page (SPEC §9 normally reserves full pages for "lists,
 * dashboards, settings, and reports" — the phase brief explicitly asks for a
 * project detail *page* with tabs regardless, which this follows literally
 * rather than silently reconciling the two; flagged in docs/DECISIONS.md).
 * Within the page, everything is still edited in a sheet or dialog over it —
 * the tabs themselves are content, never routes.
 */
export function ProjectDetailClient({
  project,
  milestones,
  clientOptions,
  userOptions,
  engagementTypes,
  permissions,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [tab, setTab] = React.useState<TabId>('overview')
  const [editing, setEditing] = React.useState(false)
  const [savingTemplate, setSavingTemplate] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  function confirmDelete() {
    startTransition(async () => {
      try {
        await deleteProjectAction({ id: project.id })
        toast({ title: ar.projects.deleted, tone: 'success' })
        router.push('/projects')
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'overview', label: ar.projects.tabs.overview },
    { id: 'tasks', label: ar.projects.tabs.tasks },
    { id: 'team', label: ar.projects.tabs.team, count: project.members.length },
    { id: 'timeline', label: ar.projects.tabs.timeline, count: milestones.length },
  ]

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span dir="ltr" className="text-fg-muted font-mono text-sm">
                {project.code}
              </span>
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {project.name}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ProjectStatusChip status={project.status} size="sm" />
              <HealthBadge
                health={project.health.health}
                overridden={project.health.overridden}
                {...(project.health.reason ? { reason: project.health.reason } : {})}
                size="sm"
              />
            </div>
          </div>

          {permissions.edit ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSavingTemplate(true)}>
                <Save />
                {ar.projects.templates.saveAsTemplate}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil />
                {ar.common.edit}
              </Button>
              {permissions.delete ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  aria-label={ar.common.delete}
                  title={ar.common.delete}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          role="tablist"
          className="-mb-px flex items-center gap-1 overflow-x-auto border-b"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
                'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                tab === t.id
                  ? 'border-accent-solid text-foreground font-medium'
                  : 'text-fg-muted hover:text-foreground border-transparent',
              )}
            >
              {t.label}
              {t.count ? (
                <span className="bg-muted text-fg-muted rounded-full px-1.5 text-[0.6875rem] tabular-nums">
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      <div role="tabpanel">
        {tab === 'overview' ? (
          <ProjectOverviewTab project={project} canEdit={permissions.edit} />
        ) : null}
        {tab === 'tasks' ? (
          <EmptyState
            title={ar.projects.tasksPlaceholder.title}
            description={ar.projects.tasksPlaceholder.description}
          />
        ) : null}
        {tab === 'team' ? (
          <ProjectTeamTab
            project={project}
            userOptions={userOptions}
            canEdit={permissions.edit}
          />
        ) : null}
        {tab === 'timeline' ? (
          <ProjectTimelineTab
            projectId={project.id}
            milestones={milestones}
            canEdit={permissions.edit}
          />
        ) : null}
      </div>

      {permissions.edit ? (
        <>
          <ProjectEditSheet
            open={editing}
            onClose={() => setEditing(false)}
            project={project}
            clientOptions={clientOptions}
            userOptions={userOptions}
            engagementTypes={engagementTypes}
          />
          <ProjectSaveTemplateDialog
            open={savingTemplate}
            onClose={() => setSavingTemplate(false)}
            projectId={project.id}
            defaultName={project.name}
          />
        </>
      ) : null}

      {permissions.delete ? (
        <ConfirmDialog
          open={deleting}
          onClose={() => setDeleting(false)}
          onConfirm={confirmDelete}
          title={ar.projects.deleteTitle}
          description={ar.projects.deleteDescription}
          confirmPhrase={project.name}
          busy={pending}
        />
      ) : null}
    </div>
  )
}
