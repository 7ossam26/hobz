import { z } from 'zod'

import { MONEY_MAX_NUMBER } from '@/lib/money-format'

/**
 * Money is a string at the boundary, for the reason `modules/ledger/schema.ts`
 * gives: `z.number()` would parse a payment as a float before `lib/money` was
 * ever consulted (CLAUDE.md invariant 2).
 */
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/

/**
 * Zero is allowed here and nowhere else: it is how a payout floored at zero
 * (SPEC §5.4) is closed off, since there is nothing to pay.
 */
export const paymentAmountSchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, 'money')
  .refine((value) => Number(value) <= MONEY_MAX_NUMBER, 'range')

export const closeCycleSchema = z.object({
  cycleId: z.string().min(1).optional(),
})
export type CloseCycleInput = z.infer<typeof closeCycleSchema>

export const payoutIdSchema = z.object({
  payoutId: z.string().min(1),
})
export type PayoutIdInput = z.infer<typeof payoutIdSchema>

export const markPayoutPaidSchema = z.object({
  payoutId: z.string().min(1),
  amount: paymentAmountSchema,
  /**
   * Validated against the live Settings list in the service, not here: the
   * schema is shared with the form, and a schema that hard-coded the four
   * default methods would be a business list living in code (CLAUDE.md
   * invariant 4).
   */
  method: z.string().trim().min(1).max(60).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
})
export type MarkPayoutPaidInput = z.infer<typeof markPayoutPaidSchema>

export const listPayoutsSchema = z.object({
  cycleId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PAID']).optional(),
})
export type ListPayoutsInput = z.infer<typeof listPayoutsSchema>
