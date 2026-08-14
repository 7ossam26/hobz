import { z } from 'zod'

import { ar } from '@/i18n/ar'
import { normalizeUsername, validateUsername } from '@/lib/auth/username'
import { normalizeEgyptMobile } from '@/lib/phone'

/**
 * One Zod schema per input, shared between the server action and the form.
 *
 * Normalisation happens **here**, at the boundary, not in the service and not
 * in the component: the username the throttle keys on, the username stored, and
 * the username typed at login all have to be the same string, and the only way
 * to guarantee that is to have exactly one place that produces it.
 */

const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .superRefine((value, ctx) => {
    for (const key of validateUsername(value)) {
      ctx.addIssue({
        code: 'custom',
        message:
          key === 'validation.usernameLength'
            ? ar.validation.usernameLength
            : ar.validation.usernameFormat,
      })
    }
  })

/**
 * Optional, and normalised to E.164 on the way in. An empty string means "not
 * provided" — that is what an untouched form field sends, and treating it as a
 * validation failure would make the field effectively required.
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

export const payTypeSchema = z.enum(['SALARY', 'PER_TASK', 'HYBRID'])
export type PayType = z.infer<typeof payTypeSchema>

/**
 * Money arrives from a form as a string and stays a string all the way to
 * Prisma's `Decimal` column. It is never parsed into a `number` on the way —
 * CLAUDE.md invariant 2, and the reason `parseFloat` is a lint error in this
 * directory.
 */
/**
 * Emptiness is resolved *before* the format check, not after.
 *
 * An untouched money field posts `''`. Running the regex first turns "I left
 * the salary blank because this worker is paid per task" into "the amount is
 * malformed" — which is both wrong and unactionable, and it masks the real
 * refinement below that would have said which field this pay type actually
 * needs.
 */
const moneySchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))
  .refine((v) => v === null || /^\d{1,10}(\.\d{1,2})?$/.test(v), {
    message: ar.validation.amountFormat,
  })

const rolesSchema = z.array(z.string().min(1)).default([])

/**
 * `payType` decides which money field is mandatory. Expressed as a refinement
 * rather than three separate schemas so the form and the action cannot disagree
 * about which combination is legal.
 *
 * A `SALARY` worker with no salary would make `dailyRate()` — and therefore
 * every `PCT_DAILY_RATE_PER_DAY` penalty in Phase 8 — divide by nothing.
 */
function requirePayFields<
  T extends {
    isWorker: boolean
    payType: PayType
    monthlySalary: string | null
    defaultTaskRate: string | null
  },
>(value: T, ctx: z.RefinementCtx): void {
  if (!value.isWorker) return

  const needsSalary = value.payType === 'SALARY' || value.payType === 'HYBRID'
  const needsRate = value.payType === 'PER_TASK' || value.payType === 'HYBRID'

  if (needsSalary && value.monthlySalary === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['monthlySalary'],
      message: ar.validation.salaryRequiredForPayType,
    })
  }
  if (needsRate && value.defaultTaskRate === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['defaultTaskRate'],
      message: ar.validation.rateRequiredForPayType,
    })
  }
}

const userCoreShape = {
  fullName: z.string().trim().min(1, ar.validation.fullNameRequired).max(120),
  phone: phoneSchema,
  isWorker: z.boolean().default(false),
  payType: payTypeSchema.default('PER_TASK'),
  monthlySalary: moneySchema,
  defaultTaskRate: moneySchema,
  weeklyCapacityHours: z
    .number()
    .int()
    .min(1, ar.validation.capacityRange)
    .max(168, ar.validation.capacityRange)
    .default(40),
  /**
   * The per-user penalty formula override (SPEC R2). `PenaltyProfile` is a
   * Phase 8 table, so this is the seam and nothing more — a free-form id that
   * Phase 8 will constrain to a real foreign key.
   */
  penaltyProfileId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v)),
  roles: rolesSchema,
}

export const createUserSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(1, ar.validation.required),
    ...userCoreShape,
  })
  .superRefine(requirePayFields)

export type CreateUserInput = z.infer<typeof createUserSchema>

export const updateUserSchema = z
  .object({
    id: z.string().min(1),
    // `username` is absent on purpose: it is the login handle and the throttle
    // key, and renaming it mid-life locks the person out of their own account.
    ...userCoreShape,
  })
  .superRefine(requirePayFields)

export type UpdateUserInput = z.infer<typeof updateUserSchema>

export const userIdSchema = z.object({ id: z.string().min(1) })

export const resetPasswordSchema = z.object({
  id: z.string().min(1),
  newPassword: z.string().min(1, ar.validation.required),
})

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const listUsersSchema = z.object({
  search: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  isWorker: z.boolean().optional(),
  roleId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export type ListUsersInput = z.infer<typeof listUsersSchema>
