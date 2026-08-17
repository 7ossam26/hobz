import * as XLSX from 'xlsx'

import { ar } from '@/i18n/ar'

/**
 * lib/xlsx — the one place an `.xlsx` buffer is assembled (Phase 10 phase
 * brief: "all exportable to .xlsx (Arabic headers, RTL sheet direction,
 * Western numerals, correct column widths)"; Phase 11 will reuse it for
 * template generation, per CLAUDE.md invariant 9 — `.xlsx` is the only file
 * input/output this product has, in memory only, never persisted).
 *
 * ── Western numerals, without a locale fight ──────────────────────────────
 *
 * A money or count column is written as a real numeric cell with an explicit
 * `numberFormat`, never as a pre-formatted Arabic string. Excel's standard
 * number-format codes (`#,##0.00`) render Western digits regardless of the
 * workbook's display language — only the small set of calendar/numbering
 * format codes Excel reserves for Arabic locales would switch the glyphs, and
 * this module never emits one. Text columns (names, notes) are passed through
 * as-is; Arabic prose has no numeral question to answer.
 *
 * ── RTL sheet direction ────────────────────────────────────────────────────
 *
 * Set once, at the workbook level (`Workbook.Views[0].RTL`), which is what
 * Excel's own "Sheet Right-to-Left" toggle writes: column A renders on the
 * right and the grid reads right-to-left, matching how every screen this data
 * came from already reads.
 */

export type XlsxCellValue = string | number | null

export interface XlsxColumn {
  /** Arabic column header. */
  header: string
  /** Character width — Excel's own column-width unit (`!cols[].wch`). */
  width: number
  /** Excel number-format code. Omit for a text column. */
  numberFormat?: string
}

export interface XlsxSheet {
  /** Arabic sheet name. Excel forbids `: \ / ? * [ ]` and caps length at 31. */
  name: string
  columns: readonly XlsxColumn[]
  rows: ReadonlyArray<readonly XlsxCellValue[]>
}

export const MONEY_FORMAT = '#,##0.00'
export const INTEGER_FORMAT = '#,##0'
export const PERCENT_FORMAT = '0.0"%"'

const MAX_SHEET_NAME_LENGTH = 31
const FORBIDDEN_SHEET_NAME_CHARS = /[:\\/?*[\]]/g

/** Excel-legal sheet name: no reserved characters, no more than 31 characters. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(FORBIDDEN_SHEET_NAME_CHARS, ' ').trim()
  return (cleaned || ar.reports.defaultSheetName).slice(0, MAX_SHEET_NAME_LENGTH)
}

/**
 * Build a `.xlsx` file in memory. Never touches disk — the whole result lives
 * in the returned buffer, for a caller to stream straight into an HTTP
 * response.
 */
export function buildWorkbook(sheets: readonly XlsxSheet[]): Buffer {
  const workbook = XLSX.utils.book_new()
  workbook.Workbook = { Views: [{ RTL: true }] }

  for (const sheet of sheets) {
    const header = sheet.columns.map((column) => column.header)
    const data: XlsxCellValue[][] = [header, ...sheet.rows.map((row) => [...row])]
    const worksheet = XLSX.utils.aoa_to_sheet<XlsxCellValue>(data)
    worksheet['!cols'] = sheet.columns.map((column) => ({ wch: column.width }))

    sheet.columns.forEach((column, colIndex) => {
      if (!column.numberFormat) return
      for (let rowIndex = 1; rowIndex <= sheet.rows.length; rowIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
        const cell = worksheet[address]
        if (cell && cell.t === 'n') cell.z = column.numberFormat
      }
    })

    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheet.name))
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/**
 * Read a workbook back — used only by the export round-trip tests.
 * `cellStyles` is what makes SheetJS parse `!cols` and each cell's `.z`
 * number format back out; without it a fast, style-blind read is the
 * (undocumented, empirically-checked) default, and every assertion this
 * module's own tests make about width or format would silently pass on
 * `undefined`.
 */
export function readWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: 'buffer', cellDates: true, cellStyles: true })
}
