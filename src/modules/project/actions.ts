'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'

import {
  addProjectMemberSchema,
  createProjectSchema,
  projectIdSchema,
  removeProjectMemberSchema,
  setProjectHealthOverrideSchema,
  updateProjectMemberRoleSchema,
  updateProjectSchema,
} from './schema'
import {
  addProjectMember,
  createProject,
  deleteProject,
  removeProjectMember,
  setProjectHealthOverride,
  updateProject,
  updateProjectMemberRole,
} from './service'

/**
 * Thin server actions: session → permission → zod → service → revalidate
 * (CLAUDE.md invariant 3). Team and health-override actions gate on
 * `project.edit` — SPEC §6 has no dedicated permission key for either, and
 * both are project-editing decisions.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

async function enabledEngagementTypes() {
  return getSetting('projects.engagementTypes')
}

export const createProjectAction = requirePermission(
  'project.create',
  async (actor, raw: unknown): Promise<{ id: string }> => {
    const input = createProjectSchema.parse(raw)
    const result = await createProject(prisma, {
      actor,
      input,
      enabledEngagementTypes: await enabledEngagementTypes(),
      ip: await ip(),
    })
    revalidatePath('/projects')
    return result
  },
)

export const updateProjectAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<{ id: string }> => {
    const input = updateProjectSchema.parse(raw)
    const result = await updateProject(prisma, {
      actor,
      input,
      enabledEngagementTypes: await enabledEngagementTypes(),
      ip: await ip(),
    })
    revalidatePath('/projects')
    revalidatePath(`/projects/${input.id}`)
    return result
  },
)

export const deleteProjectAction = requirePermission(
  'project.delete',
  async (actor, raw: unknown): Promise<void> => {
    const { id } = projectIdSchema.parse(raw)
    await deleteProject(prisma, { actor, id, ip: await ip() })
    revalidatePath('/projects')
  },
)

export const setProjectHealthOverrideAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<void> => {
    const input = setProjectHealthOverrideSchema.parse(raw)
    await setProjectHealthOverride(prisma, { actor, input, ip: await ip() })
    revalidatePath('/projects')
    revalidatePath(`/projects/${input.id}`)
  },
)

export const addProjectMemberAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<void> => {
    const input = addProjectMemberSchema.parse(raw)
    await addProjectMember(prisma, { actor, input, ip: await ip() })
    revalidatePath(`/projects/${input.projectId}`)
  },
)

export const updateProjectMemberRoleAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<void> => {
    const input = updateProjectMemberRoleSchema.parse(raw)
    await updateProjectMemberRole(prisma, { actor, input, ip: await ip() })
    revalidatePath(`/projects/${input.projectId}`)
  },
)

export const removeProjectMemberAction = requirePermission(
  'project.edit',
  async (actor, raw: unknown): Promise<void> => {
    const input = removeProjectMemberSchema.parse(raw)
    await removeProjectMember(prisma, { actor, input, ip: await ip() })
    revalidatePath(`/projects/${input.projectId}`)
  },
)
