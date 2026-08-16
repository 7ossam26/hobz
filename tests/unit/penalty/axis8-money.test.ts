import { describe, expect, it } from 'vitest'

import { DomainError } from '@/lib/errors'
import {
  MONEY_MAX,
  div,
  eq,
  fitsColumn,
  format,
  gt,
  mul,
  pct,
  round2,
  toMoney,
  toStorageString,
  type Money,
} from '@/lib/money'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import type { LatenessResult } from '@/modules/lateness/service'
import type { PayProfile } from '@/modules/ledger/pay-profile'
import { signedAmountFor } from '@/modules/ledger/sign'
import { payBasesFor, resolveBasis } from '@/modules/penalty/basis'
import { buildBreakdown, formulaFor, penaltyNote } from '@/modules/penalty/breakdown'
import {
  calculatePenalty,
  isChargeable,
  type PenaltyCalculation,
  type PenaltyCalculationInput,
} from '@/modules/penalty/calculate'
import { resolvePenaltyProfile } from '@/modules/penalty/profile'

import { advanceHours, cairo } from '../../helpers/time'

/**
 * docs/TESTING.md §4 **axis 8 (Money)**, applied to the penalty engine.
 *
 * The axis reads "rounding to 2dp, penalty exceeding earnings, …". For this
 * module that unpacks into five questions, and getting any of them wrong costs
 * a real person a real amount of money:
 *
 *  1. **Where does the single rounding happen?** On the product, not on the
 *     per-day charge. A piastre a day for a month is a third of a pound the
 *     منفّذ can prove they never owed — and a منفّذ who can prove one number
 *     wrong has no reason to believe any of the others.
 *  2. **Does the unrounded daily rate survive?** `pay-profile` keeps
 *     `salary ÷ workingDaysPerMonth` unrounded on purpose. If anything between
 *     there and the ledger rounds it, every salaried person's deduction drifts.
 *  3. **Is the amount always a positive canonical 2dp string?** The magnitude
 *     is the engine's answer; the sign is the ledger's (`modules/ledger/sign`).
 *     An engine that emitted a signed value would be a second place the sign
 *     lives, and the second place is the one that disagrees.
 *  4. **Is "no cap" honoured?** SPEC §5.4 says the deduction is not floored at
 *     the task's value or at a month's pay, and `Decimal(12,2)` is a column
 *     width rather than a policy. A silent truncation there would quietly
 *     forgive somebody's deduction — or invent one.
 *  5. **Does the sentence the منفّذ reads reproduce the number?** CLAUDE.md's
 *     one-line reason for this product's existence, as an executable assertion:
 *     the terms in `formulaFor(...)` are parsed back out below and multiplied by
 *     hand, and they must land exactly on the stated amount.
 *
 * Nothing here touches a database, a clock or Settings — the two Settings reads
 * take catalog *defaults* (docs/TESTING.md §5: never assert a hardcoded
 * business number). Every other number is a test **input**, and every expected
 * amount is hand-computed in the comment above the assertion.
 *
 * The rounding cases in `calculate.test.ts` are not repeated; these are the
 * ones that file leaves open.
 */

const input = (over: Partial<PenaltyCalculationInput>): PenaltyCalculationInput => ({
  mode: 'PCT_TASK_VALUE_PER_DAY',
  value: '5',
  lateWorkingDays: 1,
  taskValue: null,
  dailyRate: null,
  dailyRateDerivation: null,
  ...over,
})

/** Canonical persistence form: a string, always exactly two decimals, unsigned. */
const CANONICAL_MONEY = /^\d+\.\d{2}$/

/**
 * The order this engine deliberately does **not** use: round the day's charge
 * to 2dp first, then multiply by the day count. Computed with `lib/money` so
 * the tests below can name the exact figure a منفّذ would have been charged had
 * the rounding been put in the wrong place.
 */
const roundPerDayThenMultiply = (basis: string, percent: string, days: number): string =>
  toStorageString(mul(round2(pct(toMoney(basis), percent)), days))

/**
 * A salaried pay profile. `workingDaysPerMonth` is injected by the caller
 * because it is Settings data (CLAUDE.md invariant 4) — the divisors used below
 * are test inputs chosen so the quotient does **not** terminate.
 */
const dailyRateBasesFor = (monthlySalary: string, perMonth: number) =>
  payBasesFor(
    { payType: 'SALARY', monthlySalary, defaultTaskRate: null } satisfies PayProfile,
    // A salaried منفّذ has no task-value basis whatever the task carries, so
    // passing one here would prove nothing; `basis.test.ts` owns that rule.
    null,
    perMonth,
  )

