import { ar } from '@/i18n/ar'
import { buildWorkbookAsync } from '@/lib/xlsx'
import { importColumns } from '@/modules/import/columns'
import { IMPORT_TEMPLATE_VERSION } from '@/modules/import/parse'
import type { ImportEntity } from '@/modules/import/schema'

/**
 * Builds an `.xlsx` buffer shaped exactly like `modules/import/template.ts`'s
 * own output — same data-sheet name and headers, same meta sheet — so tests
 * exercise the real parser contract instead of a hand-rolled shortcut. Rows
 * are keyed by column `key` (`modules/import/columns.ts`), never by header
 * text, so a copy edit to a header string cannot silently break every test.
 */
export async function buildImportFixture(
  entity: ImportEntity,
  rows: ReadonlyArray<Record<string, string>>,
): Promise<Buffer> {
  const columns = await importColumns(entity)
  const dataRows = rows.map((row) => columns.map((column) => row[column.key] ?? ''))

  return buildWorkbookAsync([
    {
      name: ar.import.entities[entity],
      columns: columns.map((column) => ({ header: column.header, width: 20 })),
      rows: dataRows,
    },
    {
      name: ar.import.meta.sheetName,
      columns: [
        { header: ar.import.meta.field, width: 20 },
        { header: ar.import.meta.value, width: 20 },
      ],
      rows: [
        [ar.import.meta.entityRow, entity],
        [ar.import.meta.versionRow, String(IMPORT_TEMPLATE_VERSION)],
      ],
    },
  ])
}

/** A workbook with the right meta sheet but zero data rows — only the header. */
export async function buildEmptyImportFixture(entity: ImportEntity): Promise<Buffer> {
  return buildImportFixture(entity, [])
}

/** A workbook that is well-formed `.xlsx` but not an Import template at all. */
export async function buildForeignWorkbook(): Promise<Buffer> {
  return buildWorkbookAsync([
    { name: 'Sheet1', columns: [{ header: 'A', width: 10 }], rows: [['x']] },
  ])
}
