import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { isAppError } from '@/lib/errors'
import { can } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'
import { getClientOptions } from '@/modules/client/queries'
import { getMilestones } from '@/modules/milestone/queries'
import { getProjectById } from '@/modules/project/queries'
import { getUserOptions } from '@/modules/user/queries'

import { ProjectDetailClient } from './project-detail-client'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { id } = await params
  try {
    const project = await getProjectById(id)
    return { title: `${project.code} · ${project.name}` }
  } catch {
    return { title: ar.projects.title }
  }
}

export default async function ProjectDetailPage({ params }: RouteParams) {
  const { id } = await params
  const actor = await requireActor()

  // `getProjectById` folds `scopeProjects(actor)` into the query itself
  // (CLAUDE.md invariant 3) — a `view.assigned` user requesting a project
  // they are not on resolves to the same `NotFoundError` a bad id would, by
  // direct URL included, which is the phase brief's exact requirement.
  let project
  try {
    project = await getProjectById(id)
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound()
    throw error
  }

  const [milestones, clientOptions, userOptions, engagementTypes] = await Promise.all([
    getMilestones(id),
    can(actor, 'client.view') ? getClientOptions() : Promise.resolve([]),
    getUserOptions(),
    getSetting('projects.engagementTypes'),
  ])

  return (
    <ProjectDetailClient
      project={project}
      milestones={milestones}
      clientOptions={clientOptions}
      userOptions={userOptions}
      engagementTypes={engagementTypes}
      permissions={{
        edit: can(actor, 'project.edit'),
        delete: can(actor, 'project.delete'),
      }}
    />
  )
}
