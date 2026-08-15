import { describe, expect, it } from 'vitest'

import { computeElapsed, minutesBetween } from '@/modules/task/elapsed'

import { businessDayCalendar, stubCalendar } from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * SPEC §5.2:
 *   elapsedMinutesRaw     = submittedAt − assignedAt (wall clock)
 *   elapsedMinutesWorking = the same span, minus weekends, holidays and the
 *                           assignee's approved leave
 *
 * Working time is `lib/calendar`'s answer, and `lib/calendar` is Phase 6. What
 * Phase 4 owns — and what these tests pin — is the arithmetic on the raw side
 * and the *wiring* on the working side: the real instants and the real assignee
 * reach the calendar unmodified, and its answer is written through unchanged.
 */

describe('modules/task/elapsed — الزمن الخام', () => {
  it('يحسب الفارق بالدقائق بين الإسناد والتسليم', async () => {
    const assignedAt = cairo('2026-03-01T09:00')
    const submittedAt = cairo('2026-03-01T17:30')

    const result = await computeElapsed(stubCalendar(), {
      assignedAt,
      submittedAt,
      assigneeId: 'user-1',
    })

    expect(result.raw).toBe(510)
  })

  it('يهمل الثواني ولا يقرّب لأعلى', async () => {
    const assignedAt = new Date('2026-03-01T09:00:00.000Z')
    const submittedAt = new Date('2026-03-01T09:01:59.000Z')

    expect(minutesBetween(assignedAt, submittedAt)).toBe(1)
  })

  it('يعطي صفرًا للمهمة غير المسنَدة', async () => {
    const result = await computeElapsed(stubCalendar(), {
      assignedAt: null,
      submittedAt: cairo('2026-03-01T17:00'),
      assigneeId: null,
    })

    expect(result).toEqual({ raw: 0, working: 0 })
  })

  it('يعطي صفرًا للمهمة التي لم تُسلَّم بعد', async () => {
    const result = await computeElapsed(stubCalendar(), {
      assignedAt: cairo('2026-03-01T09:00'),
      submittedAt: null,
      assigneeId: 'user-1',
    })

    expect(result).toEqual({ raw: 0, working: 0 })
  })

  it('يعطي صفرًا عند التسليم في نفس لحظة الإسناد', async () => {
    const at = cairo('2026-03-01T09:00')

    const result = await computeElapsed(stubCalendar(), {
      assignedAt: at,
      submittedAt: at,
      assigneeId: 'user-1',
    })

    expect(result).toEqual({ raw: 0, working: 0 })
  })

  it('يعطي صفرًا ولا يستدعي التقويم عند تسليم قبل الإسناد', async () => {
    const calendar = stubCalendar({ workingMinutesBetween: async () => 999 })

    const result = await computeElapsed(calendar, {
      assignedAt: cairo('2026-03-05T09:00'),
      submittedAt: cairo('2026-03-01T09:00'),
      assigneeId: 'user-1',
    })

    expect(result).toEqual({ raw: 0, working: 0 })
    expect(calendar.calls).toHaveLength(0)
  })
})

describe('modules/task/elapsed — التوصيل مع lib/calendar', () => {
  it('يمرّر اللحظتين ومعرّف المنفّذ إلى التقويم كما هي', async () => {
    const calendar = stubCalendar({ workingMinutesBetween: async () => 120 })
    const assignedAt = cairo('2026-03-01T09:00')
    const submittedAt = cairo('2026-03-03T14:00')

    const result = await computeElapsed(calendar, {
      assignedAt,
      submittedAt,
      assigneeId: 'user-7',
    })

    expect(calendar.calls).toEqual([
      { from: assignedAt, to: submittedAt, userId: 'user-7' },
    ])
    expect(result.working).toBe(120)
  })

  it('يستعلم بتقويم الوكالة وحده حين لا يوجد منفّذ', async () => {
    const calendar = stubCalendar({ workingMinutesBetween: async () => 60 })

    await computeElapsed(calendar, {
      assignedAt: cairo('2026-03-01T09:00'),
      submittedAt: cairo('2026-03-01T10:00'),
      assigneeId: null,
    })

    expect(calendar.calls[0]?.userId).toBeUndefined()
  })

  /**
   * Working time is a subset of wall-clock time, so it can never exceed it.
   * Clamping to a provably-correct bound is not the same as hiding a defect:
   * `raw` is the arithmetic maximum, and a calendar that returned more would be
   * reporting an impossibility, not a number worth preserving.
   */
  it('لا يتجاوز زمن العمل الزمن الخام مهما أعاد التقويم', async () => {
    const calendar = stubCalendar({ workingMinutesBetween: async () => 10_000 })

    const result = await computeElapsed(calendar, {
      assignedAt: cairo('2026-03-01T09:00'),
      submittedAt: cairo('2026-03-01T10:00'),
      assigneeId: 'user-1',
    })

    expect(result.raw).toBe(60)
    expect(result.working).toBe(60)
  })

  it('لا يقبل زمن عمل سالبًا', async () => {
    const calendar = stubCalendar({ workingMinutesBetween: async () => -30 })

    const result = await computeElapsed(calendar, {
      assignedAt: cairo('2026-03-01T09:00'),
      submittedAt: cairo('2026-03-01T10:00'),
      assigneeId: 'user-1',
    })

    expect(result.working).toBe(0)
  })
})

