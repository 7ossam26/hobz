import { describe, expect, it } from 'vitest'

import { DomainError } from '@/lib/errors'
import {
  assertTransition,
  BLOCKABLE_STATUSES,
  canTransition,
  FINAL_STATUSES,
  isFinal,
  nextStatuses,
  stampTimestamps,
  TASK_STATUSES,
  timestampRuleFor,
  type TaskStatus,
  type TaskTimestamps,
} from '@/modules/task/state-machine'

/**
 * SPEC §5.1, exhaustively. Written before `state-machine.ts` existed
 * (docs/TESTING.md §5: "tests first" for the state machine).
 *
 * The matrix below is the specification restated as data — all 100 ordered
 * pairs of the 10 statuses — so that "only the transitions in SPEC §5.1 are
 * legal" is proven by enumeration rather than by spot-checking the handful of
 * illegal moves someone thought of.
 */

const EXPECTED_LEGAL: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  BACKLOG: ['ASSIGNED', 'BLOCKED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['SUBMITTED', 'BLOCKED', 'CANCELLED'],
  SUBMITTED: ['IN_REVIEW', 'BLOCKED', 'CANCELLED'],
  IN_REVIEW: ['APPROVED', 'REVISION_REQUESTED', 'BLOCKED', 'CANCELLED'],
  REVISION_REQUESTED: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  APPROVED: ['DONE', 'CANCELLED'],
  DONE: [],
  // `BLOCKED → previous` needs the recorded previous status; without it the
  // only way out is cancellation.
  BLOCKED: ['CANCELLED'],
  CANCELLED: [],
}

const NO_TIMESTAMPS: TaskTimestamps = {
  assignedAt: null,
  startedAt: null,
  submittedAt: null,
  approvedAt: null,
}

const T0 = new Date('2026-03-01T09:00:00.000Z')
const T1 = new Date('2026-03-05T11:30:00.000Z')

describe('modules/task/state-machine — مصفوفة الانتقالات (SPEC §5.1)', () => {
  it('يسمح بالانتقالات المنصوص عليها فقط ويمنع كل ما عداها', () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        const expected = EXPECTED_LEGAL[from].includes(to)

        expect(
          canTransition(from, to),
          `expected ${from} → ${to} to be ${expected ? 'legal' : 'illegal'}`,
        ).toBe(expected)
      }
    }
  })

  it('يرفع DomainError مكتوب النوع عند كل انتقال غير قانوني', () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        if (EXPECTED_LEGAL[from].includes(to)) continue

        expect(() => assertTransition(from, to)).toThrowError(DomainError)
      }
    }
  })

  it('يحمل الخطأ مفتاح الترجمة والحالتين في التفاصيل', () => {
    let thrown: DomainError | null = null
    try {
      assertTransition('BACKLOG', 'SUBMITTED')
    } catch (error) {
      thrown = error as DomainError
    }

    expect(thrown?.code).toBe('DOMAIN')
    expect(thrown?.messageKey).toBe('tasks.errors.illegalTransition')
    expect(thrown?.details).toEqual({ from: 'BACKLOG', to: 'SUBMITTED' })
  })

  it('لا يسمح بانتقال الحالة إلى نفسها', () => {
    for (const status of TASK_STATUSES) {
      expect(canTransition(status, status)).toBe(false)
    }
  })

  it('يمنع أي انتقال خارج الحالتين النهائيتين', () => {
    for (const status of FINAL_STATUSES) {
      expect(isFinal(status)).toBe(true)
      expect(nextStatuses(status)).toEqual([])
    }
  })

  it('يعيد قائمة الانتقالات المتاحة من كل حالة', () => {
    for (const from of TASK_STATUSES) {
      expect(nextStatuses(from).sort()).toEqual([...EXPECTED_LEGAL[from]].sort())
    }
  })
})

