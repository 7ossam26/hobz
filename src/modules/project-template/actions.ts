'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'

import { createProjectFromTemplateSchema, saveProjectAsTemplateSchema } from './schema'
import { createProjectFromTemplate, saveProjectAsTemplate } from './service'
import type { ProjectTemplateSummaryDto } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate
 * (CLAUDE.md invariant 3).
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

export const saveProjectAsTemplateAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<ProjectTemplateSummaryDto> => {
    const input = saveProjectAsTemplateSchema.parse(raw)
    return saveProjectAsTemplate(prisma, { actor, input, ip: await ip() })
  },
)

export const createProjectFromTemplateAction = requirePermission(
  'project.create',
  async (actor, raw: unknown): Promise<{ id: string }> => {
    const input = createProjectFromTemplateSchema.parse(raw)
    const enabledEngagementTypes = await getSetting('projects.engagementTypes')
    const requestIp = await ip()

    // All-or-nothing: the project and every one of its instantiated
    // milestones commit together, or none of them do (CLAUDE.md architecture).
    const result = await prisma.$transaction((tx) =>
      createProjectFromTemplate(tx, {
        actor,
        input,
        enabledEngagementTypes,
        ...(requestIp ? { ip: requestIp } : {}),
      }),
    )

    revalidatePath('/projects')
    return result
  },
)
