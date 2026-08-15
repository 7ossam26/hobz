import { describe, expect, it } from 'vitest'

import { computeElapsed, minutesBetween } from '@/modules/task/elapsed'
import { stampTimestamps, type TaskTimestamps } from '@/modules/task/state-machine'

import { businessDayCalendar, cairoDate } from '../../helpers/calendar'
import { cairo, cairoWeekday, HOUR_MS } from '../../helpers/time'

/**
 * Axis 2 of the edge-case protocol (docs/TESTING.md §4) — **Time**.
 *
 * SPEC §2 locks one decision that everything here depends on: *"Timezone:
 * Africa/Cairo everywhere. Store UTC, render Cairo."* Two numbers come out of
 * SPEC §5.2 and they answer to different clocks:
 *
 *  - `elapsedMinutesRaw` is **absolute**. It is the distance between two
 *    instants, so it neither knows nor cares what the wall clock read at either
 *    end.
 *  - `elapsedMinutesWorking` is **Cairo-calendar-based**. It accrues inside
 *    Cairo days, inside Cairo workday windows.
 *
 * The axis text in docs/TESTING.md still says "DST-free". That is stale: Egypt
 * reinstated summer time in 2023 (forward on the last Friday of April, back on
 * the last Thursday of October), so a Cairo year now contains one 23-hour day
 * and one 25-hour day. Both land on a Friday/Thursday pair — exactly the days
 * the default weekend is built around — which is why they are pinned here
 * rather than left to be discovered by a منفّذ whose خصم was an hour's work out.
 *
 * ── Two rules these tests hold themselves to ──────────────────────────────
 *
 * 1. **No hardcoded UTC offset.** Not `+02:00`, not `+03:00`. Every instant is
 *    built from a Cairo wall-clock reading through `cairo()`, which derives the
 *    offset from the zone itself. Where a DST effect is asserted it is asserted
 *    as a *difference* between two identical wall-clock spans — one crossing
 *    the transition, one not — so the suite survives Egypt changing the rule
 *    again.
 * 2. **No `new Date()` in an assertion** (docs/TESTING.md §5).
 */

/** The UTC calendar date of an instant — the reading a UTC-reasoning bug sees. */
const utcDate = (at: Date): string => at.toISOString().slice(0, 10)

const NO_TIMESTAMPS: TaskTimestamps = {
  assignedAt: null,
  startedAt: null,
  submittedAt: null,
  approvedAt: null,
}

describe('modules/task/elapsed — الزمن الخام لحظي لا جِداري (SPEC §2)', () => {
  /**
   * 2026-04-24 is the last Friday of April: Cairo skips 00:00→01:00. The same
   * Thursday-09:00 → Friday-09:00 reading a week earlier spans a full 24 hours,
   * so the transition span must come out exactly one hour shorter. If `raw` were
   * computed from wall-clock components instead of instants, both would read
   * 1440 and the منفّذ would be charged for an hour that never existed.
   */
  it('ينقص الزمن الخام ساعة كاملة عند عبور بداية التوقيت الصيفي', async () => {
    const calendar = businessDayCalendar()

    const acrossTransition = await computeElapsed(calendar, {
      assignedAt: cairo('2026-04-23T09:00'),
      submittedAt: cairo('2026-04-24T09:00'),
      assigneeId: 'user-1',
    })
    const weekEarlier = await computeElapsed(calendar, {
      assignedAt: cairo('2026-04-16T09:00'),
      submittedAt: cairo('2026-04-17T09:00'),
      assigneeId: 'user-1',
    })

    expect(weekEarlier.raw - acrossTransition.raw).toBe(60)
  })

  /**
   * 2026-10-29 is the last Thursday of October: Cairo repeats 23:00→23:59. The
   * mirror of the test above — the wall clock reads the same span, the instants
   * are an hour further apart.
   */
  it('يزيد الزمن الخام ساعة كاملة عند عبور نهاية التوقيت الصيفي', async () => {
    const calendar = businessDayCalendar()

    const acrossTransition = await computeElapsed(calendar, {
      assignedAt: cairo('2026-10-29T09:00'),
      submittedAt: cairo('2026-10-30T09:00'),
      assigneeId: 'user-1',
    })
    const weekLater = await computeElapsed(calendar, {
      assignedAt: cairo('2026-11-05T09:00'),
      submittedAt: cairo('2026-11-06T09:00'),
      assigneeId: 'user-1',
    })

    expect(acrossTransition.raw - weekLater.raw).toBe(60)
  })

  /**
   * The truncation rule (`minutesBetween` floors) has to survive the transition
   * too: the missing hour is subtracted from the true span, and the 59 leftover
   * seconds are still dropped rather than rounded up into a 61st minute.
   */
  it('يهمل الثواني ولا يقرّب لأعلى عبر تحويل التوقيت', () => {
    const acrossTransition = minutesBetween(
      cairo('2026-04-23T23:30:00'),
      cairo('2026-04-24T01:30:59'),
    )
    const weekEarlier = minutesBetween(
      cairo('2026-04-16T23:30:00'),
      cairo('2026-04-17T01:30:59'),
    )

    expect(weekEarlier).toBe(120)
    expect(weekEarlier - acrossTransition).toBe(60)
  })
})

