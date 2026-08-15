import type { MilestoneStatusInput } from '@/modules/milestone/schema'

/**
 * `payload.milestones[].dueDateOffsetDays` is measured from the *source*
 * project's `startDate` — not an absolute date, because the whole point of a
 * template is to apply the same relative timeline to a project with a
 * different start date. `null` when the source milestone had no due date.
 */
export interface ProjectTemplateMilestonePayload {
  name: string
  order: number
  dueDateOffsetDays: number | null
  status: MilestoneStatusInput
}

/**
 * SPEC §4: "spawns milestones+tasks". `tasks` is reserved for Phase 4 — there
 * is no `Task` table yet to capture a structure from, so it stays empty and
 * typed `never[]` rather than omitted, so the day Phase 4 fills it in is a
 * type change here, not a silent shape drift.
 */
export interface ProjectTemplatePayload {
  milestones: ProjectTemplateMilestonePayload[]
  tasks: never[]
}

export interface ProjectTemplateSummaryDto {
  id: string
  name: string
  milestoneCount: number
  createdAt: Date
}

export interface ProjectTemplateDetailDto extends ProjectTemplateSummaryDto {
  payload: ProjectTemplatePayload
}
