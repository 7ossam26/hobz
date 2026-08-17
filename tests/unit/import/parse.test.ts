import { describe, expect, it } from 'vitest'

import { DomainError } from '@/lib/errors'
import { importColumns } from '@/modules/import/columns'
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  parseImportFile,
} from '@/modules/import/parse'

import {
  buildEmptyImportFixture,
  buildForeignWorkbook,
  buildImportFixture,
} from '../../helpers/import-fixture'

describe('modules/import/parse — شكل الملف قبل أي منطق خاص بكيان بعينه', () => {
  it('يقرأ صفوف البيانات مفتاحة بمفتاح العمود، بدءًا من رقم الصف ٢', async () => {
    const columns = await importColumns('clients')
    const buffer = await buildImportFixture('clients', [
      { name: 'شركة النخبة', phone: '01012345678', notes: 'عميل مميز' },
      { name: 'شركة أخرى', phone: '', notes: '' },
    ])

    const { rows } = parseImportFile('clients', buffer, columns)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      cells: { name: 'شركة النخبة', phone: '01012345678', notes: 'عميل مميز' },
    })
    expect(rows[1]).toMatchObject({ rowNumber: 3, cells: { name: 'شركة أخرى' } })
  })

  it('يتجاهل الصفوف الفارغة تمامًا ولا يحسبها ضمن صفوف البيانات', async () => {
    const columns = await importColumns('clients')
    const buffer = await buildImportFixture('clients', [
      { name: 'عميل واحد', phone: '', notes: '' },
      { name: '', phone: '', notes: '' },
    ])

    const { rows } = parseImportFile('clients', buffer, columns)
    expect(rows).toHaveLength(1)
  })

  it('يحافظ على النص العربي دون أي تشويه عبر جولة كتابة وقراءة كاملة', async () => {
    const columns = await importColumns('clients')
    const arabic = 'شركة الأهرام للمقاولات والتوريدات العامة — فرع القاهرة'
    const buffer = await buildImportFixture('clients', [
      { name: arabic, phone: '', notes: 'ملاحظة بالعربية: يُفضَّل التواصل صباحًا' },
    ])

    const { rows } = parseImportFile('clients', buffer, columns)
    expect(rows[0]?.cells.name).toBe(arabic)
    expect(rows[0]?.cells.notes).toBe('ملاحظة بالعربية: يُفضَّل التواصل صباحًا')
  })

  it('يرفض ملفًا فارغًا تمامًا (بايت صفر) بخطأ "ملف غير صالح"', async () => {
    const columns = await importColumns('clients')
    expect(() => parseImportFile('clients', Buffer.alloc(0), columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.invalidFile' }),
    )
  })

  it('يرفض ملفًا أكبر من الحد المسموح بحجمه', async () => {
    const columns = await importColumns('clients')
    const oversized = Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1, 1)
    expect(() => parseImportFile('clients', oversized, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.fileTooLarge' }),
    )
  })

  it('يرفض ملفًا لا يحتوي على أي صف بيانات (رأس فقط)', async () => {
    const columns = await importColumns('clients')
    const buffer = await buildEmptyImportFixture('clients')
    expect(() => parseImportFile('clients', buffer, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.emptyFile' }),
    )
  })

  it('يرفض ملفًا بعدد صفوف أكبر من الحد المسموح', async () => {
    const columns = await importColumns('clients')
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({
      name: `عميل ${i}`,
      phone: '',
      notes: '',
    }))
    const buffer = await buildImportFixture('clients', rows)
    expect(() => parseImportFile('clients', buffer, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.tooManyRows' }),
    )
  })

  it('يرفض ملف xlsx حقيقيًا لا يطابق أي قالب استيراد (لا توجد ورقة معلومات القالب)', async () => {
    const columns = await importColumns('clients')
    const buffer = await buildForeignWorkbook()
    expect(() => parseImportFile('clients', buffer, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.wrongTemplate' }),
    )
  })

  it('يرفض قالبًا صحيحًا لكن لكيان آخر', async () => {
    const columns = await importColumns('clients')
    const buffer = await buildImportFixture('users', [
      { username: 'ahmed', fullName: 'أحمد', password: 'Passw0rd123' },
    ])
    expect(() => parseImportFile('clients', buffer, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.wrongTemplate' }),
    )
  })

  it('يرفض قالبًا يحمل رقم إصدار مختلفًا', async () => {
    const columns = await importColumns('clients')
    const { buildWorkbookAsync } = await import('@/lib/xlsx')
    const { ar: arabic } = await import('@/i18n/ar')

    const buffer = await buildWorkbookAsync([
      {
        name: arabic.import.entities.clients,
        columns: columns.map((c) => ({ header: c.header, width: 20 })),
        rows: [['اسم', '', '']],
      },
      {
        name: arabic.import.meta.sheetName,
        columns: [
          { header: arabic.import.meta.field, width: 20 },
          { header: arabic.import.meta.value, width: 20 },
        ],
        rows: [
          [arabic.import.meta.entityRow, 'clients'],
          [arabic.import.meta.versionRow, '999'],
        ],
      },
    ])

    expect(() => parseImportFile('clients', buffer, columns)).toThrowError(
      expect.objectContaining({ messageKey: 'import.errors.wrongTemplate' }),
    )
  })

  it('يُصنَّف الخطأ دومًا كـ DomainError، لا استثناءً عامًّا', async () => {
    const columns = await importColumns('clients')
    try {
      parseImportFile('clients', Buffer.alloc(0), columns)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError)
    }
  })
})