describe('التقريب مرة واحدة، على المنتج لا على الرسم اليومي', () => {
  it('يقرّب النصف تمامًا لأعلى: 20.02 × 5% × 5 أيام = 5.005 → 5.01', () => {
    // 20.02 × 5% = 1.001 في اليوم. المنتج 1.001 × 5 = 5.005 بالضبط، وHALF_UP
    // يرفعه إلى 5.01. لو قُرِّب الرسم اليومي أولًا لصار 1.00 × 5 = 5.00 —
    // خمسة قروش تختفي من خصم لا يستطيع أحد شرح اختفائها.
    const result = calculatePenalty(
      input({ value: '5', lateWorkingDays: 5, taskValue: toMoney('20.02') }),
    )

    expect(result.amount).toBe('5.01')
    expect(roundPerDayThenMultiply('20.02', '5', 5)).toBe('5.00')
    expect(result.amount).not.toBe(roundPerDayThenMultiply('20.02', '5', 5))
  })

  it('يقرّب 0.015 لأعلى: 80.10 × 5% × 3 أيام = 12.015 → 12.02', () => {
    // 80.10 × 5% = 4.005 في اليوم. المنتج 12.015 بالضبط → 12.02.
    // التقريب اليومي هنا يقع في الاتجاه المعاكس: 4.005 → 4.01، ثم × 3 = 12.03،
    // أي قرش زائد يدفعه المنفّذ بلا سبب. الخطأ في الاتجاهين ضرر، لا في اتجاه واحد.
    const result = calculatePenalty(
      input({ value: '5', lateWorkingDays: 3, taskValue: toMoney('80.10') }),
    )

    expect(result.amount).toBe('12.02')
    expect(roundPerDayThenMultiply('80.10', '5', 3)).toBe('12.03')
  })

  it('يقرّب لأسفل دون النصف: 66.68 × 5% × 3 أيام = 10.002 → 10.00', () => {
    // 66.68 × 5% = 3.334 في اليوم. المنتج 10.002 → 10.00.
    // بالتقريب اليومي: 3.33 × 3 = 9.99. المنفّذ الذي يعيد الحسبة بآلة حاسبة
    // يصل إلى 10.00، فيرى فرقًا لا يفسّره شيء في الشاشة.
    const result = calculatePenalty(
      input({ value: '5', lateWorkingDays: 3, taskValue: toMoney('66.68') }),
    )

    expect(result.amount).toBe('10.00')
    expect(roundPerDayThenMultiply('66.68', '5', 3)).toBe('9.99')
  })

  it('يقرّب لأسفل في مبلغ أكبر: 250.05 × 3% × 7 أيام = 52.5105 → 52.51', () => {
    // 250.05 × 3% = 7.5015 في اليوم. المنتج 52.5105 → 52.51.
    // بالتقريب اليومي: 7.50 × 7 = 52.50. الفرق قرش واحد هنا، لكنه قرش يتكرر
    // على كل مهمة متأخرة لكل منفّذ في كل دورة صرف.
    const result = calculatePenalty(
      input({ value: '3', lateWorkingDays: 7, taskValue: toMoney('250.05') }),
    )

    expect(result.amount).toBe('52.51')
    expect(roundPerDayThenMultiply('250.05', '3', 7)).toBe('52.50')
  })
})

describe('دقة الراتب اليومي — القسمة التي لا تنتهي', () => {
  it('يمرّر الراتب اليومي غير مقرَّب من payBasesFor إلى resolveBasis', () => {
    // 6500 ÷ 21 = 309.523809523809… — كسر دوري لا ينتهي. الرقم المعروض (309.52)
    // ليس الرقم المضروب، والفارق بينهما هو ما تحميه هذه الحالة.
    const bases = dailyRateBasesFor('6500.00', 21)
    const rate = bases.dailyRate

    expect(rate).not.toBeNull()
    expect(eq(round2(rate!), rate!)).toBe(false)

    const resolved = resolveBasis('PCT_DAILY_RATE_PER_DAY', bases)

    expect(resolved.available).toBe(true)
    expect(eq(resolved.amount!, rate!)).toBe(true)
    // ما يُعرض للقراءة فقط — لا يدخل في أي عملية ضرب.
    expect(toStorageString(resolved.amount!)).toBe('309.52')
  })

  it('لا انحراف لأعلى: (6500 ÷ 21) × 10% × 7 أيام = 216.67 وليس 216.66', () => {
    // 6500 ÷ 21 × 10% = 30.952380952… في اليوم، × 7 = 216.666666… → 216.67.
    // لو قُرِّب الراتب اليومي أولًا: 309.52 × 10% × 7 = 216.664 → 216.66.
    // قرش ناقص في خصم شهري يعني أن كشف الحساب لا يجمع، ولا أحد يعرف لماذا.
    const bases = dailyRateBasesFor('6500.00', 21)
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '10',
        lateWorkingDays: 7,
        ...bases,
      }),
    )

    expect(result.amount).toBe('216.67')
    expect(toStorageString(mul(pct(round2(bases.dailyRate!), '10'), 7))).toBe('216.66')
  })

  it('ولا انحراف لأسفل: (4500 ÷ 21) × 25% × 12 يومًا = 642.86 وليس 642.87', () => {
    // 4500 ÷ 21 = 214.285714285714…، × 25% × 12 = 642.857142857… → 642.86.
    // بتقريب الراتب أولًا: 214.29 × 25% × 12 = 642.87 — قرش يدفعه المنفّذ ولم
    // يستحقّه أحد. الانحراف ليس دائمًا في مصلحته، وهذا بالضبط ما يجعله خطأً.
    const bases = dailyRateBasesFor('4500.00', 21)
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '25',
        lateWorkingDays: 12,
        ...bases,
      }),
    )

    expect(result.amount).toBe('642.86')
    expect(toStorageString(mul(pct(round2(bases.dailyRate!), '25'), 12))).toBe('642.87')
  })
})