describe('modules/task/state-machine — المسار الكامل والدورة التصحيحية', () => {
  it('يمرّ بالمسار الرئيسي من قائمة الانتظار حتى الإنهاء', () => {
    const happyPath: TaskStatus[] = [
      'BACKLOG',
      'ASSIGNED',
      'IN_PROGRESS',
      'SUBMITTED',
      'IN_REVIEW',
      'APPROVED',
      'DONE',
    ]

    for (let i = 0; i < happyPath.length - 1; i += 1) {
      expect(() =>
        assertTransition(happyPath[i] as TaskStatus, happyPath[i + 1] as TaskStatus),
      ).not.toThrow()
    }
  })

  it('يسمح بتكرار دورة طلب التعديل بلا حد', () => {
    const revisionCycle: TaskStatus[] = [
      'IN_REVIEW',
      'REVISION_REQUESTED',
      'IN_PROGRESS',
      'SUBMITTED',
      'IN_REVIEW',
      'REVISION_REQUESTED',
      'IN_PROGRESS',
      'SUBMITTED',
      'IN_REVIEW',
      'APPROVED',
    ]

    for (let i = 0; i < revisionCycle.length - 1; i += 1) {
      expect(
        canTransition(revisionCycle[i] as TaskStatus, revisionCycle[i + 1] as TaskStatus),
      ).toBe(true)
    }
  })

  it('يمنع تخطّي مرحلة في المسار الرئيسي', () => {
    const skips: Array<[TaskStatus, TaskStatus]> = [
      ['BACKLOG', 'IN_PROGRESS'],
      ['ASSIGNED', 'SUBMITTED'],
      ['IN_PROGRESS', 'IN_REVIEW'],
      ['IN_PROGRESS', 'APPROVED'],
      ['SUBMITTED', 'APPROVED'],
      ['IN_REVIEW', 'DONE'],
      ['BACKLOG', 'DONE'],
    ]

    for (const [from, to] of skips) {
      expect(() => assertTransition(from, to)).toThrowError(DomainError)
    }
  })

  it('يمنع الرجوع للخلف في المسار الرئيسي', () => {
    const backwards: Array<[TaskStatus, TaskStatus]> = [
      ['ASSIGNED', 'BACKLOG'],
      ['IN_PROGRESS', 'ASSIGNED'],
      ['SUBMITTED', 'IN_PROGRESS'],
      ['IN_REVIEW', 'SUBMITTED'],
      ['APPROVED', 'IN_REVIEW'],
      ['DONE', 'APPROVED'],
    ]

    for (const [from, to] of backwards) {
      expect(() => assertTransition(from, to)).toThrowError(DomainError)
    }
  })

  it('لا يعيد مهمة معتمدة إلى التعديل — الاعتماد يصرف المستحق', () => {
    expect(canTransition('APPROVED', 'REVISION_REQUESTED')).toBe(false)
    expect(canTransition('APPROVED', 'IN_PROGRESS')).toBe(false)
    expect(canTransition('APPROVED', 'SUBMITTED')).toBe(false)
  })
})

describe('modules/task/state-machine — التعليق والاستئناف', () => {
  it('يسمح بتعليق أي مهمة قيد العمل', () => {
    for (const status of BLOCKABLE_STATUSES) {
      expect(canTransition(status, 'BLOCKED')).toBe(true)
    }
  })

  it('يمنع تعليق المهام المعتمدة والمنتهية والملغاة والمعلَّقة أصلًا', () => {
    for (const status of ['APPROVED', 'DONE', 'CANCELLED', 'BLOCKED'] as TaskStatus[]) {
      expect(canTransition(status, 'BLOCKED')).toBe(false)
    }
  })

  it('يعيد المهمة المعلَّقة إلى حالتها السابقة فقط', () => {
    for (const previousStatus of BLOCKABLE_STATUSES) {
      expect(canTransition('BLOCKED', previousStatus, { previousStatus })).toBe(true)

      for (const other of BLOCKABLE_STATUSES) {
        if (other === previousStatus) continue
        expect(canTransition('BLOCKED', other, { previousStatus })).toBe(false)
      }
    }
  })

  it('يمنع الاستئناف بلا حالة سابقة مسجَّلة', () => {
    expect(canTransition('BLOCKED', 'IN_PROGRESS')).toBe(false)
    expect(canTransition('BLOCKED', 'IN_PROGRESS', { previousStatus: null })).toBe(false)
    expect(() => assertTransition('BLOCKED', 'IN_PROGRESS')).toThrowError(DomainError)
  })

  it('يظل الإلغاء متاحًا من التعليق مهما كانت الحالة السابقة', () => {
    expect(canTransition('BLOCKED', 'CANCELLED')).toBe(true)
    expect(canTransition('BLOCKED', 'CANCELLED', { previousStatus: 'IN_PROGRESS' })).toBe(
      true,
    )
  })

  it('لا تُستأنف المهمة إلى حالة نهائية أو إلى التعليق نفسه', () => {
    expect(canTransition('BLOCKED', 'BLOCKED', { previousStatus: 'IN_PROGRESS' })).toBe(
      false,
    )
    expect(canTransition('BLOCKED', 'DONE', { previousStatus: 'APPROVED' })).toBe(false)
  })

  it('لا يغيّر سياق الحالة السابقة قانونية الانتقالات من حالات أخرى', () => {
    // `previousStatus` is meaningful only when leaving BLOCKED. A stale context
    // must not, for instance, make SUBMITTED → IN_PROGRESS suddenly legal.
    expect(
      canTransition('SUBMITTED', 'IN_PROGRESS', { previousStatus: 'IN_PROGRESS' }),
    ).toBe(false)
  })
})

