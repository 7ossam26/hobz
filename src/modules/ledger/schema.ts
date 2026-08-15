import { z } from 'zod'

import { MONEY_MAX } from '@/lib/money'

import { LEDGER_TYPES } from './sign'

/**
 * Zod schemas, shared between the server action and the form (CLAUDE.md
 * architecture rules).
 *
 * Money is a **string** at the boundary, never `z.number()`. A number would be
 * parsed as a float on the way in, which is the one thing CLAUDE.md invariant 2
 * forbids — and it would happen before any of `lib/money` got a say.
 */

const MONEY_PATTERN = /^-?\d{1,10}(\.\d{1,2})?$/

/** Positive magnitude: what a form asks for. The service applies the sign. */
export const moneyMagnitudeSchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, 'money')
  .refine((value) => Number(value) > 0, 'positive')
  .refine((value) => Number(value) <= MONEY_MAX.toNumber(), 'range')

/** Signed, non-zero: what an adjustment asks for. */
export const signedMoneySchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, 'money')
  .refine((value) => Number(value) !== 0, 'nonZero')
  .refine((value) => Math.abs(Number(value)) <= MONEY_MAX.toNumber(), 'range')

const reason = z.string().trim().min(3).max(500)

export const recordAdvanceSchema = z.object({
  userId: z.string().min(1),
  amount: moneyMagnitudeSchema,
  note: reason,
})
export type RecordAdvanceInput = z.infer<typeof recordAdvanceSchema>

export const recordAdjustmentSchema = z.object({
  userId: z.string().min(1),
  amount: signedMoneySchema,
  reason,
  taskId: z.string().min(1).optional(),
})
export type RecordAdjustmentInput = z.infer<typeof recordAdjustmentSchema>

export const recordBonusSchema = z.object({
  userId: z.string().min(1),
  amount: moneyMagnitudeSchema,
  reason,
})
export type RecordBonusInput = z.infer<typeof recordBonusSchema>

export const reverseEntrySchema = z.object({
  entryId: z.string().min(1),
  reason,
})
export type ReverseEntryInput = z.infer<typeof reverseEntrySchema>

export const listLedgerSchema = z.object({
  userId: z.string().min(1).optional(),
  cycleId: z.string().min(1).optional(),
  type: z.enum(LEDGER_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListLedgerInput = z.infer<typeof listLedgerSchema>
