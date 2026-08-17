import * as XLSX from 'xlsx'

import { ar } from '@/i18n/ar'
import { DomainError } from '@/lib/errors'
import { readWorkbook } from '@/lib/xlsx'

import type { ImportColumnDef } from './columns'
import type { ImportEntity } from './schema'

/**
 * modules/import/parse.ts — buffer in, per-row raw cells out. Never touches
 * the database and never interprets a column's *meaning* (that is
 * `service.ts`'s job, per entity) — only the workbook's shape: is this our
 * template, for this entity, and within the safety bounds below.
 *
 * `MAX_IMPORT_FILE_BYTES`/`MAX_IMPORT_ROWS` are plain constants, not Settings
 * (CLAUDE.md invariant 4 is about *business* numbers — grace periods, penalty
 * rates, cycle days. A parser safety bound is the same kind of thing
 * `lib/auth/username.ts`'s `USERNAME_MAX_LENGTH` already is: a technical
 * guard nobody tunes per agency, not a number the product's arithmetic
 * depends on).
 */

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 500
export const IMPORT_TEMPLATE_VERSION = 1

export interface ParsedImportRow {
  /** 1-based, counting the header row as row 1 — what a spreadsheet user sees. */
  rowNumber: number
  cells: Record<string, unknown>
}

export interface ParsedImportFile {
  rows: ParsedImportRow[]
}

function readAoa(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

function assertTemplateMeta(entity: ImportEntity, workbook: XLSX.WorkBook): void {
  const metaSheet = workbook.Sheets[ar.import.meta.sheetName]
  if (!metaSheet) throw new DomainError('import.errors.wrongTemplate')

  const aoa = readAoa(metaSheet)
  const entityValue = cellText(aoa[1]?.[1])
  const versionValue = cellText(aoa[2]?.[1])

  if (entityValue !== entity || versionValue !== String(IMPORT_TEMPLATE_VERSION)) {
    throw new DomainError('import.errors.wrongTemplate')
  }
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => cellText(cell) === '')
}

/**
 * Reads the uploaded workbook and returns every non-blank data row, keyed by
 * column `key` (never by Arabic header text past this point). Throws a
 * `DomainError` naming the exact `import.errors.*` problem — file too big,
 * too many rows, not this template, no data — so the action layer never has
 * to guess why a preview came back empty.
 */
export function parseImportFile(
  entity: ImportEntity,
  buffer: Buffer,
  columns: readonly ImportColumnDef[],
): ParsedImportFile {
  if (buffer.length === 0) throw new DomainError('import.errors.invalidFile')
  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    throw new DomainError('import.errors.fileTooLarge', {
      maxMb: Math.floor(MAX_IMPORT_FILE_BYTES / (1024 * 1024)),
    })
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = readWorkbook(buffer)
  } catch {
    throw new DomainError('import.errors.invalidFile')
  }
  if (workbook.SheetNames.length === 0) throw new DomainError('import.errors.invalidFile')

  assertTemplateMeta(entity, workbook)

  const dataSheetName = ar.import.entities[entity]
  const sheet = workbook.Sheets[dataSheetName]
  if (!sheet) throw new DomainError('import.errors.wrongTemplate')

  const aoa = readAoa(sheet)
  if (aoa.length === 0) throw new DomainError('import.errors.emptyFile')

  const headerRow = (aoa[0] ?? []).map((cell) => cellText(cell))
  const headersPresent = columns.every((column) => headerRow.includes(column.header))
  if (!headersPresent) throw new DomainError('import.errors.wrongTemplate')

  // Row 1 is the header, so the first data row is row 2 — the number the
  // person filling the sheet actually sees in Excel's row gutter. The row
  // number is assigned from this original position *before* blank rows are
  // filtered out below, so a blank row interspersed between two real rows
  // cannot shift a later row's reported number — a discrepancy would send
  // someone fixing "row 7" to the wrong line in their own spreadsheet.
  const dataRows = aoa
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => !isBlankRow(row))
  if (dataRows.length === 0) throw new DomainError('import.errors.emptyFile')
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new DomainError('import.errors.tooManyRows', { max: MAX_IMPORT_ROWS })
  }

  const rows = dataRows.map(({ row, rowNumber }) => {
    const cells: Record<string, unknown> = {}
    for (const column of columns) {
      const colIndex = headerRow.indexOf(column.header)
      cells[column.key] = colIndex === -1 ? '' : row[colIndex]
    }
    return { rowNumber, cells }
  })

  return { rows }
}
