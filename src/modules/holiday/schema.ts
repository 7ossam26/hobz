import { z } from 'zod'

import { ar } from '@/i18n/ar'
import { cairoDateKeySchema } from '@/lib/calendar/zod'

/** One Zod schema per input, shared between the server action and the form. */

export const holidayCoreShape = {
  date: cairoDateKeySchema,
  nameAr: z.string().trim().min(1, ar.holidays.errors.nameRequired).max(120),
  /**
   * Yearly holidays with a fixed Gregorian date — 7 January, 25 April, 1 May.
   * The Islamic ones move every year and must be entered per year, which is
   * why this is a per-row flag and not a property of the holiday's name.
   */
  isRecurring: z.boolean().default(false),
}

export const createHolidaySchema = z.object(holidayCoreShape)
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>

export const updateHolidaySchema = z.object({
  id: z.string().min(1),
  ...holidayCoreShape,
})
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>

export const holidayIdSchema = z.object({ id: z.string().min(1) })

export const listHolidaysSchema = z.object({
  /** Omitted → every stored row, which is what the settings screen wants. */
  year: z.number().int().min(1970).max(2200).optional(),
})
export type ListHolidaysInput = z.infer<typeof listHolidaysSchema>

/**
 * The import path the phase brief asks for.
 *
 * Same shape as SPEC §10's flow, one step smaller: dry-run first, then a
 * confirmed write. Nothing here parses a file — Phase 11 owns `.xlsx` and will
 * feed rows into this same service, so the validation and the reporting live
 * in one place rather than being written twice.
 */
export const importHolidaysSchema = z.object({
  rows: z.array(createHolidaySchema).min(1).max(500),
  dryRun: z.boolean().default(true),
})
export type ImportHolidaysInput = z.infer<typeof importHolidaysSchema>