describe('modules/task/elapsed — زمن العمل يتراكم بأيام القاهرة (SPEC §5.2)', () => {
  /**
   * Assigned one minute before Cairo midnight, submitted one minute after. Two
   * Cairo dates are touched and no working minute accrues on either, because
   * both instants sit outside the workday window — while the wall clock
   * honestly records two minutes.
   */
  it('لا يتراكم زمن عمل عبر منتصف ليل القاهرة خارج ساعات الدوام', async () => {
    const result = await computeElapsed(businessDayCalendar(), {
      assignedAt: cairo('2026-03-04T23:59'), // Wednesday
      submittedAt: cairo('2026-03-05T00:01'), // Thursday
      assigneeId: 'user-1',
    })

    expect(result.raw).toBe(2)
    expect(result.working).toBe(0)
  })

  /**
   * The same start, carried into the next Cairo morning: accrual begins at the
   * *next* Cairo day's window opening, not at the assignment instant and not at
   * a UTC midnight.
   */
  it('يبدأ تراكم زمن العمل من فتح نافذة يوم القاهرة التالي', async () => {
    const result = await computeElapsed(businessDayCalendar(), {
      assignedAt: cairo('2026-03-04T23:59'), // Wednesday, window already closed
      submittedAt: cairo('2026-03-05T10:00'), // Thursday, one hour into the day
      assigneeId: 'user-1',
    })

    expect(result.working).toBe(60)
    expect(result.raw).toBe(601)
  })

  /**
   * The repeated hour at the end of summer time falls at 23:00 Cairo — outside
   * the workday window. So the wall clock gains an hour and the منفّذ's working
   * time does not: raw and working move independently, which is the whole point
   * of keeping them two columns.
   */
  it('لا تزيد الساعة المكرَّرة زمن العمل وإن زادت الزمن الخام', async () => {
    const calendar = businessDayCalendar()

    const acrossTransition = await computeElapsed(calendar, {
      assignedAt: cairo('2026-10-29T09:00'),
      submittedAt: cairo('2026-10-30T09:00'),
      assigneeId: 'user-1',
    })
    const weekLater = await computeElapsed(calendar, {
      assignedAt: cairo('2026-11-05T09:00'),
      submittedAt: cairo('2026-11-06T09:00'),
      assigneeId: 'user-1',
    })

    expect(acrossTransition.working).toBe(weekLater.working)
    expect(acrossTransition.raw).toBeGreaterThan(weekLater.raw)
  })

  /**
   * The mirror case, and the one that could break the clamp. A workday window
   * of 00:00–08:00 on the spring-forward date contains the hour Cairo skips.
   * A calendar counting wall-clock hours would report 480 working minutes
   * against a 420-minute wall-clock span — working time exceeding raw, an
   * impossibility that `computeElapsed` clamps but that must not arise here in
   * the first place.
   */
  it('لا تتراكم الساعة المفقودة في بداية التوقيت الصيفي لا خامًا ولا عملًا', async () => {
    const calendar = businessDayCalendar({
      weekendDays: ['SAT', 'SUN'],
      workdayStart: '00:00',
      workdayEnd: '08:00',
    })

    const transitionDay = await computeElapsed(calendar, {
      assignedAt: cairo('2026-04-24T00:00'),
      submittedAt: cairo('2026-04-24T08:00'),
      assigneeId: 'user-1',
    })
    const weekEarlier = await computeElapsed(calendar, {
      assignedAt: cairo('2026-04-17T00:00'),
      submittedAt: cairo('2026-04-17T08:00'),
      assigneeId: 'user-1',
    })

    expect(weekEarlier.working).toBe(weekEarlier.raw)
    expect(transitionDay.working).toBe(transitionDay.raw)
    expect(weekEarlier.working - transitionDay.working).toBe(60)
  })
})

