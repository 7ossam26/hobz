import { describe, expect, it } from 'vitest'

import { createCalendar, type Calendar } from '@/lib/calendar'
import { SETTINGS_CATALOG } from '@/lib/settings'
import {
  computeLateness,
  resolveGraceHours,
  type LatenessTaskInput,
} from '@/modules/lateness/service'

import {
  inMemoryCalendarSource,
  type InMemoryCalendarOptions,
} from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * SPEC §5.3 — lateness. The number the whole penalty engine multiplies.
 *
 *   lateWorkingDays = workingDaysBetween(dueDate + grace, min(now, submittedAt))
 *   Grace: project override → global default.
 *   Time sitting in review NEVER counts against the worker.
 *   Approved leave never generates lateness.
 *
 * Fixture week is March 2026: 1 March is a Sunday, so 1–5 are working days and
 * 6–7 (Friday, Saturday) are the default weekend.
 */

const WORKER = 'worker-1'
const DEFAULT_GRACE = SETTINGS_CATALOG['penalty.defaultGraceHours'].default

const calendarWith = (options: InMemoryCalendarOptions = {}): Calendar =>
  createCalendar(inMemoryCalendarSource(options))

function task(overrides: Partial<LatenessTaskInput> = {}): LatenessTaskInput {
  const dueDate = overrides.dueDate ?? cairo('2026-03-01T17:00')
  return {
    id: 'task-1',
    status: 'SUBMITTED',
    assigneeId: WORKER,
    dueDate,
    originalDueDate: overrides.originalDueDate ?? dueDate,
    submittedAt: null,
    blockedIntervals: [],
    ...overrides,
  }
}

/**
 * `now` defaults to well past every fixture, so that a delivered task measures
 * at its `submittedAt` and nothing else. Tests about the undelivered clock, or
 * about `min(now, submittedAt)`, pass their own.
 */
const FAR_FUTURE = cairo('2030-01-01T00:00')

const late = async (
  calendar: Calendar,
  input: Partial<LatenessTaskInput>,
  options: { graceHours?: number; now?: Date } = {},
) =>
  (
    await computeLateness(calendar, {
      task: task(input),
      graceHours: options.graceHours ?? 0,
      now: options.now ?? FAR_FUTURE,
    })
  ).lateWorkingDays

describe('resolveGraceHours', () => {
  it('يستخدم الافتراضي العام عند غياب تجاوز المشروع', () => {
    expect(resolveGraceHours(null, DEFAULT_GRACE)).toBe(DEFAULT_GRACE)
  })

  it('تجاوز المشروع يتقدّم على الافتراضي العام', () => {
    expect(resolveGraceHours(72, DEFAULT_GRACE)).toBe(72)
  })

  it('تجاوز المشروع بصفر ساعة يتقدّم أيضًا — الصفر قرار لا غياب', () => {
    // `?? ` not `||`: a project that deliberately allows no grace at all must
    // not silently inherit the organization default.
    expect(resolveGraceHours(0, DEFAULT_GRACE)).toBe(0)
  })
})

describe('التسليم في الموعد', () => {
  it('لا تأخير عند التسليم قبل الموعد', async () => {
    await expect(
      late(calendarWith(), {
        submittedAt: cairo('2026-03-01T16:00'),
      }),
    ).resolves.toBe(0)
  })

  it('لا تأخير عند التسليم في نفس لحظة الموعد', async () => {
    await expect(
      late(calendarWith(), { submittedAt: cairo('2026-03-01T17:00') }),
    ).resolves.toBe(0)
  })

  it('لا تأخير عند التسليم بعد الموعد بدقيقة في نفس اليوم', async () => {
    await expect(
      late(calendarWith(), { submittedAt: cairo('2026-03-01T17:01') }),
    ).resolves.toBe(0)
  })

  it('يوم تأخير واحد عند عبور منتصف الليل إلى يوم عمل', async () => {
    await expect(
      late(calendarWith(), { submittedAt: cairo('2026-03-02T09:00') }),
    ).resolves.toBe(1)
  })
})

