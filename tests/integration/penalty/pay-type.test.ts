import { describe, expect, it } from 'vitest'

import { SETTINGS_CATALOG } from '@/lib/settings/catalog'

import {
  createPenaltyProfile,
  createProject,
  createTask,
  createUser,
} from '../../factories/db'
import { recompute } from '../../helpers/penalty'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * The phase brief's last named test:
 *
 *   > Penalty on a salaried worker uses dailyRate; on a per-task worker uses
 *   > taskValue; on a HYBRID worker resolves per the task type.
 *
 * `tests/unit/penalty/basis.test.ts` proves the resolution rule in isolation
 * and explains why it exists. This file proves it survives the round trip
 * through Prisma's `Decimal` columns and the organization's *actual* default mode —
 * which is the version that decides real deductions.
 *
 * ── The worked numbers ────────────────────────────────────────────────────
 *
 *   working days per month  22 (Settings)
 *   monthly salary          6,600.00 → daily rate 300.00
 *   task value              1,000.00
 *   lateness                3 working days (the canonical scenario)
 *   default mode            PCT_TASK_VALUE_PER_DAY at 5%
 *
 *   per-task   1,000.00 × 5% × 3 = 150.00
 *   salaried     300.00 × 5% × 3 =  45.00
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NOW = cairo('2026-03-05T12:00')

const WORKING_DAYS_PER_MONTH = SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default
const SALARY = '6600.00'

async function lateTaskFor(worker: { id: string }, options: { taskValue?: string } = {}) {
  const owner = await createUser(db)
  const project = await createProject(db, { ownerId: owner.id })
  return createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'IN_PROGRESS',
    taskValue: options.taskValue ?? '1000.00',
    dueDate: DUE,
    originalDueDate: DUE,
  })
}

describe('الخصم بحسب نوع أجر المنفّذ', () => {
  it('الموظف بالراتب يُخصم من راتبه اليومي', async () => {
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: SALARY,
      defaultTaskRate: null,
    })
    const task = await lateTaskFor(worker)

    const outcome = await recompute(db, task.id, { now: NOW })

    expect(outcome.breakdown?.basis).toBe('DAILY_RATE')
    expect(outcome.breakdown?.basisAmount).toBe('300.00')
    expect(outcome.amount).toBe('45.00')
    // The daily rate is shown as its derivation, so the arithmetic reproduces
    // by hand even when the quotient does not land on two decimals.
    expect(outcome.breakdown?.formula).toContain(`÷ ${String(WORKING_DAYS_PER_MONTH)}`)
  })

  it('قيمة المهمة لا تُخصم من موظف بالراتب حتى لو كانت مسجَّلة', async () => {
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: SALARY,
      defaultTaskRate: null,
    })
    const task = await lateTaskFor(worker, { taskValue: '9000.00' })

    const outcome = await recompute(db, task.id, { now: NOW })

    // 9,000 × 5% × 3 would be 1,350.00 — a month and a half of pay, from a
    // figure this person does not earn.
    expect(outcome.amount).toBe('45.00')
  })

  it('المنفّذ بالمهمة يُخصم من قيمة المهمة', async () => {
    const worker = await createUser(db, {
      payType: 'PER_TASK',
      monthlySalary: null,
      defaultTaskRate: '500.00',
    })
    const task = await lateTaskFor(worker)

    const outcome = await recompute(db, task.id, { now: NOW })

    expect(outcome.breakdown?.basis).toBe('TASK_VALUE')
    expect(outcome.breakdown?.basisAmount).toBe('1000.00')
    expect(outcome.amount).toBe('150.00')
  })

  it('المختلط على مهمة لها قيمة: قيمة المهمة', async () => {
    const worker = await createUser(db, {
      payType: 'HYBRID',
      monthlySalary: SALARY,
      defaultTaskRate: '500.00',
    })
    const task = await lateTaskFor(worker)

    const outcome = await recompute(db, task.id, { now: NOW })

    expect(outcome.breakdown?.basis).toBe('TASK_VALUE')
    expect(outcome.amount).toBe('150.00')
  })

  it('المختلط على مهمة بلا قيمة: الراتب اليومي', async () => {
    const worker = await createUser(db, {
      payType: 'HYBRID',
      monthlySalary: SALARY,
      defaultTaskRate: '500.00',
    })
    const task = await lateTaskFor(worker, { taskValue: '0.00' })

    const outcome = await recompute(db, task.id, { now: NOW })

    expect(outcome.breakdown?.basis).toBe('DAILY_RATE')
    expect(outcome.amount).toBe('45.00')
  })

  it('وضع الراتب اليومي على منفّذ بالمهمة يسقط لقيمة المهمة ويقول ذلك', async () => {
    const profile = await createPenaltyProfile(db, {
      mode: 'PCT_DAILY_RATE_PER_DAY',
      value: '5.00',
    })
    const worker = await createUser(db, {
      payType: 'PER_TASK',
      monthlySalary: null,
      defaultTaskRate: '500.00',
      penaltyProfileId: profile.id,
    })
    const task = await lateTaskFor(worker)

    const outcome = await recompute(db, task.id, { now: NOW })

    expect(outcome.breakdown?.basis).toBe('TASK_VALUE')
    expect(outcome.breakdown?.basisFallback).toBe(true)
    expect(outcome.amount).toBe('150.00')
  })

  it('الوضع الثابت يخصم بالتساوي من كل أنواع الأجر', async () => {
    const profile = await createPenaltyProfile(db, {
      mode: 'FIXED_PER_DAY',
      value: '60.00',
    })
    const amounts: string[] = []

    for (const payType of ['SALARY', 'PER_TASK', 'HYBRID'] as const) {
      const worker = await createUser(db, {
        payType,
        monthlySalary: payType === 'PER_TASK' ? null : SALARY,
        defaultTaskRate: payType === 'SALARY' ? null : '500.00',
        penaltyProfileId: profile.id,
      })
      const task = await lateTaskFor(worker)
      amounts.push((await recompute(db, task.id, { now: NOW })).amount)
    }

    expect(amounts).toEqual(['180.00', '180.00', '180.00'])
  })

  it('راتب لا يقبل القسمة بلا كسر: يُقرَّب مرة واحدة في النهاية', async () => {
    // 5,000 ÷ 22 = 227.2727…; × 5% × 3 = 34.0909… → 34.09.
    const worker = await createUser(db, {
      payType: 'SALARY',
      monthlySalary: '5000.00',
      defaultTaskRate: null,
    })
    const task = await lateTaskFor(worker)

    const outcome = await recompute(db, task.id, { now: NOW })

    expect(outcome.amount).toBe('34.09')
    expect(outcome.breakdown?.formula).toContain('5,000.00')
  })
})