describe('النسب: فوق 100% وبمنزلتين عشريتين', () => {
  it('لا يقف عند 100%: 333.33 × 120% × يومان = 799.99', () => {
    // 333.33 × 120% = 399.996 في اليوم، × 2 = 799.992 → 799.99.
    // النسبة فوق 100% مسموحة عمدًا (schema.ts: "Uncapped … SPEC §5.4 says No cap")
    // ولا يُدوّر الرسم اليومي: 399.996 → 400.00 ثم × 2 = 800.00، قرش زائد.
    const result = calculatePenalty(
      input({ value: '120', lateWorkingDays: 2, taskValue: toMoney('333.33') }),
    )

    expect(result.amount).toBe('799.99')
    expect(roundPerDayThenMultiply('333.33', '120', 2)).toBe('800.00')
  })

  it('نسبة 200% من الراتب اليومي: (6500 ÷ 21) × 200% × يومان = 1238.10', () => {
    // يوما أجر عن كل يوم تأخير. 6500 ÷ 21 × 2 × 2 = 1238.095238… → 1238.10.
    // لو قُصّت النسبة عند 100% لخسرت الوكالة نصف الخصم المتّفق عليه في العقد،
    // ولو قُرِّب الراتب أولًا لصار 1238.08.
    const bases = dailyRateBasesFor('6500.00', 21)
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '200',
        lateWorkingDays: 2,
        ...bases,
      }),
    )

    expect(result.amount).toBe('1238.10')
  })

  it('نسبة بمنزلتين مرة واحدة: 1234.56 × 7.35% = 90.74016 → 90.74', () => {
    // الكسر 0.016 دون النصف فينزل إلى 90.74. نسبة بمنزلتين ليست حالة نادرة:
    // إنها ما يخرج من قسمة بند تعاقدي على عدد بنود، ويجب أن تُحفظ كما كُتبت.
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '7.35',
        lateWorkingDays: 9,
        taskValue: toMoney('1234.56'),
      }),
    )

    expect(result.amount).toBe('90.74')
  })

  it('نسبة بمنزلتين يوميًا: 1000.10 × 7.35% × 4 أيام = 294.0294 → 294.03', () => {
    // 1000.10 × 7.35% = 73.50735 في اليوم، × 4 = 294.0294 → 294.03.
    // بالتقريب اليومي: 73.51 × 4 = 294.04. منزلتان في النسبة تضاعفان فرصة
    // الانحراف، لأن الرسم اليومي يخرج بخمس منازل لا بمنزلتين.
    const result = calculatePenalty(
      input({ value: '7.35', lateWorkingDays: 4, taskValue: toMoney('1000.10') }),
    )

    expect(result.amount).toBe('294.03')
    expect(roundPerDayThenMultiply('1000.10', '7.35', 4)).toBe('294.04')
  })

  it('يحفظ النسبة نفسها نصًا قانونيًا بمنزلتين', () => {
    // `value` تُخزَّن بمنزلتين لأنها تُضرب في مال. المعادلة المعروضة هي التي
    // تحذف الأصفار الزائدة، لا التخزين — الرقمان لا يتبادلان الأدوار.
    const result = calculatePenalty(
      input({ value: '7.35', lateWorkingDays: 4, taskValue: toMoney('1000.10') }),
    )

    expect(result.value).toBe('7.35')
    expect(result.value).toMatch(CANONICAL_MONEY)
  })
})

