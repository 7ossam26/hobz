import { describe, expect, it } from 'vitest'

import { toStorageString } from '@/lib/money'
import type { PayProfile } from '@/modules/ledger/pay-profile'
import { payBasesFor, resolveBasis } from '@/modules/penalty/basis'
import { calculatePenalty } from '@/modules/penalty/calculate'

/**
 * Which figure the percentage applies to — the phase brief's last test:
 *
 *   > Penalty on a salaried worker uses dailyRate; on a per-task worker uses
 *   > taskValue; on a HYBRID worker resolves per the task type.
 *
 * ── Why this needs resolving at all ───────────────────────────────────────
 *
 * SPEC §5.4's modes each name their own basis, and Settings holds **one**
 * default mode for the whole agency. So the moment an agency of mixed
 * engagements picks `PCT_TASK_VALUE_PER_DAY` as its default — which is the
 * shipped default — every salaried منفّذ's deduction would come out of a
 * `taskValue` their work does not carry, and land on zero. A zero deduction
 * that looks exactly like a correct one is the failure mode `lib/calendar` was
 * stubbed as *throwing* to avoid (Phase 0), and it is the failure mode this
 * product exists to abolish.
 *
 * So a basis is **available** or it is not, and the rule for availability is
 * one this codebase already committed to in `modules/ledger/pay-profile`:
 *
 *  - a `taskValue` basis exists only for someone who `earnsPerTask`,
 *  - a `dailyRate` basis exists only for someone who `isSalaried`,
 *  - and zero is not a basis — a percentage of nothing is nothing.
 *
 * The mode states a *preference*; where that preference is unavailable and the
 * other basis is, the other one is used and `basisFallback` says so out loud,
 * so nobody has to guess afterwards which number was multiplied.
 */

const WORKING_DAYS_PER_MONTH = 22

const salaried: PayProfile = {
  payType: 'SALARY',
  monthlySalary: '6600.00',
  defaultTaskRate: null,
}

const perTask: PayProfile = {
  payType: 'PER_TASK',
  monthlySalary: null,
  defaultTaskRate: '500.00',
}

const hybrid: PayProfile = {
  payType: 'HYBRID',
  monthlySalary: '6600.00',
  defaultTaskRate: '500.00',
}

describe('payBasesFor — أي رقم يملكه هذا المنفّذ أصلًا', () => {
  it('الموظف بالراتب: راتب يومي فقط، ولو كانت المهمة تحمل قيمة', () => {
    const bases = payBasesFor(salaried, '900.00', WORKING_DAYS_PER_MONTH)

    expect(bases.dailyRate && toStorageString(bases.dailyRate)).toBe('300.00')
    // Not `900.00`: a salaried منفّذ is not paid per task, so the number on the
    // task is not a figure they earn and must not be a figure they are docked.
    expect(bases.taskValue).toBeNull()
  })

  it('المنفّذ بالمهمة: قيمة المهمة فقط، ولا راتب يومي', () => {
    const bases = payBasesFor(perTask, '900.00', WORKING_DAYS_PER_MONTH)

    expect(bases.taskValue && toStorageString(bases.taskValue)).toBe('900.00')
    expect(bases.dailyRate).toBeNull()
  })

  it('المختلط: الاثنان متاحان، فالمهمة هي التي تحسم', () => {
    const bases = payBasesFor(hybrid, '900.00', WORKING_DAYS_PER_MONTH)

    expect(bases.taskValue && toStorageString(bases.taskValue)).toBe('900.00')
    expect(bases.dailyRate && toStorageString(bases.dailyRate)).toBe('300.00')
  })

  it('قيمة مهمة صفر ليست أساسًا — نسبة من لا شيء لا شيء', () => {
    const bases = payBasesFor(perTask, '0.00', WORKING_DAYS_PER_MONTH)

    expect(bases.taskValue).toBeNull()
  })

  it('راتب غير مسجَّل لا يصير صفرًا', () => {
    const bases = payBasesFor(
      { payType: 'SALARY', monthlySalary: null, defaultTaskRate: null },
      '500.00',
      WORKING_DAYS_PER_MONTH,
    )

    expect(bases.dailyRate).toBeNull()
  })
})