describe('modules/task/elapsed — حدود يوم UTC ليست حدود يوم القاهرة', () => {
  /**
   * Cairo is ahead of UTC, so the first half-hour of a Cairo day still belongs
   * to the previous UTC day. A task assigned there must accrue that Cairo day's
   * full working window; anything reasoning in UTC dates would place the
   * assignment on the day before.
   */
  it('يحتسب يوم عمل كاملًا لمهمة بدأت بعد منتصف ليل القاهرة وهي أمس بتوقيت UTC', async () => {
    const assignedAt = cairo('2026-03-05T00:30') // Thursday in Cairo
    const submittedAt = cairo('2026-03-05T17:00')

    // The trap this test exists for: the two calendars disagree on the date.
    expect(utcDate(assignedAt)).not.toBe(cairoDate(assignedAt))

    const result = await computeElapsed(businessDayCalendar(), {
      assignedAt,
      submittedAt,
      assigneeId: 'user-1',
    })

    expect(result.working).toBe(8 * 60)
    expect(result.raw).toBe(990)
  })

  it('يعدّ الجمعة عطلة من أول لحظة فيها إلى آخر دقيقة بتوقيت القاهرة', async () => {
    const calendar = businessDayCalendar()
    const fridayOpens = cairo('2026-03-06T00:00')
    const fridayCloses = cairo('2026-03-06T23:59')

    expect(cairoWeekday(fridayOpens)).toBe('FRI')
    expect(cairoWeekday(fridayCloses)).toBe('FRI')
    // The first instant of Cairo Friday is still the previous UTC date.
    expect(utcDate(fridayOpens)).not.toBe(cairoDate(fridayOpens))

    expect(await calendar.isWorkingDay(fridayOpens)).toBe(false)
    expect(await calendar.isWorkingDay(fridayCloses)).toBe(false)
  })

  /**
   * The inverse trap, and the more expensive one: an instant that is Saturday
   * in UTC but Sunday in Cairo. Reading UTC would drop a whole working day.
   */
  it('يعدّ الأحد يوم عمل من أول لحظة فيه وهو السبت بتوقيت UTC', async () => {
    const calendar = businessDayCalendar()
    const sundayOpens = cairo('2026-03-08T00:30')

    expect(cairoWeekday(sundayOpens)).toBe('SUN')
    expect(utcDate(sundayOpens)).not.toBe(cairoDate(sundayOpens))

    expect(await calendar.isWorkingDay(sundayOpens)).toBe(true)
  })
})

