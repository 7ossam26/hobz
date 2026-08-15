import { z } from 'zod'

import { ar } from '@/i18n/ar'

const dateInput = z.union([z.coerce.date(), z.date()])

const optionalNote = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))

/**
 * SPEC §4 `ExtensionRequest`. A deadline is an instant, not a calendar date —
 * "Thursday 17:00" and "Thursday 09:00" are different promises — so unlike
 * holidays and leave this one carries a full `DateTime`.
 *
 * The reason is mandatory. An extension moves the line every deduction is
 * measured against; "why" is the least the record can carry.
 */
export const requestExtensionSchema = z.object({
  taskId: z.string().min(1),
  newDueDate: dateInput,
  reason: z.string().trim().min(1, ar.extensions.errors.reasonRequired).max(2000),
})
export type RequestExtensionInput = z.infer<typeof requestExtensionSchema>

export const decideExtensionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED']),
  decisionNote: optionalNote,
})
export type DecideExtensionInput = z.infer<typeof decideExtensionSchema>

export const extensionIdSchema = z.object({ id: z.string().min(1) })

export const listExtensionsSchema = z.object({
  taskId: z.string().min(1).optional(),
  status: z.array(z.enum(['PENDING', 'APPROVED', 'REJECTED'])).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
})
export type ListExtensionsInput = z.infer<typeof listExtensionsSchema>
