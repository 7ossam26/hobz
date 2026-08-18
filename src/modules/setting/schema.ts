import { z } from 'zod'

import { SETTING_KEYS } from '@/lib/settings/catalog'

/**
 * One Zod schema per input, shared between the server action and the form
 * (SPEC §3). The form imports this file; so does `actions.ts`. There is never a
 * second, drifting definition of the same shape.
 */

const settingKeySchema = z.enum(SETTING_KEYS as [string, ...string[]])

export const updateSettingSchema = z.object({
  key: settingKeySchema,
  /**
   * Intentionally `unknown` at this boundary: the per-key shape lives in the
   * settings catalog, and `parseSettingValue` applies it. Duplicating the
   * validation here would create exactly the drift the catalog exists to prevent.
   */
  value: z.unknown(),
})

export type UpdateSettingInput = z.infer<typeof updateSettingSchema>

export const updateSettingsSchema = z.object({
  updates: z.array(updateSettingSchema).min(1),
})

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>
