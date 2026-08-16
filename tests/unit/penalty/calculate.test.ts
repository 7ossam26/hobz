import { describe, expect, it } from 'vitest'

import { toMoney } from '@/lib/money'
import {
  calculatePenalty,
  type PenaltyCalculationInput,
} from '@/modules/penalty/calculate'

/**
 * SPEC §5.4, the formula table, against hand-computed values at 2dp
 * (phase brief: "Every mode against hand-computed expected values, at 2dp").
 *
 * ```
 * amount = switch profile.mode
 *   FIXED_PER_DAY            → value × lateWorkingDays
 *   PCT_TASK_VALUE_PER_DAY   → task.taskValue × value% × lateWorkingDays
 *   PCT_DAILY_RATE_PER_DAY   → dailyRate(user) × value% × lateWorkingDays
 *   FIXED_ONCE               → value
 *   PCT_TASK_VALUE_ONCE      → task.taskValue × value%
 * ```
 *
 * Every expected number below was worked out by hand and is written as a
 * literal. That is deliberate and is the one place docs/TESTING.md §5's "never
 * assert on a hardcoded business number" does not apply: `value` and `mode` are
 * the *inputs under test*, not Settings the suite is reading behind its own
 * back. A test that computed its expectation the way the implementation does
 * would pass for any implementation.
 *
 * Nothing here touches a database, a clock or Settings. The lateness figure
 * arrives as a number because `modules/lateness` already proved it
 * (SPEC §5.3), and the pay figures arrive as `Money` because
 * `modules/ledger/pay-profile` already proved those.
 */

const input = (over: Partial<PenaltyCalculationInput>): PenaltyCalculationInput => ({
  mode: 'FIXED_PER_DAY',
  value: '100.00',
  lateWorkingDays: 1,
  taskValue: null,
  dailyRate: null,
  dailyRateDerivation: null,
  ...over,
})

describe('calculatePenalty — FIXED_PER_DAY', () => {
  it('يضرب القيمة الثابتة في عدد أيام العمل المتأخرة', () => {
    const result = calculatePenalty(
      input({ mode: 'FIXED_PER_DAY', value: '150.00', lateWorkingDays: 3 }),
    )

    expect(result.status).toBe('DUE')
    expect(result.amount).toBe('450.00')
    expect(result.basis).toBe('FIXED')
    expect(result.perDay).toBe(true)
  })

  it('يحتفظ بالكسور: 33.33 × 7 = 233.31', () => {
    const result = calculatePenalty(
      input({ mode: 'FIXED_PER_DAY', value: '33.33', lateWorkingDays: 7 }),
    )

    expect(result.amount).toBe('233.31')
  })

  it('لا يحتاج أساسًا: يعمل بدون قيمة مهمة ولا راتب يومي', () => {
    const result = calculatePenalty(
      input({
        mode: 'FIXED_PER_DAY',
        value: '75.00',
        lateWorkingDays: 2,
        taskValue: null,
        dailyRate: null,
      }),
    )

    expect(result.status).toBe('DUE')
    expect(result.amount).toBe('150.00')
    expect(result.basisAmount).toBeNull()
  })
})

describe('calculatePenalty — FIXED_ONCE', () => {
  it('يخصم القيمة مرة واحدة مهما بلغ التأخير', () => {
    const once = (days: number) =>
      calculatePenalty(
        input({ mode: 'FIXED_ONCE', value: '250.00', lateWorkingDays: days }),
      ).amount

    expect(once(1)).toBe('250.00')
    expect(once(9)).toBe('250.00')
    expect(once(400)).toBe('250.00')
  })

  it('يعلن أنه غير يومي، فلا تعرضه الواجهة مضروبًا في الأيام', () => {
    const result = calculatePenalty(
      input({ mode: 'FIXED_ONCE', value: '250.00', lateWorkingDays: 9 }),
    )

    expect(result.perDay).toBe(false)
    expect(result.lateWorkingDays).toBe(9)
  })
})

