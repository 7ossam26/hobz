import { z } from 'zod'

import { ar } from '@/i18n/ar'

/** One Zod schema per input, shared between the server action and the form (SPEC §3). */

export const milestoneStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'DELAYED'])
export type MilestoneStatusInput = z.infer<typeof milestoneStatusSchema>

const optionalDate = z
  .union([z.coerce.date(), z.date()])
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? null : v))

export const createMilestoneSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, ar.validation.required).max(160),
  dueDate: optionalDate,
  status: milestoneStatusSchema.default('PENDING'),
})
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>

export const updateMilestoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, ar.validation.required).max(160),
  dueDate: optionalDate,
  status: milestoneStatusSchema,
})
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>

export const milestoneIdSchema = z.object({ id: z.string().min(1) })

export const reorderMilestonesSchema = z.object({
  projectId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
})
export type ReorderMilestonesInput = z.infer<typeof reorderMilestonesSchema>
