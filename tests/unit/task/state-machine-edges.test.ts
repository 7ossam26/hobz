import { describe, expect, it } from 'vitest'

import { DomainError } from '@/lib/errors'
import {
  assertTransition,
  BLOCKABLE_STATUSES,
  canTransition,
  FINAL_STATUSES,
  isBlockable,
  isFinal,
  nextStatuses,
  OPEN_TASK_STATUSES,
  stampTimestamps,
  TASK_STATUSES,
  timestampRuleFor,
  type TaskStatus,
  type TaskTimestamps,
} from '@/modules/task/state-machine'

/**
 * Axis 9 of the edge-case protocol (docs/TESTING.md §4) — **State machine**.
 *
 * `tests/unit/task/state-machine.test.ts` already enumerates the 10×10 legality
 * matrix, the happy path, the revision cycle, and the basic timestamp rules.
 * What is left — and what this file is for — is the machine's *properties*
 * rather than its examples, plus the inputs that arrive from a stored row and
 * therefore cannot be trusted to be well-formed.
 */

const NO_TIMESTAMPS: TaskTimestamps = {
  assignedAt: null,
  startedAt: null,
  submittedAt: null,
  approvedAt: null,
}

const T = {
  assign: new Date('2026-03-01T09:00:00.000Z'),
  start: new Date('2026-03-02T09:00:00.000Z'),
  submit: new Date('2026-03-03T09:00:00.000Z'),
  approve: new Date('2026-03-04T09:00:00.000Z'),
  later: new Date('2026-03-20T09:00:00.000Z'),
}

describe('modules/task/state-machine — خصائص المصفوفة لا أمثلتها', () => {
  it('يتفق assertTransition مع canTransition في كل خانة', () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        const allowed = canTransition(from, to)
        let threw = false
        try {
          assertTransition(from, to)
        } catch {
          threw = true
        }

        expect(threw, `${from} → ${to}`).toBe(!allowed)
      }
    }
  })

  it('يطابق nextStatuses تمامًا ما يسمح به canTransition', () => {
    for (const from of TASK_STATUSES) {
      const listed = nextStatuses(from)
      const derived = TASK_STATUSES.filter((to) => canTransition(from, to))

      expect(listed, `from ${from}`).toEqual(derived)
    }
  })

  it('لا شيء يخرج من حالة نهائية مهما كان السياق', () => {
    for (const from of FINAL_STATUSES) {
      for (const to of TASK_STATUSES) {
        for (const previousStatus of [...TASK_STATUSES, null, undefined]) {
          expect(
            canTransition(from, to, { previousStatus }),
            `${from} → ${to} (previous ${String(previousStatus)})`,
          ).toBe(false)
        }
      }
    }
  })

  it('كل حالة غير نهائية تصل إلى الإلغاء في خطوة واحدة', () => {
    for (const status of TASK_STATUSES.filter((s) => !isFinal(s))) {
      expect(canTransition(status, 'CANCELLED'), `from ${status}`).toBe(true)
    }
  })

  it('كل حالة غير نهائية لها مخرج واحد على الأقل', () => {
    for (const status of TASK_STATUSES.filter((s) => !isFinal(s))) {
      expect(nextStatuses(status).length, `from ${status}`).toBeGreaterThan(0)
    }
  })

  it('يغطي جدول الحواف كل الحالات بلا نقص', () => {
    // A missing key would make `canTransition` read `undefined.includes(...)`
    // and throw at runtime rather than answer "no".
    for (const from of TASK_STATUSES) {
      expect(() => nextStatuses(from)).not.toThrow()
    }
  })

  it('قائمة الحالات بلا تكرار', () => {
    expect(new Set(TASK_STATUSES).size).toBe(TASK_STATUSES.length)
  })
})

describe('modules/task/state-machine — علاقات مجموعات الحالات', () => {
  it('لا حالة نهائية قابلة للتعليق', () => {
    for (const status of FINAL_STATUSES) {
      expect(isBlockable(status), status).toBe(false)
    }
  })

  it('لا حالة نهائية تُحتسب عملًا مفتوحًا', () => {
    // Phase 1's deactivation guard depends on this: a departing worker whose
    // tasks are all DONE must not be held hostage by them.
    for (const status of FINAL_STATUSES) {
      expect((OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status), status).toBe(
        false,
      )
    }
  })

  it('لا تُحتسب مهمة في قائمة الانتظار عملًا مملوكًا لأحد', () => {
    // BACKLOG has no assignee, so nobody owns it — which is why it is blockable
    // (work that can be held up) but not open (work someone must hand over).
    expect(isBlockable('BACKLOG')).toBe(true)
    expect((OPEN_TASK_STATUSES as readonly TaskStatus[]).includes('BACKLOG')).toBe(false)
  })

  it('المهمة المعتمدة والمعلَّقة عمل مفتوح رغم أنها غير قابلة للتعليق', () => {
    // APPROVED is awaiting DONE and BLOCKED is awaiting a resumption; both are
    // still somebody's task, so deactivating that person would orphan them.
    for (const status of ['APPROVED', 'BLOCKED'] as TaskStatus[]) {
      expect((OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status)).toBe(true)
      expect(isBlockable(status)).toBe(false)
    }
  })

  it('كل حالة قابلة للتعليق ليست نهائية', () => {
    for (const status of BLOCKABLE_STATUSES) {
      expect(isFinal(status), status).toBe(false)
    }
  })
})