describe('المبلغ نص بمنزلتين، موجب دائمًا', () => {
  it('كل أوضاع SPEC §5.4 تعيد نصًا قانونيًا بمنزلتين، لا رقمًا', () => {
    // CLAUDE.md invariant 2: المال Decimal ولا يعبر الحدود إلا نصًا. رقم
    // JavaScript هنا يعني أن 0.1 + 0.2 تدخل دفتر حسابات لا يُعدَّل بعد الكتابة.
    const cases: readonly PenaltyCalculationInput[] = [
      input({ mode: 'FIXED_PER_DAY', value: '12.34', lateWorkingDays: 5 }),
      input({ mode: 'FIXED_ONCE', value: '99.99', lateWorkingDays: 5 }),
      input({ value: '7.35', lateWorkingDays: 4, taskValue: toMoney('1000.10') }),
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '7.35',
        lateWorkingDays: 4,
        taskValue: toMoney('1234.56'),
      }),
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '10',
        lateWorkingDays: 7,
        ...dailyRateBasesFor('6500.00', 21),
      }),
    ]

    for (const one of cases) {
      const result = calculatePenalty(one)

      expect(result.status, one.mode).toBe('DUE')
      expect(typeof result.amount, one.mode).toBe('string')
      expect(result.amount, one.mode).toMatch(CANONICAL_MONEY)
    }
  })

  it('الحالات غير المستحقة تعيد "0.00" نصًا، لا صفرًا رقميًا ولا null', () => {
    // صفر نصّي بمنزلتين يمرّ في نفس المسار الذي يمرّ فيه المبلغ الحقيقي، فلا
    // يحتاج أي قارئ لاحق إلى فرع خاص — والفرع الخاص هو ما يُنسى.
    const cases: ReadonlyArray<[string, PenaltyCalculation]> = [
      [
        'NOT_LATE',
        calculatePenalty(input({ lateWorkingDays: 0, taskValue: toMoney('1000.00') })),
      ],
      [
        'ZERO',
        calculatePenalty(
          input({ value: '0', lateWorkingDays: 4, taskValue: toMoney('1000.00') }),
        ),
      ],
      ['NO_BASIS', calculatePenalty(input({ lateWorkingDays: 4 }))],
    ]

    for (const [status, result] of cases) {
      expect(result.status, status).toBe(status)
      expect(result.amount, status).toBe('0.00')
      expect(result.amount, status).toMatch(CANONICAL_MONEY)
    }
  })

  it('قيمة سالبة في البروفايل لا تنقلب مكافأة', () => {
    // خصم سالب مكافأة. لو مرّ لكان الدفتر قد دفع لمنفّذ ثمن تأخيره، والقيد
    // لا يُحذف بعد كتابته — التصحيح الوحيد قيد عكسي يراه الجميع.
    const result = calculatePenalty(
      input({ value: '-100', lateWorkingDays: 6, taskValue: toMoney('1000.00') }),
    )

    expect(result.status).toBe('ZERO')
    expect(result.amount).toBe('0.00')
    expect(result.amount.startsWith('-')).toBe(false)
  })

  it('راتب سالب ليس أساسًا: NO_BASIS لا رصيد دائن', () => {
    // عمود الراتب لا يمنع السالب، فالدفاع هنا في resolveBasis: "صفر ليس
    // أساسًا" تشمل ما دون الصفر. النتيجة سبب معلن، لا خصم مقلوب الإشارة.
    const bases = dailyRateBasesFor('-6500.00', 21)

    // الرقم يصل سالبًا فعلًا — الرفض قرار لاحق، لا صدفة في الطريق.
    expect(bases.dailyRate).not.toBeNull()
    expect(bases.dailyRate!.isNegative()).toBe(true)

    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '10',
        lateWorkingDays: 7,
        ...bases,
      }),
    )

    expect(result.status).toBe('NO_BASIS')
    expect(result.amount).toBe('0.00')
  })

  it('الأساس المعروض نص بمنزلتين، وnull للأوضاع الثابتة لا "0.00"', () => {
    // فرق يقرؤه المنفّذ: "لا يوجد أساس" غير "الأساس صفر". الأول وصف لطريقة
    // الحساب، والثاني يبدو كأن المهمة بلا قيمة.
    const percentage = calculatePenalty(
      input({ value: '5', lateWorkingDays: 3, taskValue: toMoney('1200.00') }),
    )
    const fixed = calculatePenalty(
      input({ mode: 'FIXED_PER_DAY', value: '150.00', lateWorkingDays: 3 }),
    )

    expect(percentage.basisAmount).toMatch(CANONICAL_MONEY)
    expect(percentage.basisAmount).toBe('1200.00')
    expect(fixed.basisAmount).toBeNull()
  })
})

