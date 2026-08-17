import JSZip from 'jszip'
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
  /**
   * Excel "List" data validation — every data-row cell in this column is
   * constrained to one of these values, rendered as an in-cell dropdown.
   * Requires `buildWorkbookAsync` (below); `buildWorkbook` ignores it.
   */
  validationList?: readonly string[]
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
 * How many data rows a dropdown column stays enforced for. A template is
 * blank when downloaded, so this bounds "how far can someone paste/type
 * before the dropdown stops constraining them" rather than any real row
 * count — Import's own `MAX_IMPORT_ROWS` (`modules/import/parse.ts`) is the
 * actual cap enforced on upload.
 */
const VALIDATION_ROWS = 1000

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * SheetJS's community edition parses `dataValidation` on read but — unlike
 * every other feature this module uses — never writes it; that is a paid-tier
 * feature upstream. The dropdowns the Import templates need (Phase 11 phase
 * brief item 1) are real OOXML `<dataValidation>` elements instead, spliced
 * into each worksheet's XML directly inside the already-written `.xlsx` zip.
 * `dataValidations` is a documented, empty extension point in the writer's own
 * output (see the `/* dataValidations *\/` comment `write_ws_xml` leaves right
 * before `<hyperlinks>`/`<ignoredErrors>`), so this only adds a sibling
 * element in the slot the format reserves for it — nothing else in the
 * workbook changes.
 */
async function injectDataValidations(
  buffer: Buffer,
  sheets: readonly XlsxSheet[],
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)

  for (const [index, sheet] of sheets.entries()) {
    const columns = sheet.columns
      .map((column, colIndex) => ({ column, colIndex }))
      .filter(({ column }) => (column.validationList?.length ?? 0) > 0)
    if (columns.length === 0) continue

    const path = `xl/worksheets/sheet${index + 1}.xml`
    const file = zip.file(path)
    if (!file) continue // Defensive: sheet count always matches what SheetJS just wrote.

    const xml = await file.async('string')
    const elements = columns
      .map(({ column, colIndex }) => {
        const letter = XLSX.utils.encode_col(colIndex)
        const sqref = `${letter}2:${letter}${VALIDATION_ROWS + 1}`
        const formula = escapeXmlText((column.validationList ?? []).join(','))
        return (
          `<dataValidation type="list" allowBlank="1" showErrorMessage="1" ` +
          `errorStyle="stop" sqref="${sqref}"><formula1>"${formula}"</formula1></dataValidation>`
        )
      })
      .join('')
    const block = `<dataValidations count="${columns.length}">${elements}</dataValidations>`

    // Insertion point matches the CT_Worksheet element order the writer
    // already follows: right before `<ignoredErrors>` when present (the
    // writer emits one on every sheet unless explicitly disabled), else
    // right before the closing tag.
    const updated = xml.includes('<ignoredErrors')
      ? xml.replace('<ignoredErrors', `${block}<ignoredErrors`)
      : xml.replace('</worksheet>', `${block}</worksheet>`)
    zip.file(path, updated)
  }

  return zip.generateAsync({ type: 'nodebuffer' })
}

/**
 * `buildWorkbook`, plus in-cell dropdowns for any column carrying a
 * `validationList`. A separate, async entry point so every existing caller of
 * `buildWorkbook` (the Phase 10 reports, all synchronous) is untouched — only
 * `modules/import/template.ts` needs this one.
 */
export async function buildWorkbookAsync(sheets: readonly XlsxSheet[]): Promise<Buffer> {
  const buffer = buildWorkbook(sheets)
  const needsValidation = sheets.some((sheet) =>
    sheet.columns.some((column) => (column.validationList?.length ?? 0) > 0),
  )
  return needsValidation ? injectDataValidations(buffer, sheets) : buffer
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
