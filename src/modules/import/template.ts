import { ar } from '@/i18n/ar'
import { buildWorkbookAsync, type XlsxColumn } from '@/lib/xlsx'

import { importColumns } from './columns'
import { IMPORT_TEMPLATE_VERSION } from './parse'
import type { ImportEntity } from './schema'

/**
 * modules/import/template.ts — SPEC §10 / phase brief item 1: Arabic
 * headers, RTL sheet direction (from `lib/xlsx`, set once at the workbook
 * level), an instructions sheet, dropdowns for every enum column, and one
 * sample row.
 *
 * The third sheet is not documentation — `parse.ts` reads it back to refuse
 * a file that is not *this* template for *this* entity before looking at a
 * single data row (`import.errors.wrongTemplate`).
 */

export async function buildImportTemplateWorkbook(entity: ImportEntity): Promise<Buffer> {
  const columns = await importColumns(entity)

  const dataColumns: XlsxColumn[] = columns.map((column) => ({
    header: column.header,
    width: Math.max(column.header.length + 6, 18),
    ...(column.kind === 'enum' && column.options && column.options.length > 0
      ? { validationList: column.options }
      : {}),
  }))

  const t = ar.import.instructions
  const instructionsRows = columns.map((column) => [
    column.header,
    column.required ? t.requiredYes : t.requiredNo,
    column.hint,
  ])

  return buildWorkbookAsync([
    {
      name: ar.import.entities[entity],
      columns: dataColumns,
      rows: [columns.map((column) => column.sample)],
    },
    {
      name: t.sheetName,
      columns: [
        { header: t.column, width: 30 },
        { header: t.required, width: 10 },
        { header: t.explanation, width: 70 },
      ],
      rows: instructionsRows,
    },
    {
      name: ar.import.meta.sheetName,
      columns: [
        { header: ar.import.meta.field, width: 20 },
        { header: ar.import.meta.value, width: 30 },
      ],
      rows: [
        [ar.import.meta.entityRow, entity],
        [ar.import.meta.versionRow, String(IMPORT_TEMPLATE_VERSION)],
      ],
    },
  ])
}