describe('لا سقف للخصم — عرض العمود ليس سياسة (SPEC §5.4)', () => {
  it('يتجاوز قيمة المهمة ثلاثة أضعاف بلا قصّ: 750.00 × 10% × 30 يومًا = 2250.00', () => {
    // 75.00 في اليوم × 30 يوم عمل = 2250.00، أي ثلاثة أضعاف قيمة المهمة.
    // القصّ عند قيمة المهمة قرار سياسة يخصّ إقفال دورة الصرف (§5.5)، وليس
    // للمحرّك أن يتخذه نيابة عنه ويُخفي أن التأخير بلغ هذا الحد.
    const taskValue = toMoney('750.00')
    const result = calculatePenalty(
      input({ value: '10', lateWorkingDays: 30, taskValue }),
    )

    expect(result.amount).toBe('2250.00')
    expect(gt(result.amount, taskValue)).toBe(true)
  })

  it('يتجاوز راتب شهر كامل: (6500 ÷ 21) × 100% × 40 يومًا = 12380.95', () => {
    // 6500 ÷ 21 × 40 = 12380.952380… → 12380.95، أي ما يقارب راتب شهرين.
    // المستحق لا يصير سالبًا (§5.4) لكن الفائض يُرحَّل كرصيد مدين — وهذا لا
    // يعمل إن كان المحرّك قد قصّ الرقم قبل أن يصل إلى الدفتر.
    const bases = dailyRateBasesFor('6500.00', 21)
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '100',
        lateWorkingDays: 40,
        ...bases,
      }),
    )

    expect(result.amount).toBe('12380.95')
    expect(gt(result.amount, '6500.00')).toBe(true)
  })

  it('أكبر مبلغ يتّسع في العمود يمرّ كما هو ويُقبل في الدفتر', () => {
    // الحد الأعلى لـ Decimal(12,2) بالضبط: يجب أن يمرّ، لأن الحدّ ليس خطأً.
    const result = calculatePenalty(
      input({ mode: 'FIXED_ONCE', value: MONEY_MAX, lateWorkingDays: 3 }),
    )

    expect(result.amount).toBe('9999999999.99')
    expect(fitsColumn(result.amount)).toBe(true)
    expect(signedAmountFor('PENALTY', result.amount)).toBe('-9999999999.99')
  })

  it('قرش واحد فوق سعة العمود: يعيد الرقم الصحيح ويرفضه الدفتر بدل بتره', () => {
    // 5,000,000,000.00 × يومان = 10,000,000,000.00، وهو MONEY_MAX + 0.01 —
    // قرش واحد خارج العمود. المطلوب أمران معًا: أن يقول المحرّك الرقم الحقيقي،
    // وأن يرفض الدفتر تخزينه صراحةً. البتر الصامت هنا يعني خصمًا مكتوبًا في
    // كشف حساب المنفّذ بمبلغ لم يحسبه أحد ولا يستطيع أحد شرحه.
    const result = calculatePenalty(
      input({ mode: 'FIXED_PER_DAY', value: '5000000000.00', lateWorkingDays: 2 }),
    )

    expect(result.amount).toBe('10000000000.00')
    expect(gt(result.amount, MONEY_MAX)).toBe(true)
    expect(fitsColumn(result.amount)).toBe(false)
    expect(() => signedAmountFor('PENALTY', result.amount)).toThrow(DomainError)
    expect(domainErrorKey(() => signedAmountFor('PENALTY', result.amount))).toBe(
      'ledger.errors.amountOutOfRange',
    )
  })
})

/** The `messageKey` of the `DomainError` a call throws — fails loudly if it does not. */
function domainErrorKey(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as DomainError).messageKey
  }
  throw new Error('expected a DomainError, none was thrown')
}

