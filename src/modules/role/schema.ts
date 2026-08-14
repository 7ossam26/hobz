import { z } from 'zod'

import { ar } from '@/i18n/ar'
import { isPermission, type Permission } from '@/lib/rbac'

/**
 * One Zod schema per input, shared between the server action and the form
 * (SPEC §3). The form imports this file; so does `actions.ts`.
 */

/**
 * `z.custom` rather than `z.enum(PERMISSIONS)` so the parsed type is
 * `Permission` and the membership test is the same `isPermission` the catalog
 * exports — one source of truth for "is this a real permission key", which is
 * what stops a stale checkbox in a cached form from granting something.
 */
const permissionKeySchema = z.custom<Permission>(
  (value) => typeof value === 'string' && isPermission(value),
  { message: ar.validation.unknownPermission },
)

/**
 * A stable machine identifier: it appears in audit rows and in the hardcoded
 * `SUPER_ADMIN` check, so it must not drift when someone renames the role in
 * Arabic. Screaming case is what makes "this is an identifier, not a label"
 * legible at a glance in the role editor.
 */
const roleNameEnSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, ar.validation.roleNameEnFormat)

const roleNameArSchema = z.string().trim().min(1, ar.validation.roleNameArRequired).max(60)

/**
 * `.optional()` comes *last* on purpose. Applied before the transform, Zod
 * infers `description: string | undefined` as a **required** key, and every
 * caller — including every test — is then forced to pass `description:
 * undefined` explicitly. Optional last keeps the key genuinely optional.
 */
const descriptionSchema = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === '' ? undefined : v))
  .optional()

export const createRoleSchema = z.object({
  nameAr: roleNameArSchema,
  nameEn: roleNameEnSchema,
  description: descriptionSchema,
  permissions: z.array(permissionKeySchema).default([]),
})

export type CreateRoleInput = z.infer<typeof createRoleSchema>

export const updateRoleSchema = z.object({
  id: z.string().min(1),
  nameAr: roleNameArSchema,
  description: descriptionSchema,
  permissions: z.array(permissionKeySchema).default([]),
  // `nameEn` is deliberately absent. It is the identifier that audit history
  // and the SUPER_ADMIN check are written against; renaming it would silently
  // orphan both. Delete and recreate if it is genuinely wrong.
})

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>

export const deleteRoleSchema = z.object({ id: z.string().min(1) })

export type DeleteRoleInput = z.infer<typeof deleteRoleSchema>
