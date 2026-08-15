import { z } from 'zod'

import { ar } from '@/i18n/ar'

/**
 * One Zod schema per input, shared between the server action and the form
 * (SPEC §3).
 */

export const engagementTypeSchema = z.enum([
  'FIXED_PRICE',
  'RETAINER',
  'MILESTONE_BASED',
  'HOURLY',
])
export type EngagementType = z.infer<typeof engagementTypeSchema>

export const projectStatusSchema = z.enum([
  'DRAFT',
  'PROPOSED',
  'ACTIVE',
  'ON_HOLD',
  'IN_REVIEW',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
])
export type ProjectStatusInput = z.infer<typeof projectStatusSchema>

export const projectMemberRoleSchema = z.enum(['MANAGER', 'CONTRIBUTOR', 'VIEWER'])
export type ProjectMemberRoleInput = z.infer<typeof projectMemberRoleSchema>

/** The client facet's "no client" option — an id can never collide with it. */
export const NO_CLIENT_FACET_VALUE = '__none__'

export const computedHealthSchema = z.enum(['GREEN', 'AMBER', 'RED'])
export type ComputedHealthInput = z.infer<typeof computedHealthSchema>

/** Nullable strings arrive from a form as `''`; `''` reads as "not provided". */
const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))

const optionalNonNegativeInt = z
  .number()
  .int()
  .min(0, ar.validation.amountNegative)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? null : v))

/**
 * Dates arrive from a `<input type="date">` as `YYYY-MM-DD`, or already as a
 * `Date` when a caller constructs the payload directly (server-to-server, and
 * every test in this module).
 */
const dateInput = z.union([z.coerce.date(), z.date()])

/**
 * Exported (rather than kept module-private, like `modules/user/schema.ts`
 * keeps its equivalent) so `modules/project-template/schema.ts` can build
 * "create a project" plus "…from this template" on the exact same shape
 * instead of a second, drifting copy of every field and its validation.
 */
export const projectCoreShape = {
  name: z.string().trim().min(1, ar.validation.required).max(160),
  clientId: optionalId,
  ownerId: z.string().trim().min(1, ar.validation.required),
  engagementType: engagementTypeSchema,
  status: projectStatusSchema.default('DRAFT'),
  startDate: dateInput,
  dueDate: dateInput,
  /** `null` (or omitted) means "use Settings `penalty.defaultGraceHours`". */
  gracePeriodHours: optionalNonNegativeInt,
  /** `null` (or omitted) means "use Settings `penalty.penalizeRevisionLateness`". */
  penalizeRevisionLateness: z.boolean().nullable().optional().default(null),
}

export function refineDateOrder<T extends { startDate: Date; dueDate: Date }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if (value.startDate.getTime() > value.dueDate.getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueDate'],
      message: ar.validation.dateRangeInvalid,
    })
  }
}

export const createProjectSchema = z
  .object({
    /** Blank/omitted → auto-generated (`modules/project/code.ts`). */
    code: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    ...projectCoreShape,
  })
  .superRefine(refineDateOrder)

export type CreateProjectInput = z.infer<typeof createProjectSchema>

export const updateProjectSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().trim().min(1, ar.validation.required).max(40),
    ...projectCoreShape,
  })
  .superRefine(refineDateOrder)

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>

export const projectIdSchema = z.object({ id: z.string().min(1) })

export const listProjectsSchema = z.object({
  search: z.string().trim().optional(),
  status: z.array(projectStatusSchema).optional(),
  health: z.array(computedHealthSchema).optional(),
  ownerId: z.array(z.string()).optional(),
  /** `'none'` is the sentinel for "no client" — an id can never collide with it. */
  clientId: z.array(z.string()).optional(),
  sort: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})
export type ListProjectsInput = z.infer<typeof listProjectsSchema>

/**
 * SPEC §5.7: "manual override that REQUIRES a reason". A reason is required
 * to *clear* one too — reverting to the automatic calculation is also a
 * decision, and CLAUDE.md invariant 7 audits every status change regardless
 * of direction.
 */
export const setProjectHealthOverrideSchema = z.object({
  id: z.string().min(1),
  health: computedHealthSchema.nullable(),
  reason: z.string().trim().min(1, ar.validation.required).max(500),
})
export type SetProjectHealthOverrideInput = z.infer<typeof setProjectHealthOverrideSchema>

export const addProjectMemberSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: projectMemberRoleSchema.default('CONTRIBUTOR'),
})
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>

export const updateProjectMemberRoleSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: projectMemberRoleSchema,
})
export type UpdateProjectMemberRoleInput = z.infer<typeof updateProjectMemberRoleSchema>

export const removeProjectMemberSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
})
export type RemoveProjectMemberInput = z.infer<typeof removeProjectMemberSchema>
