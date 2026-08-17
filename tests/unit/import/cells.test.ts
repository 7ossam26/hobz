import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import {
  cellBool,
  cellDateInput,
  cellEnumValue,
  cellNumber,
  cellOptionalText,
  cellText,
} from '@/modules/import/cells'
import type { ImportColumnDef } from '@/modules/import/columns'

function enumColumn(): ImportColumnDef {
  return {
    key: 'status',
    header: 'الحالة',
    hint: '',
    sample: '',
    required: false,
    kind: 'enum',
    options: ['نشط', 'معطّل'],
    optionValues: new Map([
      ['نشط', 'ACTIVE'],
      ['معطّل', 'INACTIVE'],
    ]),
  }
}

describe('modules/import/cells', () => {
  it('يحوّل قيمة الخلية إلى نص مقروء بغض النظر عن نوعها الخام', () => {
    expect(cellText('  أحمد  ')).toBe('أحمد')
    expect(cellText(40)).toBe('40')
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
    expect(cellText(new Date('2026-09-01T00:00:00.000Z'))).toBe(
      '2026-09-01T00:00:00.000Z',
    )
  })

  it('يعتبر الخلية الفارغة "غير موجودة" لا نصًا فارغًا', () => {
    expect(cellOptionalText('')).toBeNull()
    expect(cellOptionalText('  ')).toBeNull()
    expect(cellOptionalText('أحمد')).toBe('أحمد')
  })

  it('يحوّل "نعم"/"لا" إلى قيمة منطقية، وأي نص آخر إلى null', () => {
    expect(cellBool(ar.common.yes)).toBe(true)
    expect(cellBool(ar.common.no)).toBe(false)
    expect(cellBool('')).toBeNull()
    expect(cellBool('yes')).toBeNull()
  })

  it('يمرر كائن Date كما هو، ويترك النص لـ z.coerce.date()', () => {
    const date = new Date('2026-09-01T00:00:00.000Z')
    expect(cellDateInput(date)).toBe(date)
    expect(cellDateInput('2026-09-01')).toBe('2026-09-01')
    expect(cellDateInput('')).toBeNull()
  })

  it('يحوّل نص القائمة المنسدلة إلى القيمة المخزّنة عبر optionValues الخاص بالعمود', () => {
    const column = enumColumn()
    expect(cellEnumValue(column, 'نشط')).toBe('ACTIVE')
    expect(cellEnumValue(column, 'قيمة غير موجودة')).toBeNull()
    expect(cellEnumValue(column, '')).toBeNull()
  })

  it('يحوّل خلية رقمية إلى عدد، ويُبلغ عن فشل صريح لنص غير رقمي', () => {
    expect(cellNumber('')).toEqual({ ok: true, value: undefined })
    expect(cellNumber(40)).toEqual({ ok: true, value: 40 })
    expect(cellNumber('8.5')).toEqual({ ok: true, value: 8.5 })
    expect(cellNumber('abc')).toEqual({ ok: false })
  })
})
