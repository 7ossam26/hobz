import { recordAudit } from '@/lib/audit'
import {
  dateColumnValue,
  expandHolidayRows,
  isCairoDateKey,
  type CairoDateKey,
} from '@/lib/calendar'
import type { Db } from '@/lib/db'
import { ConflictError, NotFoundError } from '@/lib/errors'
import type { Actor } from '@/lib/rbac'

import type {
  CreateHolidayInput,
  ImportHolidaysInput,
  ListHolidaysInput,
  UpdateHolidayInput,
} from './schema'
import type { HolidayDto, HolidayImportIssue, HolidayImportResult } from './types'

/**
 * modules/holiday/service.ts — the agency's days off (SPEC §4 Calendar).
 *
 * Pure functions, dependency-injected Prisma client, no `next/*` import
 * (CLAUDE.md architecture rules). Every mutation writes an `AuditLog` row:
 * adding a holiday changes what every worker's lateness is measured against,
 * which puts it squarely inside invariant 7's "touches money".
 *
 * ── Coverage, not equality, is what makes a duplicate ─────────────────────
 *
 * The unique index on `holidays.date` catches two rows with the same date. It
 * cannot catch the case that actually happens: a recurring 7 January already
 * exists, and somebody adds a one-off "عيد الميلاد المجيد 2027" on
 * 2027-01-07. Both rows are legal to the database, both describe the same day
 * off, and one of them is a mistake. So the check here asks the calendar's own
 * question — *is this day already a holiday?* — with recurrence expanded.
 */

const HOLIDAY_SELECT = {
  id: true,
  date: true,
  nameAr: true,
  isRecurring: true,
} as const

interface HolidayRow {
  id: string
  date: Date
  nameAr: string
  isRecurring: boolean
}

/** `@db.Date` comes back as UTC midnight — the key is the UTC date, unconverted. */
function toDto(row: HolidayRow): HolidayDto {
  return {
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    nameAr: row.nameAr,
    isRecurring: row.isRecurring,
  }
}

export async function listHolidays(
  db: Db,
  input: ListHolidaysInput = {},
): Promise<HolidayDto[]> {
  const rows = await db.holiday.findMany({
    where:
      input.year === undefined
        ? {}
        : {
            OR: [
              {
                isRecurring: false,
                date: {
                  gte: dateColumnValue(`${input.year}-01-01`),
                  lte: dateColumnValue(`${input.year}-12-31`),
                },
              },
              // A recurring row belongs to every year, whatever year it is
              // stored under.
              { isRecurring: true },
            ],
          },
    select: HOLIDAY_SELECT,
    orderBy: { date: 'asc' },
  })

  return rows.map(toDto)
}

/**
 * The Cairo date keys that are holidays in one year — recurrence expanded.
 * This is what a calendar UI paints, as opposed to the rows a settings screen
 * edits.
 */
export async function holidayKeysForYear(db: Db, year: number): Promise<CairoDateKey[]> {
  const rows = await db.holiday.findMany({
    where: {
      OR: [
        {
          isRecurring: false,
          date: {
            gte: dateColumnValue(`${year}-01-01`),
            lte: dateColumnValue(`${year}-12-31`),
          },
        },
        { isRecurring: true },
      ],
    },
    select: { date: true, isRecurring: true },
  })

  return [...expandHolidayRows(rows, `${year}-01-01`, `${year}-12-31`)].sort()
}

/**
 * Is this Cairo date already covered by a holiday? `excludeId` lets an edit
 * ignore the row it is editing.
 */
export async function isHolidayCovered(
  db: Db,
  key: CairoDateKey,
  excludeId?: string,
): Promise<boolean> {
  const rows = await db.holiday.findMany({
    where: {
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      OR: [{ isRecurring: false, date: dateColumnValue(key) }, { isRecurring: true }],
    },
    select: { date: true, isRecurring: true },
  })

  return expandHolidayRows(rows, key, key).has(key)
}

export interface HolidayMutationArgs {
  actor: Actor
  ip?: string | undefined
}