describe('مهلة السماح', () => {
  const submittedTuesday = { submittedAt: cairo('2026-03-03T09:00') }

  it('مهلة صفر ساعة', async () => {
    await expect(late(calendarWith(), submittedTuesday, { graceHours: 0 })).resolves.toBe(
      2,
    )
  })

  it('مهلة 24 ساعة تبتلع يوم تأخير', async () => {
    await expect(
      late(calendarWith(), submittedTuesday, { graceHours: 24 }),
    ).resolves.toBe(1)
  })

  it('مهلة 72 ساعة تبتلع التأخير كله', async () => {
    await expect(
      late(calendarWith(), submittedTuesday, { graceHours: 72 }),
    ).resolves.toBe(0)
  })

  it('مهلة 72 ساعة لا تخفي ما بعدها', async () => {
    await expect(
      late(
        calendarWith(),
        { submittedAt: cairo('2026-03-05T09:00') },
        { graceHours: 72 },
      ),
    ).resolves.toBe(1)
  })

  it('المهلة تُقاس بالساعات الفعلية لا بأيام العمل', async () => {
    // 24 hours of grace on a Thursday deadline still expires on the Friday,
    // even though Friday is not a working day. Grace is a duration; the
    // working-day filter applies to what comes after it.
    const thursday = { dueDate: cairo('2026-03-05T17:00') }
    await expect(
      late(
        calendarWith(),
        { ...thursday, submittedAt: cairo('2026-03-08T09:00') },
        { graceHours: 24 },
      ),
    ).resolves.toBe(1)
  })
})

describe('موعد التسليم يقع في يوم إجازة', () => {
  it('موعد يوم الجمعة', async () => {
    const friday = { dueDate: cairo('2026-03-06T17:00') }
    await expect(
      late(calendarWith(), { ...friday, submittedAt: cairo('2026-03-07T23:00') }),
    ).resolves.toBe(0)
    await expect(
      late(calendarWith(), { ...friday, submittedAt: cairo('2026-03-08T09:00') }),
    ).resolves.toBe(1)
  })

  it('موعد يوم السبت', async () => {
    const saturday = { dueDate: cairo('2026-03-07T17:00') }
    await expect(
      late(calendarWith(), { ...saturday, submittedAt: cairo('2026-03-07T23:00') }),
    ).resolves.toBe(0)
    await expect(
      late(calendarWith(), { ...saturday, submittedAt: cairo('2026-03-08T09:00') }),
    ).resolves.toBe(1)
  })

  it('موعد يوم عطلة رسمية', async () => {
    const calendar = calendarWith({ holidays: ['2026-03-03'] })
    const onHoliday = { dueDate: cairo('2026-03-03T17:00') }
    await expect(
      late(calendar, { ...onHoliday, submittedAt: cairo('2026-03-03T23:00') }),
    ).resolves.toBe(0)
    await expect(
      late(calendar, { ...onHoliday, submittedAt: cairo('2026-03-04T09:00') }),
    ).resolves.toBe(1)
  })

  it('موعد في ليلة عطلة رسمية — العطلة لا تُحتسب', async () => {
    const eve = {
      dueDate: cairo('2026-03-03T17:00'),
      submittedAt: cairo('2026-03-05T09:00'),
    }
    // Wednesday the 4th is a holiday, so only Thursday counts.
    await expect(late(calendarWith({ holidays: ['2026-03-04'] }), eve)).resolves.toBe(1)
    await expect(late(calendarWith(), eve)).resolves.toBe(2)
  })
})

describe('التسليم يوم إجازة لا يزيد التأخير ولا ينقصه (SPEC §5.2 T2)', () => {
  const due = { dueDate: cairo('2026-03-05T17:00') }

  it('الجمعة والسبت يعطيان نفس نتيجة مساء الخميس', async () => {
    const calendar = calendarWith()
    const thursdayNight = await late(calendar, {
      ...due,
      submittedAt: cairo('2026-03-05T23:59'),
    })
    const friday = await late(calendar, {
      ...due,
      submittedAt: cairo('2026-03-06T10:00'),
    })
    const saturday = await late(calendar, {
      ...due,
      submittedAt: cairo('2026-03-07T22:00'),
    })

    expect(friday).toBe(thursdayNight)
    expect(saturday).toBe(thursdayNight)
    expect(thursdayNight).toBe(0)
  })

  it('التسليم يوم عطلة رسمية يعطي نفس نتيجة اليوم السابق له', async () => {
    const calendar = calendarWith({ holidays: ['2026-03-04'] })
    const dueTuesday = { dueDate: cairo('2026-03-03T17:00') }

    const beforeHoliday = await late(calendar, {
      ...dueTuesday,
      submittedAt: cairo('2026-03-03T23:00'),
    })
    const onHoliday = await late(calendar, {
      ...dueTuesday,
      submittedAt: cairo('2026-03-04T14:00'),
    })

    expect(onHoliday).toBe(beforeHoliday)
    expect(onHoliday).toBe(0)
  })

  it('التسليم أثناء إجازة معتمدة يعطي نفس نتيجة ما قبلها', async () => {
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-03', end: '2026-03-04' }],
    })
    const dueMonday = { dueDate: cairo('2026-03-02T17:00') }

    const beforeLeave = await late(calendar, {
      ...dueMonday,
      submittedAt: cairo('2026-03-02T23:00'),
    })
    const duringLeave = await late(calendar, {
      ...dueMonday,
      submittedAt: cairo('2026-03-04T14:00'),
    })

    expect(duringLeave).toBe(beforeLeave)
    expect(duringLeave).toBe(0)
  })
})