describe('resolveBasis — الأفضلية ثم البديل', () => {
  it('الوضع الثابت لا يطلب أساسًا إطلاقًا', () => {
    const resolved = resolveBasis('FIXED_ONCE', {
      taskValue: null,
      dailyRate: null,
      dailyRateDerivation: null,
    })

    expect(resolved.basis).toBe('FIXED')
    expect(resolved.available).toBe(true)
    expect(resolved.fallback).toBe(false)
  })

  it('يأخذ أساس الوضع حين يكون متاحًا', () => {
    const bases = payBasesFor(hybrid, '900.00', WORKING_DAYS_PER_MONTH)

    expect(resolveBasis('PCT_TASK_VALUE_PER_DAY', bases).basis).toBe('TASK_VALUE')
    expect(resolveBasis('PCT_DAILY_RATE_PER_DAY', bases).basis).toBe('DAILY_RATE')
  })

  it('يسقط إلى الأساس الآخر ويعلن ذلك', () => {
    const bases = payBasesFor(salaried, '900.00', WORKING_DAYS_PER_MONTH)
    const resolved = resolveBasis('PCT_TASK_VALUE_PER_DAY', bases)

    expect(resolved.basis).toBe('DAILY_RATE')
    expect(resolved.fallback).toBe(true)
  })

  it('لا أساس أصلًا: غير متاح، مع تسمية ما كان مطلوبًا', () => {
    const resolved = resolveBasis('PCT_TASK_VALUE_ONCE', {
      taskValue: null,
      dailyRate: null,
      dailyRateDerivation: null,
    })

    expect(resolved.available).toBe(false)
    expect(resolved.wanted).toBe('TASK_VALUE')
  })
})

describe('الخصم على كل نوع أجر — من طرف إلى طرف', () => {
  const DEFAULT_MODE = 'PCT_TASK_VALUE_PER_DAY'
  const VALUE = '10'
  const DAYS = 2

  const charge = (profile: PayProfile, taskValue: string | null) => {
    const bases = payBasesFor(profile, taskValue, WORKING_DAYS_PER_MONTH)
    return calculatePenalty({
      mode: DEFAULT_MODE,
      value: VALUE,
      lateWorkingDays: DAYS,
      ...bases,
    })
  }

  it('الموظف بالراتب يُخصم من راتبه اليومي: 300.00 × 10% × 2 = 60.00', () => {
    const result = charge(salaried, '900.00')

    expect(result.basis).toBe('DAILY_RATE')
    expect(result.basisFallback).toBe(true)
    expect(result.amount).toBe('60.00')
  })

  it('المنفّذ بالمهمة يُخصم من قيمة المهمة: 900.00 × 10% × 2 = 180.00', () => {
    const result = charge(perTask, '900.00')

    expect(result.basis).toBe('TASK_VALUE')
    expect(result.basisFallback).toBe(false)
    expect(result.amount).toBe('180.00')
  })

  it('المختلط على مهمة لها قيمة: قيمة المهمة', () => {
    const result = charge(hybrid, '900.00')

    expect(result.basis).toBe('TASK_VALUE')
    expect(result.amount).toBe('180.00')
  })

  it('المختلط على مهمة بلا قيمة: الراتب اليومي', () => {
    // The same person, the same profile, the same mode — the *task* decides.
    const result = charge(hybrid, '0.00')

    expect(result.basis).toBe('DAILY_RATE')
    expect(result.basisFallback).toBe(true)
    expect(result.amount).toBe('60.00')
  })

  it('الوضع المعتمد على الراتب على منفّذ بالمهمة يسقط لقيمة المهمة', () => {
    const bases = payBasesFor(perTask, '900.00', WORKING_DAYS_PER_MONTH)
    const result = calculatePenalty({
      mode: 'PCT_DAILY_RATE_PER_DAY',
      value: VALUE,
      lateWorkingDays: DAYS,
      ...bases,
    })

    expect(result.basis).toBe('TASK_VALUE')
    expect(result.basisFallback).toBe(true)
    expect(result.amount).toBe('180.00')
  })

  it('منفّذ بلا راتب وبلا قيمة مهمة: لا خصم، ويُقال السبب', () => {
    const result = charge(perTask, null)

    expect(result.status).toBe('NO_BASIS')
    expect(result.amount).toBe('0.00')
  })

  it('الوضع الثابت يخصم من الجميع بالتساوي مهما كان نوع الأجر', () => {
    const fixed = (profile: PayProfile) =>
      calculatePenalty({
        mode: 'FIXED_PER_DAY',
        value: '80.00',
        lateWorkingDays: DAYS,
        ...payBasesFor(profile, null, WORKING_DAYS_PER_MONTH),
      }).amount

    expect(fixed(salaried)).toBe('160.00')
    expect(fixed(perTask)).toBe('160.00')
    expect(fixed(hybrid)).toBe('160.00')
  })
})
