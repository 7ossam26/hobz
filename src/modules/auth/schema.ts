import { z } from 'zod'

import { ar } from '@/i18n/ar'
import { normalizeUsername } from '@/lib/auth/username'

/**
 * Login and password-change inputs.
 *
 * `loginSchema` is intentionally permissive about *shape* — minimum length 1,
 * no format check. The login form is not the place to teach someone the
 * username rules: rejecting `AHMED ` here with "usernames are lowercase" tells
 * an attacker which of their guesses is well-formed, and tells a legitimate
 * user nothing they can act on. It normalises and lets the credential check
 * answer.
 */
export const loginSchema = z.object({
  username: z.string().min(1).max(64).transform(normalizeUsername),
  password: z.string().min(1).max(200),
})

export type LoginInput = z.infer<typeof loginSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, ar.validation.required),
    newPassword: z.string().min(1, ar.validation.required),
    confirmPassword: z.string().min(1, ar.validation.required),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: ar.auth.passwordMismatch,
    path: ['confirmPassword'],
  })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
