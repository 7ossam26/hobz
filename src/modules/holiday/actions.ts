'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requireAuth, requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'

import {
  createHolidaySchema,
  holidayIdSchema,
  importHolidaysSchema,
  listHolidaysSchema,
  updateHolidaySchema,
} from './schema'
import {
  createHoliday,
  deleteHoliday,
  importHolidays,
  listHolidays,
  updateHoliday,
} from './service'
import type { HolidayDto, HolidayImportResult } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate.
 *
 * Writes are gated on `calendar.manage` (SPEC §6). **Reads are not**: which
 * days the agency is closed is not confidential, every worker needs it to read
 * their own deadlines, and SPEC §6 has no `calendar.view` key to gate it with.
 * Inventing one would be inventing a permission.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

function revalidateCalendar(): void {
  revalidatePath('/calendar')
  revalidatePath('/settings')
  // A holiday changes what every deadline is measured against (SPEC §5.3).
  revalidatePath('/tasks')
}

export const listHolidaysAction = requireAuth(
  async (_actor, raw: unknown): Promise<HolidayDto[]> =>
    listHolidays(prisma, listHolidaysSchema.parse(raw ?? {})),
)

export const createHolidayAction = requirePermission(
  'calendar.manage',
  async (actor, raw: unknown): Promise<HolidayDto> => {
    const input = createHolidaySchema.parse(raw)
    const holiday = await createHoliday(prisma, { actor, input, ip: await ip() })
    revalidateCalendar()
    return holiday
  },
)

export const updateHolidayAction = requirePermission(
  'calendar.manage',
  async (actor, raw: unknown): Promise<HolidayDto> => {
    const input = updateHolidaySchema.parse(raw)
    const holiday = await updateHoliday(prisma, { actor, input, ip: await ip() })
    revalidateCalendar()
    return holiday
  },
)

export const deleteHolidayAction = requirePermission(
  'calendar.manage',
  async (actor, raw: unknown): Promise<void> => {
    const { id } = holidayIdSchema.parse(raw)
    await deleteHoliday(prisma, { actor, id, ip: await ip() })
    revalidateCalendar()
  },
)

export const importHolidaysAction = requirePermission(
  'calendar.manage',
  async (actor, raw: unknown): Promise<HolidayImportResult> => {
    const input = importHolidaysSchema.parse(raw)
    const result = await importHolidays(prisma, { actor, input, ip: await ip() })
    if (!input.dryRun) revalidateCalendar()
    return result
  },
)
