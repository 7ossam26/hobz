import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { buildWorkbook, MONEY_FORMAT, readWorkbook, safeSheetName } from '@/lib/xlsx'

/**
 * lib/xlsx — phase brief item 5: "Arabic headers, RTL sheet direction,
 * Western numerals, correct column widths". docs/TESTING.md §4 axis 10
 * (Arabic — round-trip, no mojibake).
 */

const ARABIC_HEADER = 'اسم المنفّذ'
const ARABIC_NAME = 'محمد عبد الرحمن'

describe('buildWorkbook — الاتجاه من اليمين لليسار', () => {
  it('يضبط اتجاه الملف بالكامل من اليمين لليسار', () => {
    const buffer = buildWorkbook([
      { name: 'ورقة', columns: [{ header: ARABIC_HEADER, width: 20 }], rows: [[ARABIC_NAME]] },
    ])
    const workbook = readWorkbook(buffer)
    expect(workbook.Workbook?.Views?.[0]?.RTL).toBe(true)
  })
})

describe('buildWorkbook — جولة كاملة للنص العربي بلا تشويه', () => {
  it('يحافظ على النص العربي حرفيًا بعد الكتابة والقراءة', () => {
    const buffer = buildWorkbook([
      { name: 'كشف', columns: [{ header: ARABIC_HEADER, width: 20 }], rows: [[ARABIC_NAME]] },
    ])
    const workbook = readWorkbook(buffer)
    const sheet = workbook.Sheets[workbook.SheetNames[0] as string]
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet as XLSX.WorkSheet, { header: 1 })

    expect(rows[0]).toEqual([ARABIC_HEADER])
    expect(rows[1]).toEqual([ARABIC_NAME])
  })

  it('يحافظ على اسم الورقة العربي', () => {
    const buffer = buildWorkbook([
      { name: 'كشف المستحقات', columns: [{ header: 'عمود', width: 10 }], rows: [] },
    ])
    const workbook = readWorkbook(buffer)
    expect(workbook.SheetNames).toEqual(['كشف المستحقات'])
  })
})

describe('buildWorkbook — الأرقام والعمود التنسيقي', () => {
  it('يكتب القيمة الرقمية كخلية رقم قابلة للتنسيق، لا نصًا', () => {
    const buffer = buildWorkbook([
      {
        name: 'ورقة',
        columns: [
          { header: 'الاسم', width: 10 },
          { header: 'الصافي', width: 10, numberFormat: MONEY_FORMAT },
        ],
        rows: [[ARABIC_NAME, 1234.5]],
      },
    ])
    const workbook = readWorkbook(buffer)
    const sheet = workbook.Sheets[workbook.SheetNames[0] as string] as XLSX.WorkSheet
    const cell = sheet['B2']

    expect(cell?.t).toBe('n')
    expect(cell?.v).toBe(1234.5)
    expect(cell?.z).toBe(MONEY_FORMAT)
  })

  it('لا يطبّق تنسيقًا رقميًا مخصَّصًا على عمود بلا numberFormat', () => {
    const buffer = buildWorkbook([
      { name: 'ورقة', columns: [{ header: 'اسم', width: 10 }], rows: [[ARABIC_NAME]] },
    ])
    const workbook = readWorkbook(buffer)
    const sheet = workbook.Sheets[workbook.SheetNames[0] as string] as XLSX.WorkSheet
    // Excel's own implicit default, not `undefined` — every cell round-trips
    // with *some* format code once `cellStyles` is on; the assertion that
    // matters is that it is never `MONEY_FORMAT` or another custom code.
    expect(sheet['A2']?.z).toBe('General')
  })

  it('عمود فارغ من الصفوف لا يكسر التنسيق', () => {
    const buffer = buildWorkbook([
      {
        name: 'ورقة',
        columns: [{ header: 'الصافي', width: 10, numberFormat: MONEY_FORMAT }],
        rows: [],
      },
    ])
    expect(() => readWorkbook(buffer)).not.toThrow()
  })
})

describe('buildWorkbook — عرض الأعمدة', () => {
  it('يضبط عرض كل عمود كما طُلب', () => {
    const buffer = buildWorkbook([
      {
        name: 'ورقة',
        columns: [
          { header: 'أ', width: 12 },
          { header: 'ب', width: 30 },
        ],
        rows: [['x', 'y']],
      },
    ])
    const workbook = readWorkbook(buffer)
    const sheet = workbook.Sheets[workbook.SheetNames[0] as string] as XLSX.WorkSheet
    expect(sheet['!cols']?.[0]?.wch).toBe(12)
    expect(sheet['!cols']?.[1]?.wch).toBe(30)
  })
})

describe('safeSheetName — قيود أسماء الأوراق في إكسل', () => {
  it('يقتطع الاسم عند ٣١ حرفًا', () => {
    const long = 'س'.repeat(50)
    expect(safeSheetName(long).length).toBe(31)
  })

  it('يستبدل الأحرف المحظورة بمسافة', () => {
    expect(safeSheetName('تقرير:يناير/فبراير')).not.toMatch(/[:/]/)
  })

  it('اسم فارغ بعد التنظيف يحصل على قيمة افتراضية', () => {
    expect(safeSheetName('///')).toBe('ورقة')
  })
})

describe('buildWorkbook — أوراق متعددة', () => {
  it('يكتب كل الأوراق المطلوبة بالترتيب', () => {
    const buffer = buildWorkbook([
      { name: 'الأولى', columns: [{ header: 'ع', width: 10 }], rows: [] },
      { name: 'الثانية', columns: [{ header: 'ع', width: 10 }], rows: [] },
    ])
    const workbook = readWorkbook(buffer)
    expect(workbook.SheetNames).toEqual(['الأولى', 'الثانية'])
  })
})