describe('modules/task/state-machine — الإلغاء', () => {
  it('يسمح بإلغاء كل مهمة غير منتهية', () => {
    const cancellable = TASK_STATUSES.filter((s) => !isFinal(s))

    for (const status of cancellable) {
      expect(canTransition(status, 'CANCELLED')).toBe(true)
    }
  })

  it('يمنع إلغاء مهمة منتهية أو ملغاة مسبقًا', () => {
    expect(canTransition('DONE', 'CANCELLED')).toBe(false)
    expect(canTransition('CANCELLED', 'CANCELLED')).toBe(false)
  })
})

describe('modules/task/state-machine — ختم الأوقات (SPEC §5.1)', () => {
  it('يختم assignedAt عند أول دخول لحالة الإسناد', () => {
    expect(stampTimestamps('ASSIGNED', NO_TIMESTAMPS, T0)).toEqual({ assignedAt: T0 })
  })

  it('لا يعيد ختم assignedAt إذا كان مختومًا', () => {
    const current = { ...NO_TIMESTAMPS, assignedAt: T0 }

    expect(stampTimestamps('ASSIGNED', current, T1)).toEqual({})
  })

  it('يختم startedAt مرة واحدة فقط — العودة من التعديل لا تعيد ختمه', () => {
    expect(stampTimestamps('IN_PROGRESS', NO_TIMESTAMPS, T0)).toEqual({ startedAt: T0 })

    const afterFirstStart = { ...NO_TIMESTAMPS, startedAt: T0 }
    expect(stampTimestamps('IN_PROGRESS', afterFirstStart, T1)).toEqual({})
  })

  it('يختم approvedAt مرة واحدة فقط', () => {
    expect(stampTimestamps('APPROVED', NO_TIMESTAMPS, T0)).toEqual({ approvedAt: T0 })

    const afterApproval = { ...NO_TIMESTAMPS, approvedAt: T0 }
    expect(stampTimestamps('APPROVED', afterApproval, T1)).toEqual({})
  })

  /**
   * The one deliberate exception, SPEC §5.1: "`submittedAt` is stamped on entry
   * to SUBMITTED, and frozen — later revisions stamp `submittedAt` again but
   * the original is preserved in `TaskActivity`." The column tracks the latest
   * delivery (which is what the current revision's lateness is measured
   * against); the activity feed keeps the first one.
   */
  it('يعيد ختم submittedAt عند كل تسليم — الأصلي محفوظ في سجل المهمة', () => {
    expect(stampTimestamps('SUBMITTED', NO_TIMESTAMPS, T0)).toEqual({ submittedAt: T0 })

    const afterFirstSubmission = { ...NO_TIMESTAMPS, submittedAt: T0 }
    expect(stampTimestamps('SUBMITTED', afterFirstSubmission, T1)).toEqual({
      submittedAt: T1,
    })
  })

  it('لا يختم شيئًا للحالات التي لا وقت لها', () => {
    const stampless: TaskStatus[] = [
      'BACKLOG',
      'IN_REVIEW',
      'REVISION_REQUESTED',
      'DONE',
      'BLOCKED',
      'CANCELLED',
    ]

    for (const status of stampless) {
      expect(timestampRuleFor(status)).toBeNull()
      expect(stampTimestamps(status, NO_TIMESTAMPS, T0)).toEqual({})
    }
  })

  it('يصف قاعدة الختم لكل حالة لها وقت', () => {
    expect(timestampRuleFor('ASSIGNED')).toEqual({
      field: 'assignedAt',
      overwrite: false,
    })
    expect(timestampRuleFor('IN_PROGRESS')).toEqual({
      field: 'startedAt',
      overwrite: false,
    })
    expect(timestampRuleFor('SUBMITTED')).toEqual({
      field: 'submittedAt',
      overwrite: true,
    })
    expect(timestampRuleFor('APPROVED')).toEqual({
      field: 'approvedAt',
      overwrite: false,
    })
  })

  it('لا يمسّ ختم حالة أوقات الحالات الأخرى', () => {
    const current: TaskTimestamps = {
      assignedAt: T0,
      startedAt: T0,
      submittedAt: null,
      approvedAt: null,
    }

    const patch = stampTimestamps('SUBMITTED', current, T1)

    expect(patch).toEqual({ submittedAt: T1 })
    expect(Object.keys(patch)).toEqual(['submittedAt'])
  })
})