describe('calculatePenalty — PCT_TASK_VALUE_PER_DAY', () => {
  it('1200.00 × 5% × 4 أيام = 240.00', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_PER_DAY',
        value: '5',
        lateWorkingDays: 4,
        taskValue: toMoney('1200.00'),
      }),
    )

    expect(result.status).toBe('DUE')
    expect(result.amount).toBe('240.00')
    expect(result.basis).toBe('TASK_VALUE')
    expect(result.basisAmount).toBe('1200.00')
  })

  /**
   * The single-rounding rule from `lib/money`, stated as an assertion.
   * 333.33 × 7.5% = 24.99975 per day. Rounding *that* to 25.00 and then
   * multiplying gives 75.00 as well — so the case is chosen for the next test,
   * where the two disagree.
   */
  it('يقرّب مرة واحدة في النهاية: 333.33 × 7.5% × 3 = 75.00', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_PER_DAY',
        value: '7.5',
        lateWorkingDays: 3,
        taskValue: toMoney('333.33'),
      }),
    )

    expect(result.amount).toBe('75.00')
  })

  it('التقريب على المنتج لا على اليوم: 0.10 × 33% × 3 = 0.10 وليس 0.09', () => {
    // 0.10 × 33% = 0.033 per day. Rounded per-day it would be 0.03 × 3 = 0.09.
    // Rounded once at the end it is 0.099 → 0.10. The second is the rule.
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_PER_DAY',
        value: '33',
        lateWorkingDays: 3,
        taskValue: toMoney('0.10'),
      }),
    )

    expect(result.amount).toBe('0.10')
  })

  it('يقرّب النصف لأعلى: 100.10 × 5% = 5.005 → 5.01', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_PER_DAY',
        value: '5',
        lateWorkingDays: 1,
        taskValue: toMoney('100.10'),
      }),
    )

    expect(result.amount).toBe('5.01')
  })
})

describe('calculatePenalty — PCT_TASK_VALUE_ONCE', () => {
  it('1500.00 × 12.5% = 187.50 مهما بلغ التأخير', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '12.5',
        lateWorkingDays: 11,
        taskValue: toMoney('1500.00'),
      }),
    )

    expect(result.amount).toBe('187.50')
    expect(result.perDay).toBe(false)
  })

  it('999.99 × 3.33% = 33.30', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '3.33',
        lateWorkingDays: 1,
        taskValue: toMoney('999.99'),
      }),
    )

    expect(result.amount).toBe('33.30')
  })
})

describe('calculatePenalty — PCT_DAILY_RATE_PER_DAY', () => {
  it('الراتب اليومي 300.00 × 10% × يومان = 60.00', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '10',
        lateWorkingDays: 2,
        dailyRate: toMoney('300'),
      }),
    )

    expect(result.amount).toBe('60.00')
    expect(result.basis).toBe('DAILY_RATE')
    expect(result.basisAmount).toBe('300.00')
  })

  /**
   * 5000 ÷ 22 is 227.2727… and `modules/ledger/pay-profile` returns it
   * unrounded on purpose. Rounding the daily rate to 227.27 first would give
   * 34.09 here too — so the assertion below is on the third decimal place
   * surviving into the product, which the next case makes visible.
   */
  it('يستخدم الراتب اليومي غير المقرَّب: (5000 ÷ 22) × 5% × 3 = 34.09', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '5',
        lateWorkingDays: 3,
        dailyRate: toMoney(5000).dividedBy(22),
      }),
    )

    expect(result.amount).toBe('34.09')
  })

  it('الفرق بين التقريب المبكر والمتأخر يظهر: (1000 ÷ 3) × 100% × 3 = 1000.00', () => {
    // 333.333… × 3 is exactly 1000. Rounding the daily rate to 333.33 first
    // would produce 999.99 — one piastre the منفّذ never owed.
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '100',
        lateWorkingDays: 3,
        dailyRate: toMoney(1000).dividedBy(3),
      }),
    )

    expect(result.amount).toBe('1000.00')
  })

  it('يحمل اشتقاق الراتب اليومي ليكون الحساب قابلًا للإعادة يدويًا', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '5',
        lateWorkingDays: 3,
        dailyRate: toMoney(5000).dividedBy(22),
        dailyRateDerivation: { monthlySalary: '5000.00', workingDaysPerMonth: 22 },
      }),
    )

    // The منفّذ is shown "5000.00 ÷ 22", not "227.27", precisely so that
    // reproducing the arithmetic by hand lands on the same 34.09.
    expect(result.basisDerivation).toEqual({
      monthlySalary: '5000.00',
      workingDaysPerMonth: 22,
    })
  })
})

