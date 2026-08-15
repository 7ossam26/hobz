import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import { scopeProjects } from '@/lib/rbac'

import { listMilestones } from './service'
import type { MilestoneDto } from './types'

/**
 * modules/milestone/queries.ts — gated through the parent project's scope
 * (CLAUDE.md invariant 3). Milestones have no permission key of their own in
 * the SPEC §6 catalog; visibility follows the project they belong to.
 */
export async function getMilestones(projectId: string): Promise<MilestoneDto[]> {
  const actor = await requireActor()

  const project = await prisma.project.findFirst({
    where: { ...scopeProjects(actor), id: projectId },
    select: { id: true },
  })
  if (!project) throw new NotFoundError('Project', projectId)

  return listMilestones(prisma, projectId)
}
