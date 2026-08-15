import { recordAudit } from '@/lib/audit'
import type { Db } from '@/lib/db'
import { DomainError, NotFoundError } from '@/lib/errors'
import type { Actor } from '@/lib/rbac'

import type {
  CreateMilestoneInput,
  ReorderMilestonesInput,
  UpdateMilestoneInput,
} from './schema'
import type { MilestoneDto } from './types'

/**
 * modules/milestone/service.ts — pure functions, dependency-injected Prisma
 * client, no `next/*` import (CLAUDE.md architecture rules).
 *
 * SPEC §4: "Milestone id, projectId, name, dueDate, order, status" — no
 * `deletedAt` in that listing, unlike every other Work entity. Removal here
 * is a real `DELETE`, matching the junction-table precedent
 * (`UserRole`/`RolePermission` from Phase 0, `ProjectMember` in this phase).
 *
 * `reorderMilestones` takes multiple sequential writes but never opens its own
 * transaction — `Db` deliberately omits `$transaction` (`lib/db.ts`) so a
 * service can never nest one. The caller (`actions.ts`) opens
 * `prisma.$transaction()` and passes the transaction client in as `db`, the
 * same shape `modules/setting/actions.ts` established for multi-write actions.
 */

const MILESTONE_SELECT = {
  id: true,
  projectId: true,
  name: true,
  dueDate: true,
  order: true,
  status: true,
} as const

type MilestoneRow = {
  id: string
  projectId: string
  name: string
  dueDate: Date | null
  order: number
  status: string
}

function toDto(row: MilestoneRow): MilestoneDto {
  return { ...row, status: row.status as MilestoneDto['status'] }
}

export async function listMilestones(db: Db, projectId: string): Promise<MilestoneDto[]> {
  const rows = await db.milestone.findMany({
    where: { projectId },
    select: MILESTONE_SELECT,
    orderBy: { order: 'asc' },
  })
  return rows.map(toDto)
}

export interface MilestoneMutationArgs {
  actor: Actor
  ip?: string | undefined
}

async function assertProjectExists(db: Db, projectId: string): Promise<void> {
  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true },
  })
  if (!project) throw new NotFoundError('Project', projectId)
}

export async function createMilestone(
  db: Db,
  args: MilestoneMutationArgs & { input: CreateMilestoneInput },
): Promise<MilestoneDto> {
  const { input } = args
  await assertProjectExists(db, input.projectId)

  // Appended to the end of this project's timeline — reordering is an
  // explicit, separate action (drag, in the UI).
  const last = await db.milestone.findFirst({
    where: { projectId: input.projectId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  const order = (last?.order ?? -1) + 1

  const row = await db.milestone.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      dueDate: input.dueDate,
      status: input.status,
      order,
    },
    select: MILESTONE_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'milestone.created',
    entity: 'Milestone',
    entityId: row.id,
    after: {
      projectId: input.projectId,
      name: input.name,
      dueDate: input.dueDate,
      status: input.status,
      order,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toDto(row)
}

export async function updateMilestone(
  db: Db,
  args: MilestoneMutationArgs & { input: UpdateMilestoneInput },
): Promise<MilestoneDto> {
  const { input } = args

  const before = await db.milestone.findUnique({
    where: { id: input.id },
    select: MILESTONE_SELECT,
  })
  if (!before) throw new NotFoundError('Milestone', input.id)

  const row = await db.milestone.update({
    where: { id: before.id },
    data: { name: input.name, dueDate: input.dueDate, status: input.status },
    select: MILESTONE_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'milestone.updated',
    entity: 'Milestone',
    entityId: before.id,
    before: { name: before.name, dueDate: before.dueDate, status: before.status },
    after: { name: input.name, dueDate: input.dueDate, status: input.status },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toDto(row)
}

export async function deleteMilestone(
  db: Db,
  args: MilestoneMutationArgs & { id: string },
): Promise<void> {
  const before = await db.milestone.findUnique({
    where: { id: args.id },
    select: MILESTONE_SELECT,
  })
  if (!before) throw new NotFoundError('Milestone', args.id)

  await db.milestone.delete({ where: { id: before.id } })

  await recordAudit(db, {
    actor: args.actor,
    action: 'milestone.deleted',
    entity: 'Milestone',
    entityId: before.id,
    before: {
      name: before.name,
      dueDate: before.dueDate,
      status: before.status,
      order: before.order,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

/**
 * Drag-to-reorder (SPEC §4). `orderedIds` must be exactly the project's
 * current milestone set, just reshuffled — a partial list would silently
 * orphan the missing rows' order, and a foreign id would move someone else's
 * milestone into this project's timeline.
 */
export async function reorderMilestones(
  db: Db,
  args: MilestoneMutationArgs & { input: ReorderMilestonesInput },
): Promise<MilestoneDto[]> {
  const { input } = args
  await assertProjectExists(db, input.projectId)

  const current = await db.milestone.findMany({
    where: { projectId: input.projectId },
    select: { id: true, order: true },
  })
  const currentIds = new Set(current.map((m) => m.id))
  const requestedIds = new Set(input.orderedIds)

  const sameSet =
    currentIds.size === requestedIds.size &&
    requestedIds.size === input.orderedIds.length &&
    input.orderedIds.every((id) => currentIds.has(id))

  if (!sameSet) throw new DomainError('projects.milestones.reorderMismatch')

  const before = [...current].sort((a, b) => a.order - b.order).map((m) => m.id)

  // Sequential, not `Promise.all`: within a transaction, Prisma serialises
  // writes on one connection anyway, and sequential keeps the intent —
  // "assign these positions in this order" — legible in the query log.
  for (const [index, id] of input.orderedIds.entries()) {
    await db.milestone.update({ where: { id }, data: { order: index } })
  }

  await recordAudit(db, {
    actor: args.actor,
    action: 'milestone.reordered',
    entity: 'Project',
    entityId: input.projectId,
    before: { order: before },
    after: { order: input.orderedIds },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return listMilestones(db, input.projectId)
}
