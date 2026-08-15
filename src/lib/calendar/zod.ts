import { z } from 'zod'

import { ar } from '@/i18n/ar'

import { isCairoDateKey, type CairoDateKey } from './cairo'

/**
 * A Cairo calendar date as a form value.
 *
 * Holidays and leave ranges are *dates*, not instants (see the schema comment
 * on `holidays.date`), and `<input type="date">` already hands over exactly
 * this shape. Carrying the string end to end means nothing in the request path
 * ever applies a timezone to a value that never had a time in it — the class
 * of bug where a holiday entered in Cairo lands on the previous day for a
 * server running in UTC.
 *
 * `isCairoDateKey` does the real work: it rejects 2026-02-30 and 2026-02-29
 * by round-tripping through the day number, not with a month-length table.
 */
export const cairoDateKeySchema = z
  .string()
  .trim()
  .refine((value): value is CairoDateKey => isCairoDateKey(value), {
    message: ar.calendar.errors.invalidDate,
  })
