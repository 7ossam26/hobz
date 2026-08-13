import { describe, expect, it } from 'vitest'

import {
  Decimal,
  MONEY_MAX,
  MONEY_MIN,
  abs,
  add,
  clampAtZero,
  compare,
  div,
  eq,
  fitsColumn,
  format,
  gt,
  gte,
  isNegative,
  isPositive,
  isZero,
  lt,
  lte,
  max,
  min,
  mul,
  negate,
  pct,
  round2,
  sub,
  sum,
  toMoney,
  toStorageString,
  zero,
} from '@/lib/money'

describe('lib/money — التحويل والتحقق', () => {
  it('يقبل النص والرقم وكائن Decimal', () => {
    expect(toMoney('12.34').toString()).toBe('12.34')
    expect(toMoney(12.34).toString()).toBe('12.34')
    expect(toMoney(new Decimal('12.34')).toString()).toBe('12.34')
  })

  it('يرفض القيم غير المحدودة بدل تمريرها إلى دفتر الحسابات', () => {
    expect(() => toMoney(Number.NaN)).toThrow(RangeError)
    expect(() => toMoney(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => toMoney(Number.NEGATIVE_INFINITY)).toThrow(RangeError)
    expect(() => toMoney(new Decimal(Number.NaN))).toThrow(RangeError)
    expect(() => toMoney('abc')).toThrow()
  })

  it('يبدأ الرصيد من صفر', () => {
    expect(zero().toString()).toBe('0')
    expect(isZero(zero())).toBe(true)
  })
})

describe('lib/money — العمليات الحسابية', () => {
  it('يجمع بدقة عشرية لا تعاني من أخطاء الفاصلة العائمة', () => {
    // 0.1 + 0.2 === 0.30000000000000004 with float arithmetic. This is the
    // single reason CLAUDE.md forbids `number` for money.
    expect(add('0.1', '0.2').toString()).toBe('0.3')
    expect(add('0.1', '0.2').equals(new Decimal('0.3'))).toBe(true)
  })

  it('يطرح ويضرب ويقسم بدقة', () => {
    expect(sub('100.00', '33.33').toString()).toBe('66.67')
    expect(mul('19.99', '3').toString()).toBe('59.97')
    expect(div('100', '4').toString()).toBe('25')
  })

  it('يرفض القسمة على صفر', () => {
    expect(() => div('100', '0')).toThrow(RangeError)
  })

  it('يحسب النسبة المئوية كما تُعرض في الإعدادات', () => {
    // pct(1000, 5) means "5% of 1000", matching the settings UI wording.
    expect(pct('1000', 5).toString()).toBe('50')
    expect(pct('2500.50', '12.5').toString()).toBe('312.5625')
    expect(pct('1000', 0).toString()).toBe('0')
  })

  it('لا يقرّب النسبة قبل انتهاء العملية المركّبة', () => {
    // The penalty formula is task value × pct × late days. Rounding must happen
    // once, at the end — this is the difference between the two orders:
    const perDay = pct('333.33', 7)
    expect(perDay.toString()).toBe('23.3331')

    // Correct: full precision through the chain, one round2 at the end.
    const correct = round2(mul(perDay, 3))
    expect(toStorageString(correct)).toBe('70.00')

    // Wrong: rounding each day first loses a piaster per day.
    const roundedEarly = round2(mul(round2(perDay), 3))
    expect(toStorageString(roundedEarly)).toBe('69.99')

    expect(eq(correct, roundedEarly)).toBe(false)
  })

  it('يجمع قائمة الحركات لأن الرصيد دائمًا حاصل جمع', () => {
    expect(sum([]).toString()).toBe('0')
    expect(sum(['100.50', '-25.25', '0.75']).toString()).toBe('76')
    // 1000 entries of 0.01 must be exactly 10.00, not 9.999999999999831.
    expect(sum(Array.from({ length: 1000 }, () => '0.01')).toString()).toBe('10')
  })

  it('يعكس الإشارة ويأخذ القيمة المطلقة', () => {
    expect(negate('50.25').toString()).toBe('-50.25')
    expect(negate('-50.25').toString()).toBe('50.25')
    expect(abs('-50.25').toString()).toBe('50.25')
    expect(abs('50.25').toString()).toBe('50.25')
  })
})

describe('lib/money — التقريب إلى منزلتين', () => {
  it('يقرّب لأعلى عند النصف تمامًا (HALF_UP)', () => {
    expect(round2('2.345').toString()).toBe('2.35')
    expect(round2('2.355').toString()).toBe('2.36')
    // Banker's rounding would give 2.34 and 2.36 — indefensible in a
    // conversation with a worker about their deduction.
    expect(round2('0.005').toString()).toBe('0.01')
    expect(round2('0.015').toString()).toBe('0.02')
  })

  it('يقرّب السالب بعيدًا عن الصفر عند النصف', () => {
    expect(round2('-2.345').toString()).toBe('-2.35')
    expect(round2('-0.005').toString()).toBe('-0.01')
  })

  it('لا يغيّر قيمة سبق تقريبها', () => {
    expect(round2('12.34').toString()).toBe('12.34')
    expect(round2(round2('2.345')).toString()).toBe('2.35')
  })

  it('ينتج نصًا بمنزلتين دائمًا للتخزين', () => {
    expect(toStorageString('5')).toBe('5.00')
    expect(toStorageString('5.1')).toBe('5.10')
    expect(toStorageString('5.005')).toBe('5.01')
    expect(toStorageString(0)).toBe('0.00')
    expect(toStorageString('-3')).toBe('-3.00')
  })
})

describe('lib/money — المقارنات', () => {
  it('يقارن دون الاعتماد على معاملات JavaScript', () => {
    expect(compare('1.10', '1.1')).toBe(0)
    expect(compare('2', '1')).toBe(1)
    expect(compare('1', '2')).toBe(-1)
  })

  it('يوفّر دوال مقارنة صريحة', () => {
    expect(eq('1.10', '1.1')).toBe(true)
    expect(gt('2', '1')).toBe(true)
    expect(gt('1', '1')).toBe(false)
    expect(gte('1', '1')).toBe(true)
    expect(lt('1', '2')).toBe(true)
    expect(lte('1', '1')).toBe(true)
    expect(lte('2', '1')).toBe(false)
  })

  it('يميّز الصفر عن السالب عن الموجب', () => {
    expect(isZero('0.00')).toBe(true)
    expect(isNegative('-0.01')).toBe(true)
    expect(isNegative('0')).toBe(false)
    expect(isNegative('-0')).toBe(false)
    expect(isPositive('0.01')).toBe(true)
    expect(isPositive('0')).toBe(false)
  })

  it('يختار الأكبر والأصغر', () => {
    expect(max('5', '3').toString()).toBe('5')
    expect(max('3', '5').toString()).toBe('5')
    expect(min('5', '3').toString()).toBe('3')
    expect(min('3', '3').toString()).toBe('3')
  })
})

describe('lib/money — حدود العمود Decimal(12,2)', () => {
  it('يقبل الحد الأقصى والأدنى للعمود', () => {
    expect(fitsColumn(MONEY_MAX)).toBe(true)
    expect(fitsColumn(MONEY_MIN)).toBe(true)
    expect(fitsColumn('0')).toBe(true)
  })

  it('يرفض ما يتجاوز سعة العمود قبل أن تقتطعه قاعدة البيانات', () => {
    expect(fitsColumn(add(MONEY_MAX, '0.01'))).toBe(false)
    expect(fitsColumn(sub(MONEY_MIN, '0.01'))).toBe(false)
  })
})

describe('lib/money — المستحقات لا تصبح سالبة', () => {
  it('يحدّ المستحق عند صفر بدل السماح بقيمة سالبة', () => {
    // SPEC §5.4: a payout may reach zero but never goes negative.
    expect(clampAtZero('-250.75').toString()).toBe('0')
    expect(clampAtZero('0').toString()).toBe('0')
    expect(clampAtZero('250.75').toString()).toBe('250.75')
  })

  it('يترك الفائض ظاهرًا للمتصل ليُرحّل كرصيد مدين', () => {
    const gross = toMoney('1000')
    const deductions = toMoney('1300')
    const net = sub(gross, deductions)
    const payable = clampAtZero(net)
    const carryForward = sub(net, payable)

    expect(payable.toString()).toBe('0')
    expect(carryForward.toString()).toBe('-300')
  })
})

/** LRM, RLM, ALM, embedding/override and isolate controls. */
const BIDI_MARKS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/
/** Arabic-Indic and Persian digits, which SPEC section 2 forbids on screen. */
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/

describe('lib/money — العرض بالعربية بأرقام غربية', () => {
  it('يعرض بفاصلة آلاف ومنزلتين عشريتين', () => {
    expect(format('1234.5')).toBe('1,234.50')
    expect(format('1000000')).toBe('1,000,000.00')
    expect(format(0)).toBe('0.00')
  })

  it('يستخدم الأرقام الغربية لا العربية-الهندية', () => {
    const output = format('1234.5')
    expect(output).toMatch(/^[0-9,.]+$/)
    // No Arabic-Indic digits U+0660–U+0669 anywhere.
    expect(ARABIC_INDIC_DIGITS.test(output)).toBe(false)
  })

  it('لا يُدرج محارف اتجاه غير مرئية في النص', () => {
    // Their placement varies between ICU versions; direction is handled by the
    // rendering layer instead (dir="ltr" + tabular-nums).
    const outputs = [
      format('-99.05'),
      format('1234.5', { withCurrency: true }),
      format('-99.05', { withCurrency: true }),
    ]
    for (const output of outputs) {
      expect(BIDI_MARKS.test(output)).toBe(false)
    }
  })

  it('يعرض رمز الجنيه المصري عند الطلب', () => {
    const output = format('1234.5', { withCurrency: true })
    expect(output).toContain('1,234.50')
    expect(output).toContain('ج.م')
  })

  it('يعرض إشارة موجب صراحة للحركات الدائنة', () => {
    expect(format('250', { signDisplay: true })).toBe('+250.00')
    expect(format('-250', { signDisplay: true })).toBe('-250.00')
    expect(format('0', { signDisplay: true })).toBe('0.00')
  })

  it('يقرّب قبل العرض بنفس سياسة التخزين', () => {
    expect(format('2.345')).toBe('2.35')
    expect(format('2.344')).toBe('2.34')
  })

  it('يعرض السالب بإشارة ناقص واضحة', () => {
    expect(format('-99.05')).toBe('-99.05')
  })
})