export async function createHoliday(
  db: Db,
  args: HolidayMutationArgs & { input: CreateHolidayInput },
): Promise<HolidayDto> {
  const { input } = args

  if (await isHolidayCovered(db, input.date)) {
    throw new ConflictError('holidays.errors.duplicate', { date: input.date })
  }

  const row = await db.holiday.create({
    data: {
      date: dateColumnValue(input.date),
      nameAr: input.nameAr,
      isRecurring: input.isRecurring,
    },
    select: HOLIDAY_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'holiday.created',
    entity: 'Holiday',
    entityId: row.id,
    after: { date: input.date, nameAr: input.nameAr, isRecurring: input.isRecurring },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toDto(row)
}

export async function updateHoliday(
  db: Db,
  args: HolidayMutationArgs & { input: UpdateHolidayInput },
): Promise<HolidayDto> {
  const { input } = args

  const before = await db.holiday.findUnique({
    where: { id: input.id },
    select: HOLIDAY_SELECT,
  })
  if (!before) throw new NotFoundError('Holiday', input.id)

  if (await isHolidayCovered(db, input.date, input.id)) {
    throw new ConflictError('holidays.errors.duplicate', { date: input.date })
  }

  const row = await db.holiday.update({
    where: { id: input.id },
    data: {
      date: dateColumnValue(input.date),
      nameAr: input.nameAr,
      isRecurring: input.isRecurring,
    },
    select: HOLIDAY_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'holiday.updated',
    entity: 'Holiday',
    entityId: row.id,
    before: toDto(before),
    after: { date: input.date, nameAr: input.nameAr, isRecurring: input.isRecurring },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toDto(row)
}

/**
 * A real `DELETE`, not a soft one — matching `Milestone` and the SPEC §4
 * listing, which gives `Holiday` no `deletedAt`. A soft-deleted holiday that
 * one query forgot to filter would keep being a day off, which is the failure
 * soft-delete exists to prevent, inverted.
 */
export async function deleteHoliday(
  db: Db,
  args: HolidayMutationArgs & { id: string },
): Promise<void> {
  const before = await db.holiday.findUnique({
    where: { id: args.id },
    select: HOLIDAY_SELECT,
  })
  if (!before) throw new NotFoundError('Holiday', args.id)

  await db.holiday.delete({ where: { id: args.id } })

  await recordAudit(db, {
    actor: args.actor,
    action: 'holiday.deleted',
    entity: 'Holiday',
    entityId: args.id,
    before: toDto(before),
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

/**
 * Bulk entry, with SPEC §10's dry-run-then-confirm shape.
 *
 * Nothing is written when `dryRun` is true, and an already-covered date is
 * **skipped rather than overwritten** — an import must never silently rename
 * or move a day off somebody's lateness has already been measured against.
 */
export async function importHolidays(
  db: Db,
  args: HolidayMutationArgs & { input: ImportHolidaysInput },
): Promise<HolidayImportResult> {
  const { input } = args

  const issues: HolidayImportIssue[] = []
  const accepted: CreateHolidayInput[] = []
  const seen = new Set<string>()
  let skipped = 0

  for (const [index, row] of input.rows.entries()) {
    const at = index + 1

    if (!isCairoDateKey(row.date)) {
      issues.push({ row: at, date: row.date, reason: 'invalidDate' })
      continue
    }
    if (row.nameAr.trim().length === 0) {
      issues.push({ row: at, date: row.date, reason: 'nameRequired' })
      continue
    }
    // Two rows in the same file claiming the same day. Reported rather than
    // deduplicated: the operator has a typo somewhere and should see it.
    if (seen.has(row.date)) {
      issues.push({ row: at, date: row.date, reason: 'duplicateInFile' })
      continue
    }
    seen.add(row.date)

    if (await isHolidayCovered(db, row.date)) {
      skipped += 1
      continue
    }

    accepted.push(row)
  }

  const result: HolidayImportResult = {
    dryRun: input.dryRun,
    created: accepted.length,
    skipped,
    issues,
  }

  if (input.dryRun || accepted.length === 0) return result

  await db.holiday.createMany({
    data: accepted.map((row) => ({
      date: dateColumnValue(row.date),
      nameAr: row.nameAr,
      isRecurring: row.isRecurring,
    })),
    // Belt and braces against a concurrent insert between the coverage check
    // above and this write; the count reported stays the intended one.
    skipDuplicates: true,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'holiday.imported',
    entity: 'Holiday',
    entityId: 'import',
    after: { created: accepted.length, skipped, invalid: issues.length },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return result
}