describe('modules/task/elapsed — نهايات الشهور والسنة الكبيسة', () => {
  /**
   * None of these three boundaries carries a DST transition, so a 24-hour Cairo
   * reading across each is a true 24 hours. What is being pinned is that the
   * month/year rollover itself introduces no drift.
   */
  it('يقيس الزمن الخام عبر نهايات الشهور والسنة بلا انحراف', async () => {
    const calendar = businessDayCalendar()
    const boundaries: Array<[string, string]> = [
      ['2026-01-31T09:00', '2026-02-01T09:00'], // 31 Jan → 1 Feb
      ['2026-04-30T09:00', '2026-05-01T09:00'], // 30 Apr → 1 May
      ['2026-12-31T09:00', '2027-01-01T09:00'], // 31 Dec → 1 Jan, year rollover
    ]

    for (const [from, to] of boundaries) {
      const result = await computeElapsed(calendar, {
        assignedAt: cairo(from),
        submittedAt: cairo(to),
        assigneeId: 'user-1',
      })

      expect(result.raw, `${from} → ${to}`).toBe(24 * 60)
    }
  })

  it('يتراكم زمن العمل عبر انقلاب السنة على أيام العمل وحدها', async () => {
    // Wed 30 Dec and Thu 31 Dec are working days; Fri 1 Jan and Sat 2 Jan are
    // the weekend; Sun 3 Jan is a working day again.
    const result = await computeElapsed(businessDayCalendar(), {
      assignedAt: cairo('2026-12-30T09:00'),
      submittedAt: cairo('2027-01-03T17:00'),
      assigneeId: 'user-1',
    })

    expect(result.working).toBe(3 * 8 * 60)
    expect(result.raw).toBe(4 * 24 * 60 + 8 * 60)
  })

  /**
   * 28 Feb → 1 Mar in a common year: the 29th does not exist and must not be
   * conjured. 2026-02-28 is a Saturday, so only the Sunday half of the span
   * accrues.
   */
  it('يعبر 28 فبراير إلى 1 مارس في سنة عادية بلا يوم إضافي', async () => {
    const result = await computeElapsed(businessDayCalendar(), {
      assignedAt: cairo('2026-02-28T15:00'), // Saturday
      submittedAt: cairo('2026-03-01T15:00'), // Sunday
      assigneeId: 'user-1',
    })

    expect(result.raw).toBe(24 * 60)
    expect(result.working).toBe(6 * 60) // Sunday 09:00 → 15:00
  })

  it('يضيف 29 فبراير يومًا كاملًا للزمن الخام في السنة الكبيسة', async () => {
    const calendar = businessDayCalendar()

    const leapYear = await computeElapsed(calendar, {
      assignedAt: cairo('2028-02-28T09:00'),
      submittedAt: cairo('2028-03-01T09:00'),
      assigneeId: 'user-1',
    })
    const commonYear = await computeElapsed(calendar, {
      assignedAt: cairo('2026-02-28T09:00'),
      submittedAt: cairo('2026-03-01T09:00'),
      assigneeId: 'user-1',
    })

    expect(leapYear.raw - commonYear.raw).toBe(24 * 60)
  })

  it('يتراكم زمن العمل على 29 فبراير كأي يوم عمل', async () => {
    // In 2028 the 28th is a Monday, the 29th a Tuesday, the 1st a Wednesday.
    const result = await computeElapsed(businessDayCalendar(), {
      assignedAt: cairo('2028-02-28T09:00'),
      submittedAt: cairo('2028-03-01T09:00'),
      assigneeId: 'user-1',
    })

    expect(result.working).toBe(2 * 8 * 60)
  })
})

describe('modules/task/state-machine — ختم الأوقات مستقل عن المنطقة الزمنية', () => {
  /**
   * `stampTimestamps` stores an instant. It must hand back the very `Date` it
   * was given — no reconstruction, no normalisation to a day boundary, no
   * dropping of milliseconds. Anything less would quietly move a delivery
   * instant, and lateness (§5.3) is measured against it.
   */
  it('يخزن لحظة التسليم كما هي بلا تقريب ولا تسوية', () => {
    const now = new Date(cairo('2026-02-28T23:59:59').getTime() + 123)

    const patch = stampTimestamps('SUBMITTED', NO_TIMESTAMPS, now)

    expect(patch.submittedAt).toBe(now)
    expect(patch.submittedAt?.getTime()).toBe(now.getTime())
    expect((patch.submittedAt?.getTime() ?? 0) % 1000).toBe(123)
  })

  /**
   * The repeated hour at the end of summer time makes one Cairo wall-clock
   * reading name two different instants. A re-submission an hour later reads
   * 23:30 on both clocks — the stamp must still move forward, because the
   * machine compares instants and never wall clocks.
   */
  it('يفرّق بين تسليمين في الساعة الجدارية المكرَّرة عند نهاية التوقيت الصيفي', () => {
    // `cairo()` resolves an ambiguous reading to the later (post-transition)
    // instant; the earlier one is exactly one hour before it.
    const secondPass = cairo('2026-10-29T23:30')
    const firstPass = new Date(secondPass.getTime() - HOUR_MS)

    expect(cairoWeekday(firstPass)).toBe(cairoWeekday(secondPass))
    expect(secondPass.getTime() - firstPass.getTime()).toBe(HOUR_MS)

    const patch = stampTimestamps(
      'SUBMITTED',
      { ...NO_TIMESTAMPS, submittedAt: firstPass },
      secondPass,
    )

    expect(patch.submittedAt).toBe(secondPass)
  })

  /**
   * The stamp-once rule is about the *field*, not about the clock. A second
   * entry to ASSIGNED on the far side of a DST transition is still a second
   * entry, and `assignedAt` still refuses it.
   */
  it('لا يعيد ختم assignedAt عبر تحويل التوقيت', () => {
    const beforeTransition = cairo('2026-04-23T20:00')
    const afterTransition = cairo('2026-04-24T06:00')

    const patch = stampTimestamps(
      'ASSIGNED',
      { ...NO_TIMESTAMPS, assignedAt: beforeTransition },
      afterTransition,
    )

    expect(patch).toEqual({})
  })
})
