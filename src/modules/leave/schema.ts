import { z } from 'zod'

import { ar } from '@/i18n/ar'
import { cairoDateKeySchema } from '@/lib/calendar/zod'

export const leaveStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED'])
export type LeaveStatusInput = z.infer<typeof leaveStatusSchema>

const optionalNote = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))

/**
 * `startDate` and `endDate` are **inclusive** Cairo dates. A one-day leave has
 * both equal; there is no zero-length leave, and a reversed range is rejected
 * here rather than silently normalised — swapping the two would approve a
 * range nobody asked for.
 */
export const requestLeaveSchema = z
  .object({
    /** Whose leave it is. Not necessarily the requester (a manager may record it). */
    userId: z.string().min(1),
    startDate: cairoDateKeySchema,
    endDate: cairoDateKeySchema,
    /** Stable id from Settings `calendar.leaveTypes`, validated in the service. */
    typeId: z.string().trim().min(1, ar.validation.required).max(40),
    note: optionalNote,
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: ar.leave.errors.rangeInvalid,
    path: ['endDate'],
  })
export type RequestLeaveInput = z.infer<typeof requestLeaveSchema>

export const decideLeaveSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED']),
  decisionNote: optionalNote,
})
export type DecideLeaveInput = z.infer<typeof decideLeaveSchema>

export const leaveIdSchema = z.object({ id: z.string().min(1) })

export const listLeaveSchema = z.object({
  userId: z.array(z.string().min(1)).optional(),
  status: z.array(leaveStatusSchema).optional(),
  /** Inclusive Cairo dates bounding the *overlap* window, not the start date. */
  from: cairoDateKeySchema.optional(),
  to: cairoDateKeySchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
})
export type ListLeaveInput = z.infer<typeof listLeaveSchema>