describe('modules/task/elapsed — العطلات والإجازات (SPEC §5.2)', () => {
  it('يستبعد الجمعة والسبت من زمن العمل', async () => {
    // 2026-03-05 is a Thursday; 06 Friday, 07 Saturday, 08 Sunday.
    const calendar = businessDayCalendar()

    const result = await computeElapsed(calendar, {
      assignedAt: cairo('2026-03-05T09:00'),
      submittedAt: cairo('2026-03-08T17:00'),
      assigneeId: 'user-1',
    })

    // Thursday 09:00→17:00 and Sunday 09:00→17:00 = two working days.
    expect(result.working).toBe(2 * 8 * 60)
    // Wall clock spans the whole weekend.
    expect(result.raw).toBe(3 * 24 * 60 + 8 * 60)
  })

  it('يستبعد الأجازات الرسمية', async () => {
    const withHoliday = businessDayCalendar({ holidays: ['2026-03-05'] })

    const result = await computeElapsed(withHoliday, {
      assignedAt: cairo('2026-03-04T09:00'),
      submittedAt: cairo('2026-03-05T17:00'),
      assigneeId: 'user-1',
    })

    expect(result.working).toBe(8 * 60)
  })

  it('يستبعد إجازة المنفّذ المعتمدة وحده دون غيره', async () => {
    const calendar = businessDayCalendar({
      leave: [{ userId: 'on-leave', start: '2026-03-04', end: '2026-03-04' }],
    })
    const span = {
      assignedAt: cairo('2026-03-03T09:00'),
      submittedAt: cairo('2026-03-04T17:00'),
    }

    const onLeave = await computeElapsed(calendar, { ...span, assigneeId: 'on-leave' })
    const working = await computeElapsed(calendar, { ...span, assigneeId: 'other' })

    expect(onLeave.working).toBe(8 * 60)
    expect(working.working).toBe(16 * 60)
  })

  /**
   * SPEC §5.2, edge case T2 — the one this product cares most about:
   * "Working *voluntarily* on a day off never hurts and never helps."
   */
  it('لا يزيد زمن العمل بالتسليم يوم عطلة ولا ينقص', async () => {
    const calendar = businessDayCalendar()
    const assignedAt = cairo('2026-03-05T09:00') // Thursday

    const submittedThursday = await computeElapsed(calendar, {
      assignedAt,
      submittedAt: cairo('2026-03-05T17:00'),
      assigneeId: 'user-1',
    })
    const submittedFriday = await computeElapsed(calendar, {
      assignedAt,
      submittedAt: cairo('2026-03-06T22:00'), // Friday night, voluntarily
      assigneeId: 'user-1',
    })

    expect(submittedFriday.working).toBe(submittedThursday.working)
    // …while the wall clock honestly records the later submission.
    expect(submittedFriday.raw).toBeGreaterThan(submittedThursday.raw)
  })

  it('لا يحتسب الوقت خارج ساعات العمل داخل يوم عمل', async () => {
    const calendar = businessDayCalendar({
      workdayStart: '09:00',
      workdayEnd: '17:00',
    })

    const result = await computeElapsed(calendar, {
      assignedAt: cairo('2026-03-05T06:00'),
      submittedAt: cairo('2026-03-05T23:00'),
      assigneeId: 'user-1',
    })

    expect(result.working).toBe(8 * 60)
    expect(result.raw).toBe(17 * 60)
  })
})