describe('الإشارة يضعها الدفتر، لا محرّك الخصم', () => {
  it('يحوّل المقدار الموجب إلى قيد مدين سالب بنفس المقدار', () => {
    // 1200.00 × 5% × 3 = 180.00 مقدارًا، و−180.00 قيدًا. المحرّك لا يعرف
    // الإشارة أصلًا: الرصيد SUM(amount)، والإشارة تُوضع مرة واحدة عند الكتابة.
    const result = calculatePenalty(
      input({ value: '5', lateWorkingDays: 3, taskValue: toMoney('1200.00') }),
    )

    expect(result.amount).toBe('180.00')
    expect(signedAmountFor('PENALTY', result.amount)).toBe('-180.00')
    expect(signedAmountFor('PENALTY', result.amount)).toBe(`-${result.amount}`)
  })

  it('يرفض الدفتر مقدار الصفر — والحالات غير المستحقة لا تُكتب أصلًا', () => {
    // حركة بصفر ليست حركة: قيد لا يحرّك مالًا يترك في السجل أثرًا يبدو خصمًا
    // ولا يخصم شيئًا. لهذا يوجد isChargeable قبل الكتابة، لا بعدها.
    const cases: readonly PenaltyCalculation[] = [
      calculatePenalty(input({ lateWorkingDays: 0, taskValue: toMoney('1000.00') })),
      calculatePenalty(
        input({ value: '0', lateWorkingDays: 4, taskValue: toMoney('1000.00') }),
      ),
      calculatePenalty(input({ lateWorkingDays: 4 })),
    ]

    for (const result of cases) {
      expect(isChargeable(result), result.status).toBe(false)
      expect(() => signedAmountFor('PENALTY', result.amount), result.status).toThrow(
        DomainError,
      )
      expect(
        domainErrorKey(() => signedAmountFor('PENALTY', result.amount)),
        result.status,
      ).toBe('ledger.errors.magnitudeMustBePositive')
    }
  })

  it('خصم يقلّ عن نصف قرش يُقرَّب إلى 0.00 ويرفضه الدفتر بوصفه لا-حركة', () => {
    // 30.00 × 0.01% = 0.003 — أصغر نسبة يقبلها البروفايل (schema.ts يفرض
    // منزلتين) على مهمة صغيرة. المنتج دون نصف قرش، فينزل إلى 0.00.
    //
    // المهم هنا أن الدفتر هو خط الدفاع الأخير: قيد PENALTY بصفر لا يُحذف بعد
    // كتابته (invariant 1)، ويظهر في كشف الحساب كخصم لا يخصم شيئًا ولا يستطيع
    // شرح نفسه. الرفض صريح بمفتاح خطأ، لا تقريب صامت إلى قرش لم يُحسب.
    const result = calculatePenalty(
      input({ value: '0.01', lateWorkingDays: 1, taskValue: toMoney('30.00') }),
    )

    expect(result.amount).toBe('0.00')
    expect(() => signedAmountFor('PENALTY', result.amount)).toThrow(DomainError)
    expect(domainErrorKey(() => signedAmountFor('PENALTY', result.amount))).toBe(
      'ledger.errors.magnitudeMustBePositive',
    )
  })
})

/**
 * Re-derive an amount from the Arabic formula line itself.
 *
 * This is the axis's centrepiece. CLAUDE.md says deductions must "feel like
 * arithmetic, not like the manager's mood", and `breakdown.ts` translates that
 * into "a منفّذ handed this text and a calculator must arrive at the same
 * number". The parser below *is* that منفّذ: it reads only the rendered string,
 * takes every number and every `×` / `÷` / `%` at face value, and multiplies
 * left to right. If any term shown were a rounded intermediate, the result
 * would miss the stated amount — which is exactly the complaint the rule exists
 * to prevent.
 */
const FORMULA_TERM = /\d+(?:,\d{3})*(?:\.\d+)?%?|[×÷]/g

function evaluateFormula(formula: string): Money {
  let total: Money | null = null
  let operator = '×'

  for (const token of formula.match(FORMULA_TERM) ?? []) {
    if (token === '×' || token === '÷') {
      operator = token
      continue
    }

    const isPercent = token.endsWith('%')
    const literal = (isPercent ? token.slice(0, -1) : token).replace(/,/g, '')
    const operand = isPercent ? div(toMoney(literal), 100) : toMoney(literal)

    if (total === null) total = operand
    else if (operator === '÷') total = div(total, operand)
    else total = mul(total, operand)
  }

  if (total === null) throw new Error(`no numeric term in formula: ${formula}`)
  return total
}

const reproduces = (calculation: PenaltyCalculation): string =>
  toStorageString(evaluateFormula(formulaFor(calculation)))

