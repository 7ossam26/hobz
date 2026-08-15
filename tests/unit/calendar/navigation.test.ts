import { describe, expect, it } from 'vitest'

import { createCalendar, startOfCairoDay } from '@/lib/calendar'

import { inMemoryCalendarSource } from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * `isWorkingDay`, `nextWorkingDay`, `addWorkingDays` — the navigation half of
 * `lib/calendar`. Nothing here decides money directly, but everything that
 * does is built on it: "three working days before the deadline" (the Phase 9
 * reminder), "the first working day after an extension", and the loop the
 * escalation job walks.
 *
 * Fixture week is March 2026: 1 March is a Sunday, 6–7 the weekend.
 */

const WORKER = 'user-1'

const plain = () => createCalendar(inMemoryCalendarSource())

describe('isWorkingDay', () => {
  it('يوم الأحد إلى الخميس أيام عمل', async () => {
    const calendar = plain()
    for (const key of ['2026-03-01', '2026-03-02', '2026-03-05']) {
      await expect(calendar.isWorkingDay(cairo(`${key}T12:00`))).resolves.toBe(true)
    }
  })

  it('الجمعة والسبت ليسا يومي عمل', async () => {
    const calendar = plain()
    await expect(calendar.isWorkingDay(cairo('2026-03-06T12:00'))).resolves.toBe(false)
    await expect(calendar.isWorkingDay(cairo('2026-03-07T12:00'))).resolves.toBe(false)
  })

  it('يقرأ اليوم بتوقيت القاهرة لا بتوقيت UTC', async () => {
    // 21:30Z on Thursday is already 23:30 Thursday in Cairo (winter), while
    // 22:30Z has rolled over into Friday — the weekend.
    const calendar = plain()
    await expect(calendar.isWorkingDay(new Date('2026-03-05T21:30:00Z'))).resolves.toBe(
      true,
    )
    await expect(calendar.isWorkingDay(new Date('2026-03-05T22:30:00Z'))).resolves.toBe(
      false,
    )
  })

  it('العطلة الرسمية ليست يوم عمل', async () => {
    const calendar = createCalendar(inMemoryCalendarSource({ holidays: ['2026-03-03'] }))
    await expect(calendar.isWorkingDay(cairo('2026-03-03T12:00'))).resolves.toBe(false)
  })

  it('الإجازة المعتمدة ليست يوم عمل لصاحبها وحده', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({
        leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-04' }],
      }),
    )
    const at = cairo('2026-03-03T12:00')
    await expect(calendar.isWorkingDay(at, WORKER)).resolves.toBe(false)
    await expect(calendar.isWorkingDay(at, 'other')).resolves.toBe(true)
    await expect(calendar.isWorkingDay(at)).resolves.toBe(true)
  })
})

describe('nextWorkingDay', () => {
  it('يعطي بداية دوام اليوم التالي داخل الأسبوع', async () => {
    await expect(plain().nextWorkingDay(cairo('2026-03-01T15:00'))).resolves.toEqual(
      cairo('2026-03-02T09:00'),
    )
  })

  it('يقفز فوق عطلة نهاية الأسبوع', async () => {
    await expect(plain().nextWorkingDay(cairo('2026-03-05T15:00'))).resolves.toEqual(
      cairo('2026-03-08T09:00'),
    )
  })

  it('يقفز من داخل عطلة نهاية الأسبوع إلى أول يوم عمل', async () => {
    await expect(plain().nextWorkingDay(cairo('2026-03-06T15:00'))).resolves.toEqual(
      cairo('2026-03-08T09:00'),
    )
  })

  it('يقفز فوق العطلات الرسمية المتتالية', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({ holidays: ['2026-03-02', '2026-03-03'] }),
    )
    await expect(calendar.nextWorkingDay(cairo('2026-03-01T15:00'))).resolves.toEqual(
      cairo('2026-03-04T09:00'),
    )
  })

  it('يتخطى إجازة المنفّذ المعتمدة', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({
        leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-04' }],
      }),
    )
    await expect(
      calendar.nextWorkingDay(cairo('2026-03-01T15:00'), WORKER),
    ).resolves.toEqual(cairo('2026-03-05T09:00'))
  })
})

