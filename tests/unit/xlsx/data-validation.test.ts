import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { buildWorkbook, buildWorkbookAsync, readWorkbook } from '@/lib/xlsx'

/**
 * `buildWorkbookAsync` — the one addition Phase 11 made to `lib/xlsx.ts`:
 * in-cell dropdowns, which SheetJS's community edition parses but never
 * writes (`lib/xlsx.ts`'s own comment on `injectDataValidations`). These
 * tests prove the injected `<dataValidations>` XML is real and does not
 * break anything else SheetJS itself wrote.
 */
describe('lib/xlsx — buildWorkbookAsync (data-validation dropdowns)', () => {
  it('لا يغيّر شيئًا عن buildWorkbook حين لا يطلب أي عمود قائمة منسدلة', async () => {
    const sheets = [
      { name: 'ورقة', columns: [{ header: 'العمود', width: 10 }], rows: [['قيمة']] },
    ]
    const sync = buildWorkbook(sheets)
    const async_ = await buildWorkbookAsync(sheets)
    expect(async_.equals(sync)).toBe(true)
  })

  it('يضيف عنصر dataValidation حقيقيًا إلى XML الورقة لعمود يحمل validationList', async () => {
    const buffer = await buildWorkbookAsync([
      {
        name: 'بيانات',
        columns: [
          { header: 'الاسم', width: 20 },
          {
            header: 'الحالة',
            width: 14,
            validationList: ['نشط', 'معطّل', 'قيد المراجعة'],
          },
        ],
        rows: [['أحمد', 'نشط']],
      },
    ])

    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('xl/worksheets/sheet1.xml')?.async('string')
    expect(xml).toBeDefined()
    expect(xml).toContain('<dataValidations count="1">')
    expect(xml).toContain('sqref="B2:B1001"')
    expect(xml).toContain('<formula1>"نشط,معطّل,قيد المراجعة"</formula1>')
  })

  it('لا يفسد بقية الملف — يظل قابلاً للقراءة بـ SheetJS بعد الحقن', async () => {
    const buffer = await buildWorkbookAsync([
      {
        name: 'بيانات',
        columns: [
          { header: 'الاسم', width: 20 },
          { header: 'الحالة', width: 14, validationList: ['نشط', 'معطّل'] },
        ],
        rows: [
          ['أحمد', 'نشط'],
          ['سارة', 'معطّل'],
        ],
      },
    ])

    const workbook = readWorkbook(buffer)
    expect(workbook.SheetNames).toEqual(['بيانات'])
    const sheet = workbook.Sheets['بيانات']
    expect(sheet?.['A2']?.v).toBe('أحمد')
    expect(sheet?.['B3']?.v).toBe('معطّل')
  })

  it('يضيف عنصر dataValidation منفصلًا لكل عمود يطلبه، بعمود الحرف الصحيح', async () => {
    const buffer = await buildWorkbookAsync([
      {
        name: 'بيانات',
        columns: [
          { header: 'الاسم', width: 20 },
          { header: 'أ', width: 10, validationList: ['نعم', 'لا'] },
          { header: 'ب', width: 10, validationList: ['١', '٢'] },
        ],
        rows: [['أحمد', 'نعم', '١']],
      },
    ])

    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('xl/worksheets/sheet1.xml')?.async('string')
    expect(xml).toContain('<dataValidations count="2">')
    expect(xml).toContain('sqref="B2:B1001"')
    expect(xml).toContain('sqref="C2:C1001"')
  })
})