describe('calculatePenalty — لا تأخير، لا خصم', () => {
  it.each([0, -1, -40])('صفر أيام (%i) لا ينتج خصمًا', (days) => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_PER_DAY',
        value: '5',
        lateWorkingDays: days,
        taskValue: toMoney('1000.00'),
      }),
    )

    expect(result.status).toBe('NOT_LATE')
    expect(result.amount).toBe('0.00')
  })

  it('يعامل التأخير السالب كصفر ولا يقلبه إلى مكافأة', () => {
    const result = calculatePenalty(
      input({ mode: 'FIXED_PER_DAY', value: '100.00', lateWorkingDays: -3 }),
    )

    expect(result.amount).toBe('0.00')
    expect(Number(result.amount)).toBeGreaterThanOrEqual(0)
  })

  it('قيمة صفر في البروفايل تعني "لا خصومات على هذا الشخص"', () => {
    const result = calculatePenalty(
      input({ mode: 'FIXED_PER_DAY', value: '0', lateWorkingDays: 5 }),
    )

    expect(result.status).toBe('ZERO')
    expect(result.amount).toBe('0.00')
  })

  it('يقرّر ZERO حتى لو كان الأساس موجودًا والنسبة صفرًا', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_PER_DAY',
        value: '0',
        lateWorkingDays: 5,
        taskValue: toMoney('1000.00'),
      }),
    )

    expect(result.status).toBe('ZERO')
    expect(result.amount).toBe('0.00')
  })
})

describe('calculatePenalty — لا سقف للخصم (متعمَّد)', () => {
  it('لا يقصّ الخصم مهما تجاوز قيمة المهمة', () => {
    // 40 working days late on a task worth 500, at 5% a day, is four times the
    // task's whole value. SPEC §5.4: "No cap." The payout floors at zero and
    // the surplus carries — that is the payout's job, not this function's.
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_PER_DAY',
        value: '5',
        lateWorkingDays: 40,
        taskValue: toMoney('500.00'),
      }),
    )

    expect(result.amount).toBe('1000.00')
  })

  it('يقبل نسبة أكبر من 100%', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '150',
        lateWorkingDays: 1,
        taskValue: toMoney('1000.00'),
      }),
    )

    expect(result.amount).toBe('1500.00')
  })

  it('لا يقصّ خصمًا كبيرًا جدًا: 1000/يوم × 400 يوم = 400000.00', () => {
    const result = calculatePenalty(
      input({ mode: 'FIXED_PER_DAY', value: '1000.00', lateWorkingDays: 400 }),
    )

    expect(result.amount).toBe('400000.00')
  })
})

describe('calculatePenalty — الأساس غير القابل للحل', () => {
  it('نسبة من قيمة مهمة بلا قيمة مهمة ولا راتب: NO_BASIS وليس صفرًا صامتًا', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_PER_DAY',
        value: '5',
        lateWorkingDays: 6,
        taskValue: null,
        dailyRate: null,
      }),
    )

    expect(result.status).toBe('NO_BASIS')
    expect(result.amount).toBe('0.00')
    // Which figure was missing, so the audit row can say it out loud.
    expect(result.wantedBasis).toBe('TASK_VALUE')
  })

  it('نسبة من الراتب اليومي بلا راتب ولا قيمة مهمة: NO_BASIS', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_DAILY_RATE_PER_DAY',
        value: '5',
        lateWorkingDays: 6,
        taskValue: null,
        dailyRate: null,
      }),
    )

    expect(result.status).toBe('NO_BASIS')
    expect(result.wantedBasis).toBe('DAILY_RATE')
  })

  it('قيمة مهمة صفر ليست أساسًا صالحًا', () => {
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '5',
        lateWorkingDays: 6,
        taskValue: toMoney('0.00'),
        dailyRate: null,
      }),
    )

    expect(result.status).toBe('NO_BASIS')
  })
})