describe('addWorkingDays', () => {
  it('صفر يوم يعطي بداية دوام اليوم نفسه', async () => {
    await expect(plain().addWorkingDays(cairo('2026-03-01T15:00'), 0)).resolves.toEqual(
      cairo('2026-03-01T09:00'),
    )
  })

  it('يوم واحد يعطي يوم العمل التالي', async () => {
    await expect(plain().addWorkingDays(cairo('2026-03-01T15:00'), 1)).resolves.toEqual(
      cairo('2026-03-02T09:00'),
    )
  })

  it('يعبر عطلة نهاية الأسبوع عند العدّ', async () => {
    // Wednesday + 3 working days = Thursday, Sunday, Monday.
    await expect(plain().addWorkingDays(cairo('2026-03-04T15:00'), 3)).resolves.toEqual(
      cairo('2026-03-09T09:00'),
    )
  })

  it('يعدّ إلى الخلف بأيام سالبة', async () => {
    await expect(plain().addWorkingDays(cairo('2026-03-09T15:00'), -3)).resolves.toEqual(
      cairo('2026-03-04T09:00'),
    )
  })

  it('يتخطى العطلات الرسمية وإجازة المنفّذ معًا', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({
        holidays: ['2026-03-02'],
        leave: [{ userId: WORKER, start: '2026-03-03', end: '2026-03-03' }],
      }),
    )
    // Sunday + 1 working day: Monday is a holiday, Tuesday is leave, so it
    // lands on Wednesday.
    await expect(
      calendar.addWorkingDays(cairo('2026-03-01T15:00'), 1, WORKER),
    ).resolves.toEqual(cairo('2026-03-04T09:00'))
  })

  it('يعبر حدود الشهر والسنة', async () => {
    // Thursday 31 December 2026 + 1 working day → Sunday 3 January 2027,
    // because 1 and 2 January are the Friday/Saturday weekend.
    await expect(plain().addWorkingDays(cairo('2026-12-31T15:00'), 1)).resolves.toEqual(
      cairo('2027-01-03T09:00'),
    )
  })

  it('يعبر 28 فبراير في سنة عادية و29 فبراير في سنة كبيسة', async () => {
    const calendar = createCalendar(inMemoryCalendarSource({ weekendDays: [] }))
    await expect(
      calendar.addWorkingDays(startOfCairoDay('2026-02-28'), 1),
    ).resolves.toEqual(cairo('2026-03-01T09:00'))
    await expect(
      calendar.addWorkingDays(startOfCairoDay('2028-02-28'), 1),
    ).resolves.toEqual(cairo('2028-02-29T09:00'))
  })

  it('يحمّل التقويم شهرًا في كل استعلام، لا يومًا بيوم', async () => {
    // The window is loaded once per month walked, not once per day. Asking for
    // `[cursor, cursor + 30]` on every step would extend one day past what is
    // already loaded and reload every time — 116 round trips for the count
    // below instead of four. The counters are the only thing that can tell the
    // two apart, because both return the same date.
    const source = inMemoryCalendarSource()
    await createCalendar(source).addWorkingDays(cairo('2026-03-01T09:00'), 40, WORKER)

    // 40 working days spans ~58 calendar days → two 30-day windows.
    expect(source.holidayCalls).toBeLessThanOrEqual(4)
    expect(source.leaveCalls).toBeLessThanOrEqual(4)
  })

  it('يرفض العدّ عندما لا يوجد يوم عمل واحد في المدى', async () => {
    // Every weekday configured as weekend: there is no next working day, and
    // answering with a plausible date would be worse than refusing.
    const never = createCalendar(
      inMemoryCalendarSource({
        weekendDays: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'],
        recurringHolidays: ['01-01'],
      }),
    )
    // Saturday is the only working day left, then removed for one year by a
    // stretch of leave — long enough to run past the search horizon.
    const blocked = createCalendar(
      inMemoryCalendarSource({
        weekendDays: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'],
        leave: [{ userId: WORKER, start: '2020-01-01', end: '2039-12-31' }],
      }),
    )
    await expect(never.addWorkingDays(cairo('2026-03-01T09:00'), 1)).resolves.toEqual(
      cairo('2026-03-07T09:00'),
    )
    await expect(
      blocked.addWorkingDays(cairo('2026-03-01T09:00'), 1, WORKER),
    ).rejects.toThrow()
  })
})