describe('الإجازة المعتمدة لا تولّد تأخيرًا', () => {
  const submitted = { submittedAt: cairo('2026-03-05T09:00') }

  it('إجازة تغطي الفترة كاملة بعد الموعد', async () => {
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-04' }],
    })
    await expect(late(calendar, submitted)).resolves.toBe(1)
    await expect(late(calendarWith(), submitted)).resolves.toBe(4)
  })

  it('إجازة تبدأ في منتصف المهمة', async () => {
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-04', end: '2026-03-05' }],
    })
    await expect(
      late(calendar, { submittedAt: cairo('2026-03-08T09:00') }),
    ).resolves.toBe(3)
  })

  it('إجازة منفّذ آخر لا تُنقص تأخير هذا المنفّذ', async () => {
    const calendar = calendarWith({
      leave: [{ userId: 'someone-else', start: '2026-03-02', end: '2026-03-04' }],
    })
    await expect(late(calendar, submitted)).resolves.toBe(4)
  })

  it('مهمة بلا منفّذ تُقاس بتقويم المؤسسة وحده', async () => {
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-04' }],
    })
    await expect(late(calendar, { ...submitted, assigneeId: null })).resolves.toBe(4)
  })
})

describe('وقت المراجعة لا يُحتسب على المنفّذ (SPEC §5.3)', () => {
  const submittedLate = {
    submittedAt: cairo('2026-03-02T09:00'),
  }

  it('التأخير يتجمّد عند التسليم مهما طالت المراجعة', async () => {
    const calendar = calendarWith()
    const atSubmission = await late(
      calendar,
      { ...submittedLate, status: 'SUBMITTED' },
      {
        now: cairo('2026-03-02T09:00'),
      },
    )

    for (const status of ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'DONE'] as const) {
      const muchLater = await late(
        calendar,
        { ...submittedLate, status },
        { now: cairo('2026-04-30T12:00') },
      )
      expect(muchLater).toBe(atSubmission)
    }
    expect(atSubmission).toBe(1)
  })

  it('مهمة سُلّمت في موعدها واعتُمدت بعد عشرة أيام — لا تأخير', async () => {
    await expect(
      late(
        calendarWith(),
        {
          status: 'APPROVED',
          submittedAt: cairo('2026-03-01T16:30'),
        },
        { now: cairo('2026-03-11T12:00') },
      ),
    ).resolves.toBe(0)
  })

  it('المهمة غير المسلَّمة تُقاس حتى اللحظة الحالية', async () => {
    const calendar = calendarWith()
    const onTuesday = await late(
      calendar,
      { status: 'IN_PROGRESS', submittedAt: null },
      { now: cairo('2026-03-03T12:00') },
    )
    const onThursday = await late(
      calendar,
      { status: 'IN_PROGRESS', submittedAt: null },
      { now: cairo('2026-03-05T12:00') },
    )
    expect(onTuesday).toBe(2)
    expect(onThursday).toBe(4)
  })

  it('طلب التعديل يعيد تشغيل الساعة على الموعد الجديد', async () => {
    // SPEC T4: a revision sets a new due date and the revision accrues against
    // it. The previous `submittedAt` must not freeze the new clock.
    await expect(
      late(
        calendarWith(),
        {
          status: 'REVISION_REQUESTED',
          dueDate: cairo('2026-03-04T17:00'),
          originalDueDate: cairo('2026-03-01T17:00'),
          submittedAt: cairo('2026-03-02T09:00'),
        },
        { now: cairo('2026-03-08T12:00') },
      ),
    ).resolves.toBe(2)
  })

  it('المهمة الملغاة لا تُنتج تأخيرًا', async () => {
    await expect(
      late(
        calendarWith(),
        { status: 'CANCELLED', submittedAt: null },
        { now: cairo('2026-03-31T12:00') },
      ),
    ).resolves.toBe(0)
  })
})

describe('التمديد', () => {
  it('تمديد معتمد قبل الموعد يمنع أي تأخير', async () => {
    // The extension moved `dueDate` to Thursday and kept the original Sunday.
    await expect(
      late(calendarWith(), {
        dueDate: cairo('2026-03-05T17:00'),
        originalDueDate: cairo('2026-03-01T17:00'),
        submittedAt: cairo('2026-03-05T16:00'),
      }),
    ).resolves.toBe(0)
  })

  it('تمديد معتمد بعد تراكم التأخير يعيد الحساب على الموعد الجديد', async () => {
    const submitted = cairo('2026-03-05T09:00')
    const before = await late(calendarWith(), {
      dueDate: cairo('2026-03-01T17:00'),
      submittedAt: submitted,
    })
    const after = await late(calendarWith(), {
      dueDate: cairo('2026-03-04T17:00'),
      originalDueDate: cairo('2026-03-01T17:00'),
      submittedAt: submitted,
    })

    expect(before).toBe(4)
    expect(after).toBe(1)
  })

  it('يُبلّغ عن التمديد وعن الموعد الأصلي في التفصيل', async () => {
    const result = await computeLateness(calendarWith(), {
      task: task({
        dueDate: cairo('2026-03-05T17:00'),
        originalDueDate: cairo('2026-03-01T17:00'),
        submittedAt: cairo('2026-03-05T16:00'),
      }),
      graceHours: 0,
      now: cairo('2026-03-31T12:00'),
    })

    expect(result.extended).toBe(true)
    expect(result.originalDueDate).toEqual(cairo('2026-03-01T17:00'))
    expect(result.dueDate).toEqual(cairo('2026-03-05T17:00'))
  })
})

