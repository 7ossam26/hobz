'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'

import {
  createMilestoneSchema,
  milestoneIdSchema,
  reorderMilestonesSchema,
  updateMilestoneSchema,
} from './schema'
import {
  createMilestone,
  deleteMilestone,
  reorderMilestones,
  updateMilestone,
} from './service'
import type { MilestoneDto } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate
 * (CLAUDE.md invariant 3). All four gate on `project.edit` — milestones are a
 * sub-resource of the project they belong to.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

export const createMilestoneAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<MilestoneDto> => {
    const input = createMilestoneSchema.parse(raw)
    const milestone = await createMilestone(prisma, { actor, input, ip: await ip() })
    revalidatePath(`/projects/${input.projectId}`)
    return milestone
  },
)

export const updateMilestoneAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<MilestoneDto> => {
    const input = updateMilestoneSchema.parse(raw)
    const milestone = await updateMilestone(prisma, { actor, input, ip: await ip() })
    revalidatePath(`/projects/${milestone.projectId}`)
    return milestone
  },
)

export const deleteMilestoneAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<void> => {
    const { id } = milestoneIdSchema.parse(raw)
    const before = await prisma.milestone.findUnique({
      where: { id },
      select: { projectId: true },
    })
    await deleteMilestone(prisma, { actor, id, ip: await ip() })
    if (before) revalidatePath(`/projects/${before.projectId}`)
  },
)

export const reorderMilestonesAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<MilestoneDto[]> => {
    const input = reorderMilestonesSchema.parse(raw)
    const requestIp = await ip()
    // All-or-nothing (CLAUDE.md architecture): a reorder that wrote half its
    // rows would leave two milestones sharing an `order` value.
    const result = await prisma.$transaction((tx) =>
      reorderMilestones(tx, { actor, input, ...(requestIp ? { ip: requestIp } : {}) }),
    )
    revalidatePath(`/projects/${input.projectId}`)
    return result
  },
)
