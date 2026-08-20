import { z } from 'zod'

import { MONEY_MAX_NUMBER } from '@/lib/money-format'
import { moneyMagnitudeSchema } from '@/modules/ledger/schema'

import { PENALTY_MODES } from './mode'

/**
 * Zod, shared between the server action and the form (CLAUDE.md architecture
 * rules). Money is a **string** at the boundary, never `z.number()` — the rule
 * `modules/ledger/schema` states and this file reuses rather than restates.
 */

/**
 * Free text, and mandatory — phase brief item 5: "reason is free text only
 * ('أخرى') per the agreed design".
 *
 * There is deliberately **no enum of sanctioned reasons**. A dropdown would
 * dress a manager's judgement up as a computed category and leave the منفّذ
 * reading "أخرى", which explains nothing. The whole point of separating manual
 * deductions from automatic ones is that this one is somebody's decision, and
 * the least it owes is a sentence.
 *
 * The 3-character floor is the same one `modules/ledger/schema` uses: enough to
 * stop "x" passing for an explanation, short enough not to argue with Arabic.
 */
const reason = z.string().trim().min(3).max(500)

export const createPenaltySchema = z.object({
  userId: z.string().min(1),
  amount: moneyMagnitudeSchema,
  reason,
  /** Optional: a manual deduction need not be about a task at all. */
  taskId: z.string().min(1).optional(),
})
export type CreatePenaltyInput = z.infer<typeof createPenaltySchema>

export const grantBonusSchema = z.object({
  userId: z.string().min(1),
  amount: moneyMagnitudeSchema,
  reason,
})
export type GrantBonusInput = z.infer<typeof grantBonusSchema>

export const reverseMoneyEntrySchema = z.object({
  entryId: z.string().min(1),
  reason,
})
export type ReverseMoneyEntryInput = z.infer<typeof reverseMoneyEntrySchema>

export const recomputeTaskPenaltySchema = z.object({
  taskId: z.string().min(1),
})
export type RecomputeTaskPenaltyInput = z.infer<typeof recomputeTaskPenaltySchema>

/**
 * A profile's `value` is unsigned and uncapped.
 *
 * **Unsigned**, because a negative deduction is a bonus, and the ledger's sign
 * check would reject it with a message about directions that tells an operator
 * nothing about the form they are filling in.
 *
 * **Uncapped** at 100 for the percentage modes, because SPEC §5.4 says "No
 * cap" and means it — a client contract can genuinely charge more than a task
 * is worth for a late delivery. `MONEY_MAX` is the only ceiling, and it is a
 * column width rather than a policy.
 */
const profileValue = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'money')
  .refine((value) => Number(value) >= 0, 'nonNegative')
  .refine((value) => Number(value) <= MONEY_MAX_NUMBER, 'range')

export const penaltyProfileSchema = z.object({
  name: z.string().trim().min(2).max(60),
  mode: z.enum(PENALTY_MODES),
  value: profileValue,
  /** Null means "use the organization's grace" — see `profile.ts`'s resolution chain. */
  graceHours: z.coerce.number().int().min(0).max(8760).nullable().default(null),
})
export type PenaltyProfileInputSchema = z.infer<typeof penaltyProfileSchema>

export const updatePenaltyProfileSchema = penaltyProfileSchema.extend({
  id: z.string().min(1),
})

export const deletePenaltyProfileSchema = z.object({ id: z.string().min(1) })

export const assignPenaltyProfileSchema = z.object({
  userId: z.string().min(1),
  profileId: z.string().min(1).nullable(),
})
export type AssignPenaltyProfileInput = z.infer<typeof assignPenaltyProfileSchema>

/** The manager's register (phase brief item 9). */
export const listMoneyRegisterSchema = z.object({
  kind: z.enum(['PENALTY', 'BONUS']).optional(),
  userId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  /** `true` = automatic only, `false` = manual only, absent = both. */
  automatic: z.enum(['auto', 'manual']).optional(),
  /** `true` = reversed only, `false` = standing only, absent = both. */
  reversed: z.enum(['reversed', 'standing']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListMoneyRegisterInput = z.infer<typeof listMoneyRegisterSchema>

/** SPEC R4: total deductions per period, reported as organization income. */
export const deductionsReportSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  groupBy: z.enum(['month', 'cycle', 'project', 'worker']).default('month'),
})
export type DeductionsReportInput = z.infer<typeof deductionsReportSchema>
