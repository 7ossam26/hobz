import type { CairoDateKey } from '@/lib/calendar'

/**
 * DTOs crossing out of the module. `date` is a Cairo date key string, not a
 * `Date`: a holiday has no time of day, and handing a `Date` to a component
 * invites it to be rendered in whatever zone the renderer happens to be in.
 */

export interface HolidayDto {
  id: string
  date: CairoDateKey
  nameAr: string
  isRecurring: boolean
}

/** One rejected row from an import, with the reason a human can act on. */
export interface HolidayImportIssue {
  /** 1-based, so it matches what the operator sees in their spreadsheet. */
  row: number
  date: string
  reason: 'duplicate' | 'duplicateInFile' | 'invalidDate' | 'nameRequired'
}

export interface HolidayImportResult {
  dryRun: boolean
  /** Rows that would be (or were) inserted. */
  created: number
  /** Valid rows whose date is already a holiday — skipped, never overwritten. */
  skipped: number
  issues: HolidayImportIssue[]
}
