import { z } from 'zod'

import { ar } from '@/i18n/ar'

/**
 * Audit log filters (phase brief §6: actor, entity, date range).
 *
 * Dates arrive from `<input type="date">` as `YYYY-MM-DD` in the *viewer's*
 * calendar, and rows are stored UTC. The conversion is deliberately explicit in
 * `service.ts` rather than hidden in a coercion here — a date filter that is
 * silently off by the Cairo offset would hide the very rows an investigation is
 * looking for.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()

export const auditFilterSchema = z
  .object({
    actorId: z.string().trim().optional(),
    entity: z.string().trim().optional(),
    entityId: z.string().trim().optional(),
    action: z.string().trim().optional(),
    /** Inclusive, Cairo-local. */
    from: isoDate,
    /** Inclusive, Cairo-local — the whole day, not midnight. */
    to: isoDate,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: ar.validation.dateRangeInvalid,
    path: ['to'],
  })

export type AuditFilterInput = z.infer<typeof auditFilterSchema>
