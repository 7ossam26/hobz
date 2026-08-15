import { recordAudit } from '@/lib/audit'
import type { Db } from '@/lib/db'
import { DomainError, NotFoundError } from '@/lib/errors'
import type { Actor } from '@/lib/rbac'
import { listMilestones } from '@/modules/milestone/service'
import type { EngagementType } from '@/modules/project/schema'
import { createProject } from '@/modules/project/service'

import type { CreateProjectFromTemplateInput, SaveProjectAsTemplateInput } from './schema'
import type {
  ProjectTemplateDetailDto,
  ProjectTemplateMilestonePayload,
  ProjectTemplatePayload,
  ProjectTemplateSummaryDto,
} from './types'

/**
 * modules/project-template/service.ts — pure functions, dependency-injected
 * Prisma client, no `next/*` import (CLAUDE.md architecture rules).
 *
 * SPEC §4: "spawns milestones+tasks". The task half is a documented no-op —
 * see `ProjectTemplatePayload` in `types.ts` — until Phase 4 gives this
 * module a real `Task` to capture.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Plain calendar-day arithmetic, deliberately, same reasoning as
 * `modules/project/health.ts`: this reconstructs a due date from a template
 * offset, not a lateness or elapsed-working-time figure, so CLAUDE.md
 * invariant 5 does not route it through the not-yet-implemented `lib/calendar`.
 */
function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

type TemplateRow = { id: string; name: string; payload: unknown; createdAt: Date }

/**
 * `payload` is untyped JSON at the DB level (the same posture `lib/settings`
 * takes with `Setting.value`). A row that fails this shape check is
 * corruption, not a default to paper over — surfacing loudly here is what
 * keeps a broken template from silently spawning a project with no milestones.
 */
function parsePayload(raw: unknown): ProjectTemplatePayload {
  const value = raw as Partial<ProjectTemplatePayload> | null
  if (!value || !Array.isArray(value.milestones)) {
    throw new DomainError('projectTemplates.payloadInvalid')
  }
  return { milestones: value.milestones as ProjectTemplateMilestonePayload[], tasks: [] }
}

function toSummary(row: TemplateRow): ProjectTemplateSummaryDto {
  const payload = parsePayload(row.payload)
  return {
    id: row.id,
    name: row.name,
    milestoneCount: payload.milestones.length,
    createdAt: row.createdAt,
  }
}

function toDetail(row: TemplateRow): ProjectTemplateDetailDto {
  return { ...toSummary(row), payload: parsePayload(row.payload) }
}

const TEMPLATE_SELECT = { id: true, name: true, payload: true, createdAt: true } as const

export async function listProjectTemplates(db: Db): Promise<ProjectTemplateSummaryDto[]> {
  const rows = await db.projectTemplate.findMany({
    where: { deletedAt: null },
    select: TEMPLATE_SELECT,
    orderBy: { name: 'asc' },
  })
  return rows.map(toSummary)
}

export async function getProjectTemplate(
  db: Db,
  id: string,
): Promise<ProjectTemplateDetailDto> {
  const row = await db.projectTemplate.findFirst({
    where: { id, deletedAt: null },
    select: TEMPLATE_SELECT,
  })
  if (!row) throw new NotFoundError('ProjectTemplate', id)
  return toDetail(row)
}

export interface TemplateMutationArgs {
  actor: Actor
  ip?: string | undefined
}

/**
 * Captures the project's *milestone* structure only — offsets from
 * `startDate`, not absolute dates, so the same template fits a project that
 * starts on a different day.
 */
export async function saveProjectAsTemplate(
  db: Db,
  args: TemplateMutationArgs & { input: SaveProjectAsTemplateInput },
): Promise<ProjectTemplateSummaryDto> {
  const { input } = args

  const project = await db.project.findFirst({
    where: { id: input.projectId, deletedAt: null },
    select: { id: true, startDate: true },
  })
  if (!project) throw new NotFoundError('Project', input.projectId)

  const milestones = await listMilestones(db, project.id)

  const payload: ProjectTemplatePayload = {
    milestones: milestones.map((m) => ({
      name: m.name,
      order: m.order,
      dueDateOffsetDays: m.dueDate
        ? Math.round((m.dueDate.getTime() - project.startDate.getTime()) / DAY_MS)
        : null,
      status: m.status,
    })),
    tasks: [],
  }

  const row = await db.projectTemplate.create({
    data: { name: input.name, payload: payload as never, createdById: args.actor.id },
    select: TEMPLATE_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'projectTemplate.created',
    entity: 'ProjectTemplate',
    entityId: row.id,
    after: {
      name: input.name,
      sourceProjectId: input.projectId,
      milestoneCount: payload.milestones.length,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toSummary(row)
}

export interface CreateProjectFromTemplateArgs extends TemplateMutationArgs {
  input: CreateProjectFromTemplateInput
  enabledEngagementTypes: readonly EngagementType[]
}

/** Spawns a new project, then instantiates the template's milestones against it. */
export async function createProjectFromTemplate(
  db: Db,
  args: CreateProjectFromTemplateArgs,
): Promise<{ id: string }> {
  const { input } = args

  const template = await db.projectTemplate.findFirst({
    where: { id: input.templateId, deletedAt: null },
    select: TEMPLATE_SELECT,
  })
  if (!template) throw new NotFoundError('ProjectTemplate', input.templateId)
  const payload = parsePayload(template.payload)

  const { templateId: _templateId, ...projectInput } = input

  const { id: projectId } = await createProject(db, {
    actor: args.actor,
    input: projectInput,
    enabledEngagementTypes: args.enabledEngagementTypes,
    ...(args.ip ? { ip: args.ip } : {}),
  })

  // Sequential, inside the caller's transaction (`actions.ts`) — the same
  // "no nested `$transaction`" shape `modules/milestone/service.ts` uses.
  for (const milestone of [...payload.milestones].sort((a, b) => a.order - b.order)) {
    await db.milestone.create({
      data: {
        projectId,
        name: milestone.name,
        order: milestone.order,
        dueDate:
          milestone.dueDateOffsetDays === null
            ? null
            : addCalendarDays(input.startDate, milestone.dueDateOffsetDays),
        // Always PENDING: copying a source milestone's DONE/DELAYED status
        // onto a project that has not started yet would misreport progress
        // that never happened.
        status: 'PENDING',
      },
    })
  }

  await recordAudit(db, {
    actor: args.actor,
    action: 'project.createdFromTemplate',
    entity: 'Project',
    entityId: projectId,
    after: {
      templateId: input.templateId,
      templateName: template.name,
      milestoneCount: payload.milestones.length,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return { id: projectId }
}