describe('المعادلة المعروضة تُعيد إنتاج المبلغ بالضبط', () => {
  it('مبلغ ثابت يوميًا: 150.00 × 3 = 450.00', () => {
    const result = calculatePenalty(
      input({ mode: 'FIXED_PER_DAY', value: '150.00', lateWorkingDays: 3 }),
    )

    expect(formulaFor(result)).toContain('150.00')
    expect(reproduces(result)).toBe(result.amount)
    expect(result.amount).toBe('450.00')
  })

  it('مبلغ ثابت مرة واحدة: الرقم الوحيد في السطر هو المبلغ', () => {
    // 250.00 مرة واحدة مهما بلغ التأخير — فلا يجوز أن يظهر عدد الأيام في السطر،
    // وإلا قرأه المنفّذ كأنه ضرب لم يحدث.
    const result = calculatePenalty(
      input({ mode: 'FIXED_ONCE', value: '250.00', lateWorkingDays: 9 }),
    )

    expect(reproduces(result)).toBe(result.amount)
    expect(result.amount).toBe('250.00')
    expect(formulaFor(result)).not.toContain('9')
  })

  it('نسبة بمنزلتين من قيمة المهمة يوميًا: 1,000.10 × 7.35% × 4 = 294.03', () => {
    // كل حدّ في السطر دقيق: قيمة المهمة بمنزلتين، والنسبة كما كُتبت، وعدد
    // الأيام صحيح. الرسم اليومي (73.50735) لا يظهر لأنه لا يُعاد ضربه بدقة.
    const result = calculatePenalty(
      input({ value: '7.35', lateWorkingDays: 4, taskValue: toMoney('1000.10') }),
    )

    expect(formulaFor(result)).toContain('7.35%')
    expect(formulaFor(result)).not.toContain('73.51')
    expect(reproduces(result)).toBe(result.amount)
    expect(result.amount).toBe('294.03')
  })

  it('نسبة من قيمة المهمة مرة واحدة: 1,234.56 × 7.35% = 90.74', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '7.35',
        lateWorkingDays: 9,
        taskValue: toMoney('1234.56'),
      }),
    )

    expect(reproduces(result)).toBe(result.amount)
    expect(result.amount).toBe('90.74')
  })

  it('نسبة فوق 100%: 333.33 × 120% × 2 تُعاد يدويًا إلى 799.99', () => {
    // النسبة تُكتب "120" لا "120.00": الأصفار الزائدة تُقرأ كأنها رقم محسوب،
    // والنسبة قرار كتبه إنسان. ومع ذلك تبقى الحسبة قابلة لإعادة الإنتاج.
    const result = calculatePenalty(
      input({ value: '120', lateWorkingDays: 2, taskValue: toMoney('333.33') }),
    )

    expect(formulaFor(result)).toContain('120%')
    expect(reproduces(result)).toBe(result.amount)
    expect(result.amount).toBe('799.99')
  })

  it('الراتب اليومي يُعرض قسمةً — (6,500.00 ÷ 21) لا 309.52', () => {
    // هذا هو الحدّ الوحيد الذي لا يمكن عرضه كرقم واحد دون كذب: 6500 ÷ 21 لا
    // تنتهي. عرض 309.52 يجعل المنفّذ يصل إلى 216.66 بينما الدفتر يقول 216.67،
    // ولا أحد على المكتب يستطيع تفسير الفرق. عرض القسمة يجعل السطر صادقًا.
    const bases = dailyRateBasesFor('6500.00', 21)
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '10',
        lateWorkingDays: 7,
        ...bases,
        dailyRateDerivation: { monthlySalary: '6500.00', workingDaysPerMonth: 21 },
      }),
    )
    const formula = formulaFor(result)

    expect(formula).toContain('6,500.00')
    expect(formula).toContain('÷ 21')
    expect(formula).not.toContain('309.52')
    expect(reproduces(result)).toBe(result.amount)
    expect(result.amount).toBe('216.67')
  })

  it('الرقم المقرَّب لو عُرض لأعطى 216.66 — وهذا سبب استحالة فصل الاشتقاق', () => {
    // السطر بلا اشتقاق يعرض 309.52، فتخرج إعادة الحساب اليدوية بـ216.66 بينما
    // المبلغ 216.67. الفارق قرش، والثمن هو مصداقية كل رقم آخر في الكشف.
    //
    // بناء هذه الحالة هنا يدويًا بـ`dailyRateDerivation: null` هو الطريق الوحيد
    // الباقي لإنتاجها: `payBasesFor` يحمل الاشتقاق داخل `PayBases` بجوار الراتب
    // اليومي نفسه، فأي مستدعٍ ينشر `...bases` يحصل عليهما معًا ولا يستطيع فصلهما.
    // كان الحقل اختياريًا ومنفصلًا حتى نبّه مسح المحور 8 إلى أن مستدعيًا واحدًا
    // ناسيًا يكتب في دفتر لا يُعدَّل سطرًا لا يُجمع.
    const bases = dailyRateBasesFor('6500.00', 21)
    const withoutDerivation = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '10',
        lateWorkingDays: 7,
        ...bases,
        dailyRateDerivation: null,
      }),
    )

    expect(formulaFor(withoutDerivation)).toContain('309.52')
    expect(reproduces(withoutDerivation)).toBe('216.66')
    expect(withoutDerivation.amount).toBe('216.67')

    // وهذا هو ما يمنع حدوثها: الاشتقاق يأتي مع الراتب اليومي دائمًا.
    expect(bases.dailyRateDerivation).toEqual({
      monthlySalary: '6500.00',
      workingDaysPerMonth: 21,
    })
  })
})

