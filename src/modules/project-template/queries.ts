import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { assertCan } from '@/lib/rbac'

import { getProjectTemplate, listProjectTemplates } from './service'
import type { ProjectTemplateDetailDto, ProjectTemplateSummaryDto } from './types'

/**
 * modules/project-template/queries.ts — read paths, permission-checked here
 * (CLAUDE.md invariant 3). Gated on `project.create`: the only reason to read
 * a template is to spawn a project from it, the same "gate the read by the
 * permission that makes it useful" reasoning `modules/user/queries.ts` applies
 * to the role picker.
 */

export async function getProjectTemplates(): Promise<ProjectTemplateSummaryDto[]> {
  const actor = await requireActor()
  assertCan(actor, 'project.create')
  return listProjectTemplates(prisma)
}

export async function getProjectTemplateById(
  id: string,
): Promise<ProjectTemplateDetailDto> {
  const actor = await requireActor()
  assertCan(actor, 'project.create')
  return getProjectTemplate(prisma, id)
}
