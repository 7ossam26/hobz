import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { format, round2 } from '@/lib/money'
import {
  formatMoney,
  isDisplayNegative,
  isDisplayZero,
  moneySign,
  toFixedMoneyString,
} from '@/lib/money-format'

/**
 * `lib/money-format` is the display half of `lib/money`, split out so decimal.js
 * stays out of the browser bundle (SPEC §9). The split is only safe if the two
 * agree on every value, so most of what is asserted here is that agreement —
 * plus the string-rounding path, which is the one piece of arithmetic-shaped
 * code the split introduced and therefore the one place a new bug could live.
 */

describe('lib/money-format — التقريب إلى منزلتين', () => {
  it('يقرّب النص لأعلى عند النصف تمامًا', () => {
    expect(toFixedMoneyString('2.345')).toBe('2.35')
    expect(toFixedMoneyString('2.344')).toBe('2.34')
    expect(toFixedMoneyString('0.005')).toBe('0.01')
  })

  it('يقرّب السالب بعيدًا عن الصفر، كما يفعل round2', () => {
    expect(toFixedMoneyString('-2.345')).toBe('-2.35')
    expect(round2('-2.345').toFixed(2)).toBe('-2.35')
  })

  it('ينقل الحمل عبر الجزء الصحيح كاملًا', () => {
    expect(toFixedMoneyString('9.999')).toBe('10.00')
    expect(toFixedMoneyString('99.999')).toBe('100.00')
    expect(toFixedMoneyString('9999999999.994')).toBe('9999999999.99')
    expect(toFixedMoneyString('0.999')).toBe('1.00')
  })

  it('يكمّل الكسر الناقص بأصفار', () => {
    expect(toFixedMoneyString('5')).toBe('5.00')
    expect(toFixedMoneyString('5.1')).toBe('5.10')
    expect(toFixedMoneyString('5.')).toBe('5.00')
  })

  it('يقبل علامة الموجب الصريحة والمسافات المحيطة', () => {
    expect(toFixedMoneyString(' +12.5 ')).toBe('12.50')
    expect(toFixedMoneyString(' -12.5 ')).toBe('-12.50')
  })

  it('لا يُبقي أصفارًا بادئة', () => {
    expect(toFixedMoneyString('007.5')).toBe('7.50')
    expect(toFixedMoneyString('000')).toBe('0.00')
  })

  it('يمرّر Decimal عبر تقريبه الخاص', () => {
    expect(toFixedMoneyString(new Decimal('2.345'))).toBe('2.35')
    expect(toFixedMoneyString(new Decimal('-0.001'))).toBe('-0.00')
  })

  it('يرفض القيم غير المنتهية بدل عرضها', () => {
    expect(() => toFixedMoneyString(Number.NaN)).toThrow(RangeError)
    expect(() => toFixedMoneyString(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => toFixedMoneyString('غير رقم')).toThrow(RangeError)
  })

  it('يتعامل مع الصيغة الأسية بدل أن يفشل', () => {
    expect(toFixedMoneyString('1e2')).toBe('100.00')
  })
})

describe('lib/money-format — الإشارة', () => {
  it('يعتبر الصفر السالب صفرًا', () => {
    expect(moneySign('-0.00')).toBe(0)
    expect(moneySign('-0.001')).toBe(0)
    expect(moneySign(new Decimal('-0.004'))).toBe(0)
    expect(isDisplayZero('-0.00')).toBe(true)
    expect(isDisplayNegative('-0.00')).toBe(false)
  })

  it('يميّز الخصم عن الاستحقاق', () => {
    expect(moneySign('-0.01')).toBe(-1)
    expect(moneySign('0.01')).toBe(1)
    expect(isDisplayNegative('-1250.00')).toBe(true)
    expect(isDisplayNegative('1250.00')).toBe(false)
  })
})

describe('lib/money-format — تطابق مع lib/money', () => {
  const samples = [
    '0',
    '0.00',
    '-0.004',
    '1234.5',
    '-99.05',
    '2.345',
    '2.344',
    '1000000',
    '9999999999.99',
    '-9999999999.99',
    '0.005',
    '9.999',
  ]

  for (const sample of samples) {
    it(`يعرض ${sample} كما يعرضه lib/money`, () => {
      expect(formatMoney(sample)).toBe(format(sample))
      expect(formatMoney(sample, { withCurrency: true })).toBe(
        format(sample, { withCurrency: true }),
      )
      expect(formatMoney(sample, { signDisplay: true })).toBe(
        format(sample, { signDisplay: true }),
      )
    })
  }

  it('يعطي النص والـ Decimal والرقم نفس الناتج للقيمة نفسها', () => {
    expect(formatMoney('1234.50')).toBe(formatMoney(1234.5))
    expect(formatMoney('1234.50')).toBe(formatMoney(new Decimal('1234.5')))
  })

  it('يحافظ على الأرقام اللاتينية ولا يترك علامات ثنائية الاتجاه', () => {
    const output = formatMoney('-1234.5', { withCurrency: true })
    expect(output).toMatch(/[0-9]/)
    expect(output).not.toMatch(/[٠-٩]/)
    expect(output).not.toMatch(/[‎‏‪-‮؜⁦-⁩]/)
  })
})