describe('modules/task/state-machine — حالة سابقة غير موثوقة', () => {
  /**
   * `previousStatus` is read back from a stored `TaskActivity` row, so it is an
   * untrusted input. A corrupt value must make the machine refuse, never let a
   * task escape into a status it could not otherwise reach.
   */
  it('يرفض الاستئناف إلى حالة لا يمكن أن تكون سابقة للتعليق', () => {
    // CANCELLED is deliberately absent from this list. A task can always be
    // cancelled out of BLOCKED — that route comes from the `any(non-final) →
    // CANCELLED` rule, not from the resumption rule, so a stored
    // `previousStatus` of CANCELLED does not make it a *resumption* target,
    // it just happens to be reachable anyway. The escape hatch is asserted on
    // its own below.
    for (const previousStatus of ['BLOCKED', 'DONE', 'APPROVED'] as const) {
      expect(
        canTransition('BLOCKED', previousStatus, { previousStatus }),
        `previous ${previousStatus}`,
      ).toBe(false)
    }
  })

  it('يرفض الاستئناف بحالة سابقة مجهولة', () => {
    const corrupt = 'NOT_A_STATUS' as TaskStatus

    expect(canTransition('BLOCKED', corrupt, { previousStatus: corrupt })).toBe(false)
    for (const to of TASK_STATUSES) {
      if (to === 'CANCELLED') continue
      expect(canTransition('BLOCKED', to, { previousStatus: corrupt }), to).toBe(false)
    }
  })

  it('يبقى الإلغاء متاحًا مهما فسدت الحالة السابقة', () => {
    // The escape hatch must survive a corrupt feed, or a task could be stranded
    // in BLOCKED with no legal move at all.
    for (const previousStatus of [
      ...TASK_STATUSES,
      'NOT_A_STATUS' as TaskStatus,
      null,
      undefined,
    ]) {
      expect(
        canTransition('BLOCKED', 'CANCELLED', { previousStatus }),
        `previous ${String(previousStatus)}`,
      ).toBe(true)
    }
  })

  it('لا يؤثر سياق الحالة السابقة على أي انتقال لا يبدأ من التعليق', () => {
    for (const from of TASK_STATUSES) {
      if (from === 'BLOCKED') continue

      for (const to of TASK_STATUSES) {
        const withoutContext = canTransition(from, to)

        for (const previousStatus of TASK_STATUSES) {
          expect(
            canTransition(from, to, { previousStatus }),
            `${from} → ${to} with previous ${previousStatus}`,
          ).toBe(withoutContext)
        }
      }
    }
  })

  it('يعيد nextStatuses مخرجين فقط من التعليق: السابقة والإلغاء', () => {
    for (const previousStatus of BLOCKABLE_STATUSES) {
      expect(nextStatuses('BLOCKED', { previousStatus }).sort()).toEqual(
        [previousStatus, 'CANCELLED'].sort(),
      )
    }

    expect(nextStatuses('BLOCKED')).toEqual(['CANCELLED'])
  })
})

