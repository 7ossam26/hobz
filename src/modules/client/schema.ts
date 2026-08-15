import { z } from 'zod'

import { ar } from '@/i18n/ar'
import { normalizeEgyptMobile } from '@/lib/phone'

/**
 * One Zod schema per input, shared between the server action and the form
 * (SPEC §3).
 *
 * The phone rule mirrors `modules/user/schema.ts` exactly: optional, an empty
 * string means "not provided", and normalisation to E.164 happens here so the
 * WhatsApp deep link (SPEC §8) never has to guess which of the six spellings a
 * human typed. Duplicated rather than imported — each module owns its schema,
 * the same shape `modules/setting` and `modules/user` already establish.
 */
const phoneSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))
  .superRefine((value, ctx) => {
    if (value !== null && normalizeEgyptMobile(value) === null) {
      ctx.addIssue({ code: 'custom', message: ar.validation.phoneInvalid })
    }
  })
  .transform((value) => (value === null ? null : normalizeEgyptMobile(value)))

const notesSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))

const clientCoreShape = {
  name: z.string().trim().min(1, ar.validation.required).max(160),
  phone: phoneSchema,
  notes: notesSchema,
}

export const createClientSchema = z.object({ ...clientCoreShape })
export type CreateClientInput = z.infer<typeof createClientSchema>

export const updateClientSchema = z.object({
  id: z.string().min(1),
  ...clientCoreShape,
})
export type UpdateClientInput = z.infer<typeof updateClientSchema>

export const clientIdSchema = z.object({ id: z.string().min(1) })

export const listClientsSchema = z.object({
  search: z.string().trim().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})
export type ListClientsInput = z.infer<typeof listClientsSchema>
