import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { buildWorkbookAsync } from '@/lib/xlsx'
import { importColumns } from '@/modules/import/columns'
import {
  IMPORT_TEMPLATE_VERSION,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  parseImportFile,
} from '@/modules/import/parse'

import { buildImportFixture } from '../../helpers/import-fixture'

/**
 * Pads a real, parseable `.xlsx` buffer out to an exact byte length by adding
 * a second, uncompressed (STORE) zip entry that neither `XLSX.read` nor the
 * meta-sheet reader ever look at — both resolve parts by name (`xl/workbook.xml`
 * and its relationships), so a loose extra file is invisible to them. STORE
 * means "byte in, byte out": the padding entry's on-disk size grows 1:1 with
 * its content, which is what lets this hit `targetBytes` exactly rather than
 * approximately — load the same base buffer twice, once to measure the fixed
 * per-entry overhead with zero-length padding, once to write the exact filler
 * length that closes the gap to `targetBytes`.
 */
async function padToExactSize(buffer: Buffer, targetBytes: number): Promise<Buffer> {
  const probe = await JSZip.loadAsync(buffer)
  probe.file('zzz_pad.bin', Buffer.alloc(0), { compression: 'STORE' })
  const overhead = (await probe.generateAsync({ type: 'nodebuffer' })).length
  const fillerLength = targetBytes - overhead
  if (fillerLength < 0) {
    throw new Error(`target ${targetBytes} is smaller than fixed overhead ${overhead}`)
  }

  const zip = await JSZip.loadAsync(buffer)
  zip.file('zzz_pad.bin', Buffer.alloc(fillerLength, 0x41), { compression: 'STORE' })
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('modules/import/parse — حدود الحجم وعدد الصفوف ورقم القالب', () => {
  it('يقبل ملفًا بحجمٍ يساوي الحد الأقصى المسموح به بالضبط', async () => {
    const columns = await importColumns('clients')
    const base = await buildImportFixture('clients', [
      { name: 'عميل عند حد الحجم', phone: '', notes: '' },
    ])
    const exact = await padToExactSize(base, MAX_IMPORT_FILE_BYTES)
    expect(exact.length).toBe(MAX_IMPORT_FILE_BYTES)

    const { rows } = parseImportFile('clients', exact, columns)
    expect(rows).toHaveLength(1)
  })

  it('يرفض ملفًا أكبر من الحد الأقصى المسموح به ببايت واحد فقط', async () => {
    const columns = await importColumns('clients')
    const base = await buildImportFixture('clients', [
      { name: 'عميل فوق حد الحجم', phone: '', notes: '' },
    ])
    const overByOne = await padToExactSize(base, MAX_IMPORT_FILE_BYTES + 1)
    expect(overByOne.length).toBe(MAX_IMPORT_FILE_BYTES + 1)

    expect(() => parseImportFile('clients', overByOne, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.fileTooLarge' }),
    )
  })

  it('يقبل ملفًا بعدد صفوف يساوي الحد الأقصى المسموح به بالضبط', async () => {
    const columns = await importColumns('clients')
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({
      name: `عميل ${i}`,
      phone: '',
      notes: '',
    }))
    const buffer = await buildImportFixture('clients', rows)

    const parsed = parseImportFile('clients', buffer, columns)
    expect(parsed.rows).toHaveLength(MAX_IMPORT_ROWS)
  })

  it('يرقّم الصف الوحيد في الملف بوصفه الصف رقم ٢، بعد صف الرأس مباشرة', async () => {
    const columns = await importColumns('clients')
    const buffer = await buildImportFixture('clients', [
      { name: 'الصف الوحيد', phone: '', notes: '' },
    ])

    const { rows } = parseImportFile('clients', buffer, columns)
    expect(rows).toEqual([
      { rowNumber: 2, cells: { name: 'الصف الوحيد', phone: '', notes: '' } },
    ])
  })

  it('يحافظ الصف الناجي على رقمه الأصلي في الجدول حين يتخلّله صف فارغ، دون إعادة ترقيم', async () => {
    const columns = await importColumns('clients')
    // Row 2 = "الأول", row 3 is fully blank (dropped by `parse.ts`), row 4 =
    // "الثالث". A naive implementation renumbers survivors 2..N *after*
    // dropping blanks, which would report "الثالث" as row 3 — the wrong line
    // for anyone opening the actual spreadsheet to fix it.
    const buffer = await buildImportFixture('clients', [
      { name: 'الأول', phone: '', notes: '' },
      { name: '', phone: '', notes: '' },
      { name: 'الثالث', phone: '', notes: '' },
    ])

    const { rows } = parseImportFile('clients', buffer, columns)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ rowNumber: 2 })
    expect(rows[0]?.cells.name).toBe('الأول')
    expect(rows[1]).toMatchObject({ rowNumber: 4 })
    expect(rows[1]?.cells.name).toBe('الثالث')
  })

  it('يرفض قالبًا برقم إصدار أكبر بواحد فقط من الإصدار الحالي', async () => {
    const columns = await importColumns('clients')
    const buffer = await buildWorkbookAsync([
      {
        name: ar.import.entities.clients,
        columns: columns.map((c) => ({ header: c.header, width: 20 })),
        rows: [['اسم', '', '']],
      },
      {
        name: ar.import.meta.sheetName,
        columns: [
          { header: ar.import.meta.field, width: 20 },
          { header: ar.import.meta.value, width: 20 },
        ],
        rows: [
          [ar.import.meta.entityRow, 'clients'],
          [ar.import.meta.versionRow, String(IMPORT_TEMPLATE_VERSION + 1)],
        ],
      },
    ])

    expect(() => parseImportFile('clients', buffer, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.wrongTemplate' }),
    )
  })

  it('يرفض قالبًا برقم إصدار أصغر بواحد فقط من الإصدار الحالي', async () => {
    const columns = await importColumns('clients')
    const buffer = await buildWorkbookAsync([
      {
        name: ar.import.entities.clients,
        columns: columns.map((c) => ({ header: c.header, width: 20 })),
        rows: [['اسم', '', '']],
      },
      {
        name: ar.import.meta.sheetName,
        columns: [
          { header: ar.import.meta.field, width: 20 },
          { header: ar.import.meta.value, width: 20 },
        ],
        rows: [
          [ar.import.meta.entityRow, 'clients'],
          [ar.import.meta.versionRow, String(IMPORT_TEMPLATE_VERSION - 1)],
        ],
      },
    ])

    expect(() => parseImportFile('clients', buffer, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.wrongTemplate' }),
    )
  })
})