/**
 * `penaltyNote` is the sentence that becomes permanent: SPEC §4 makes
 * `LedgerEntry.note` required because "an entry that cannot explain itself is
 * exactly what this product exists to abolish". So the arithmetic promise has
 * to survive into the persisted prose, not stop at the screen.
 */
const TASK_ID = 'task_axis8_money'
const TASK_TITLE = 'إعادة تصميم صفحة الهبوط'
const DUE_AT = cairo('2026-04-05T17:00')

/** Settings defaults, read from the catalog rather than retyped (TESTING.md §5). */
const GRACE_HOURS = SETTINGS_CATALOG['penalty.defaultGraceHours'].default

const AGENCY_PROFILE = resolvePenaltyProfile(null, {
  mode: SETTINGS_CATALOG['penalty.defaultMode'].default,
  value: SETTINGS_CATALOG['penalty.defaultValue'].default,
  graceHours: GRACE_HOURS,
})

const latenessFor = (calculation: PenaltyCalculation): LatenessResult => ({
  taskId: TASK_ID,
  lateWorkingDays: calculation.lateWorkingDays,
  dueDate: DUE_AT,
  originalDueDate: DUE_AT,
  graceHours: GRACE_HOURS,
  effectiveDueDate: advanceHours(DUE_AT, GRACE_HOURS),
  measuredAt: cairo('2026-04-16T09:00'),
  frozen: true,
  extended: false,
  blockedWorkingDays: 0,
})

const breakdownFor = (calculation: PenaltyCalculation) =>
  buildBreakdown({
    taskId: TASK_ID,
    taskTitle: TASK_TITLE,
    lateness: latenessFor(calculation),
    calculation,
    profile: AGENCY_PROFILE,
    roundIndex: 0,
    revisionCount: 0,
  })

describe('الملاحظة المحفوظة تحمل نفس الحسبة', () => {
  it('تنتهي الملاحظة بـ«المعادلة = المبلغ»، والمعادلة تُعيد إنتاج المبلغ', () => {
    // ما يُكتب في الدفتر لا يُعدَّل ولا يُحذف. لو حملت الملاحظة معادلة لا تصل
    // إلى مبلغها، لبقيت في السجل إلى الأبد ولما أصلحها إلا قيد عكسي.
    const bases = dailyRateBasesFor('6500.00', 21)
    const calculation = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '10',
        lateWorkingDays: 7,
        ...bases,
        dailyRateDerivation: { monthlySalary: '6500.00', workingDaysPerMonth: 21 },
      }),
    )
    const breakdown = breakdownFor(calculation)
    const note = penaltyNote(breakdown)

    expect(breakdown.formula).toBe(formulaFor(calculation))
    expect(note.slice(note.indexOf(breakdown.formula))).toBe(
      `${breakdown.formula} = ${format(breakdown.amount)}`,
    )
    expect(toStorageString(evaluateFormula(breakdown.formula))).toBe(breakdown.amount)
    expect(breakdown.amount).toBe('216.67')
  })

  it('الصيغة الافتراضية المشحونة في الإعدادات تُعيد إنتاج مبلغها هي أيضًا', () => {
    // الأرقام هنا تأتي من SETTINGS_CATALOG لا من هذا الملف، فلو غيّرت الوكالة
    // وضعها الافتراضي أو نسبتها بقي هذا الاختبار يعني نفس الشيء: أيًّا كانت
    // الصيغة المشحونة، سطرها يجب أن يُعيد إنتاج مبلغه.
    const result = calculatePenalty({
      mode: AGENCY_PROFILE.mode,
      value: AGENCY_PROFILE.value,
      lateWorkingDays: 3,
      ...payBasesFor(
        { payType: 'HYBRID', monthlySalary: '6500.00', defaultTaskRate: '900.00' },
        '1200.00',
        SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default,
      ),
      dailyRateDerivation: {
        monthlySalary: '6500.00',
        workingDaysPerMonth: SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default,
      },
    })
    const note = penaltyNote(breakdownFor(result))

    expect(result.status).toBe('DUE')
    expect(result.amount).toMatch(CANONICAL_MONEY)
    expect(reproduces(result)).toBe(result.amount)
    expect(note).toContain(formulaFor(result))
    expect(note).toContain(format(result.amount))
  })
})
