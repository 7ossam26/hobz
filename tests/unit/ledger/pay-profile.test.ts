import { describe, expect, it } from 'vitest'

import { getSetting } from '@/lib/settings'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import {
  dailyRate,
  earnsPerTask,
  effectiveTaskRate,
  isSalaried,
  monthlySalaryOf,
} from '@/modules/ledger/pay-profile'

import { buildHybridUser, buildSalariedUser, buildUser } from '../../factories/user'

/**
 * SPEC §5.4: `dailyRate(user) = monthlySalary ÷ settings.workingDaysPerMonth`.
 *
 * The divisor is read from the catalog rather than written as `22`, per
 * docs/TESTING.md §5: "never assert on a hardcoded business number; read it
 * from Settings in the test too, so a Settings change doesn't silently break
 * the suite's meaning."
 */
const workingDaysPerMonth = SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default

describe('modules/ledger/pay-profile — نوع الأجر', () => {
  it('يميّز من يتقاضى راتبًا شهريًا', () => {
    expect(isSalaried(buildSalariedUser())).toBe(true)
    expect(isSalaried(buildHybridUser())).toBe(true)
    expect(isSalaried(buildUser({ payType: 'PER_TASK' }))).toBe(false)
  })

  it('يميّز من يتقاضى بالمهمة', () => {
    expect(earnsPerTask(buildUser({ payType: 'PER_TASK' }))).toBe(true)
    expect(earnsPerTask(buildHybridUser())).toBe(true)
    expect(earnsPerTask(buildSalariedUser())).toBe(false)
  })

  it('المختلط يجمع الاثنين', () => {
    const hybrid = buildHybridUser()
    expect(isSalaried(hybrid) && earnsPerTask(hybrid)).toBe(true)
  })
})

describe('modules/ledger/pay-profile — أجر اليوم', () => {
  it('يقسم الراتب الشهري على أيام العمل في الشهر', () => {
    const user = buildSalariedUser({ monthlySalary: '11000.00' })
    const rate = dailyRate(user, workingDaysPerMonth)

    expect(rate).not.toBeNull()
    // 11000 ÷ 22 = 500 exactly, whatever the setting says about the divisor.
    expect(rate?.toFixed(2)).toBe((11000 / workingDaysPerMonth).toFixed(2))
  })

  it('لا يقرّب القيمة الوسيطة — التقريب مرة واحدة عند الحفظ', () => {
    // 10000 ÷ 22 = 454.5454…; SPEC §5.4 multiplies this by a percentage and by
    // a day count before anything is persisted, so rounding here would drift.
    const user = buildSalariedUser({ monthlySalary: '10000.00' })
    const rate = dailyRate(user, 22)

    expect(rate?.toFixed(6)).toBe('454.545455')
    expect(rate?.toFixed(2)).toBe('454.55')
  })

  it('يعيد null لمن لا راتب شهري له — لا صفرًا', () => {
    // A zero would silently become a zero penalty under
    // PCT_DAILY_RATE_PER_DAY (SPEC §5.4) and look like a correct answer.
    expect(dailyRate(buildUser({ payType: 'PER_TASK' }), workingDaysPerMonth)).toBeNull()
    expect(
      dailyRate(buildSalariedUser({ monthlySalary: null }), workingDaysPerMonth),
    ).toBeNull()
  })

  it('يرفض قسمة على صفر أو على عدد سالب من الأيام', () => {
    const user = buildSalariedUser()
    expect(() => dailyRate(user, 0)).toThrow(RangeError)
    expect(() => dailyRate(user, -1)).toThrow(RangeError)
  })

  it('راتب صفر يعطي أجر يوم صفرًا وليس null', () => {
    const rate = dailyRate(
      buildSalariedUser({ monthlySalary: '0.00' }),
      workingDaysPerMonth,
    )
    expect(rate?.toFixed(2)).toBe('0.00')
  })

  it('يقرأ المقسوم عليه من الإعدادات فعليًا', async () => {
    // The accessor must resolve to the same number the assertions above used.
    expect(await getSetting('calendar.workingDaysPerMonth')).toBe(workingDaysPerMonth)
  })
})

describe('modules/ledger/pay-profile — قيمة المهمة والراتب', () => {
  it('يعيد سعر المهمة الافتراضي لمن يتقاضى بالمهمة', () => {
    const user = buildUser({ payType: 'PER_TASK', defaultTaskRate: '750.00' })
    expect(effectiveTaskRate(user)?.toFixed(2)).toBe('750.00')
  })

  it('يعيد null لمن لا سعر مهمة له', () => {
    expect(effectiveTaskRate(buildSalariedUser())).toBeNull()
  })

  it('يعيد الراتب الشهري كـ Money وليس نصًا', () => {
    const salary = monthlySalaryOf(buildSalariedUser({ monthlySalary: '11000.00' }))
    expect(salary?.toFixed(2)).toBe('11000.00')
    expect(monthlySalaryOf(buildUser({ monthlySalary: null }))).toBeNull()
  })
})