describe('modules/task/state-machine — نقاء دالة ختم الأوقات', () => {
  it('لا يعدّل الكائن الممرَّر إليه', () => {
    const current: TaskTimestamps = { ...NO_TIMESTAMPS }
    const snapshot = { ...current }

    stampTimestamps('SUBMITTED', current, T.submit)
    stampTimestamps('ASSIGNED', current, T.assign)

    expect(current).toEqual(snapshot)
  })

  it('لا يعيد أبدًا مفتاحًا قيمته undefined', () => {
    // The patch is spread straight into a Prisma `update`; an `undefined` value
    // there is silently ignored, which would turn a missed stamp into a
    // no-op nobody notices.
    for (const status of TASK_STATUSES) {
      const patch = stampTimestamps(status, NO_TIMESTAMPS, T.assign)

      for (const [key, value] of Object.entries(patch)) {
        expect(value, `${status}.${key}`).toBeInstanceOf(Date)
      }
    }
  })

  it('يعيد مفتاحًا واحدًا على الأكثر', () => {
    for (const status of TASK_STATUSES) {
      expect(
        Object.keys(stampTimestamps(status, NO_TIMESTAMPS, T.assign)).length,
      ).toBeLessThanOrEqual(1)
    }
  })

  it('يعيد اللحظة نفسها بلا نسخ أو اقتطاع', () => {
    const patch = stampTimestamps('SUBMITTED', NO_TIMESTAMPS, T.submit)

    expect(patch.submittedAt).toBe(T.submit)
  })

  it('يتوافق الختم مع القاعدة المعلنة لكل حالة', () => {
    for (const status of TASK_STATUSES) {
      const rule = timestampRuleFor(status)
      const fromEmpty = stampTimestamps(status, NO_TIMESTAMPS, T.assign)

      if (!rule) {
        expect(fromEmpty, status).toEqual({})
        continue
      }

      expect(Object.keys(fromEmpty), status).toEqual([rule.field])

      const alreadyStamped: TaskTimestamps = { ...NO_TIMESTAMPS, [rule.field]: T.assign }
      const second = stampTimestamps(status, alreadyStamped, T.later)

      expect(second, `${status} re-stamp`).toEqual(
        rule.overwrite ? { [rule.field]: T.later } : {},
      )
    }
  })
})

describe('modules/task/state-machine — الختم عبر مسار كامل', () => {
  /** Folds the machine over a status path the way the service does, one step at a time. */
  function walk(path: readonly TaskStatus[], clock: readonly Date[]): TaskTimestamps {
    let timestamps: TaskTimestamps = { ...NO_TIMESTAMPS }

    path.forEach((status, index) => {
      timestamps = {
        ...timestamps,
        ...stampTimestamps(status, timestamps, clock[index]!),
      }
    })

    return timestamps
  }

  it('يختم المسار السعيد أربعة أوقات مرة واحدة لكل منها', () => {
    const result = walk(
      ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'DONE'],
      [T.assign, T.start, T.submit, T.submit, T.approve, T.approve],
    )

    expect(result).toEqual({
      assignedAt: T.assign,
      startedAt: T.start,
      submittedAt: T.submit,
      approvedAt: T.approve,
    })
  })

  /**
   * The property the brief calls out: after three revision rounds, only
   * `submittedAt` has moved. `startedAt` still points at the first time work
   * began, which is what `elapsedMinutesRaw` measures from.
   */
  it('بعد ثلاث دورات تعديل يتحرك وقت التسليم وحده', () => {
    const resubmits = [
      new Date('2026-03-10T09:00:00.000Z'),
      new Date('2026-03-15T09:00:00.000Z'),
      new Date('2026-03-25T09:00:00.000Z'),
    ] as const

    const path: TaskStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW']
    const clock: Date[] = [T.assign, T.start, T.submit, T.submit]

    for (const at of resubmits) {
      path.push('REVISION_REQUESTED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW')
      clock.push(at, at, at, at)
    }

    const result = walk(path, clock)

    expect(result.assignedAt).toBe(T.assign)
    expect(result.startedAt).toBe(T.start)
    expect(result.submittedAt).toBe(resubmits[2])
    expect(result.approvedAt).toBeNull()
  })

  it('لا يختم مرور المهمة بالتعليق والاستئناف أي وقت جديد', () => {
    const before = walk(['ASSIGNED', 'IN_PROGRESS'], [T.assign, T.start])
    const afterBlockCycle = {
      ...before,
      ...stampTimestamps('BLOCKED', before, T.later),
    }
    const resumed = {
      ...afterBlockCycle,
      ...stampTimestamps('IN_PROGRESS', afterBlockCycle, T.later),
    }

    expect(resumed).toEqual(before)
  })

  it('لا يختم الإلغاء شيئًا مهما كانت الحالة السابقة', () => {
    const before = walk(
      ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'],
      [T.assign, T.start, T.submit],
    )

    expect(stampTimestamps('CANCELLED', before, T.later)).toEqual({})
  })
})

describe('modules/task/state-machine — شكل الخطأ', () => {
  it('يحمل كل خطأ انتقال الحالتين في تفاصيله', () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        if (canTransition(from, to)) continue

        try {
          assertTransition(from, to)
          expect.unreachable(`${from} → ${to} should have thrown`)
        } catch (error) {
          expect(error).toBeInstanceOf(DomainError)
          const domain = error as DomainError
          expect(domain.messageKey).toBe('tasks.errors.illegalTransition')
          expect(domain.details).toEqual({ from, to })
        }
      }
    }
  })
})