describe('التفصيل المعروض للمنفّذ', () => {
  it('يحمل الموعد الفعلي بعد المهلة ولحظة القياس', async () => {
    const result = await computeLateness(calendarWith(), {
      task: task({ submittedAt: cairo('2026-03-03T09:00') }),
      graceHours: 24,
      now: cairo('2026-03-31T12:00'),
    })

    expect(result.graceHours).toBe(24)
    expect(result.effectiveDueDate).toEqual(cairo('2026-03-02T17:00'))
    expect(result.measuredAt).toEqual(cairo('2026-03-03T09:00'))
    expect(result.frozen).toBe(true)
    expect(result.lateWorkingDays).toBe(1)
  })

  it('يُعلن أن الساعة ما زالت تعمل على مهمة غير مسلَّمة', async () => {
    const now = cairo('2026-03-03T09:00')
    const result = await computeLateness(calendarWith(), {
      task: task({ status: 'IN_PROGRESS', submittedAt: null }),
      graceHours: 0,
      now,
    })

    expect(result.frozen).toBe(false)
    expect(result.measuredAt).toEqual(now)
  })

  it('لا يقيس أبعد من اللحظة الحالية حتى لو كان التسليم مسجَّلًا في المستقبل', async () => {
    // `min(now, submittedAt)` from SPEC §5.3, stated literally. A clock skew
    // between two containers must never manufacture days of lateness.
    const result = await computeLateness(calendarWith(), {
      task: task({ submittedAt: cairo('2026-03-20T09:00') }),
      graceHours: 0,
      now: cairo('2026-03-03T09:00'),
    })

    expect(result.measuredAt).toEqual(cairo('2026-03-03T09:00'))
    expect(result.lateWorkingDays).toBe(2)
  })
})

describe('حدود الشهور والسنة', () => {
  it('يعبر نهاية يناير إلى فبراير', async () => {
    await expect(
      late(calendarWith(), {
        dueDate: cairo('2026-01-30T17:00'),
        submittedAt: cairo('2026-02-02T09:00'),
      }),
    ).resolves.toBe(2)
  })

  it('يعبر 28 فبراير في سنة عادية', async () => {
    await expect(
      late(calendarWith(), {
        dueDate: cairo('2026-02-26T17:00'),
        submittedAt: cairo('2026-03-01T09:00'),
      }),
    ).resolves.toBe(1)
  })

  it('يعبر 29 فبراير في سنة كبيسة', async () => {
    // 28 Feb 2028 is a Monday, 29 Feb a Tuesday.
    await expect(
      late(calendarWith(), {
        dueDate: cairo('2028-02-28T17:00'),
        submittedAt: cairo('2028-03-01T09:00'),
      }),
    ).resolves.toBe(2)
  })

  it('يعبر اليوم الحادي والثلاثين', async () => {
    await expect(
      late(calendarWith(), {
        dueDate: cairo('2026-03-31T17:00'),
        submittedAt: cairo('2026-04-02T09:00'),
      }),
    ).resolves.toBe(2)
  })

  it('يعبر نهاية السنة', async () => {
    // Thursday 31 December 2026 → Sunday 3 January 2027, with the Friday and
    // Saturday of the new year in between.
    await expect(
      late(calendarWith(), {
        dueDate: cairo('2026-12-31T17:00'),
        submittedAt: cairo('2027-01-04T09:00'),
      }),
    ).resolves.toBe(2)
  })

  it('يعبر تقديم الساعة في أبريل دون أن يفقد يومًا', async () => {
    // 22 April 2026 (Wed) → 28 April (Tue), across the 23-hour day. Boundaries
    // crossed: Thu 23, Fri 24 and Sat 25 (weekend), Sun 26, Mon 27, Tue 28.
    await expect(
      late(calendarWith(), {
        dueDate: cairo('2026-04-22T17:00'),
        submittedAt: cairo('2026-04-28T09:00'),
      }),
    ).resolves.toBe(4)
  })
})
