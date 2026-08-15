import { describe, expect, it } from 'vitest'

import {
  addDays,
  addMonthsUtc,
  fromDateParam,
  isSameUtcDay,
  monthGridRange,
  startOfMonthUtc,
  startOfUtcDay,
  startOfWeekUtc,
  toDateParam,
  weekRange,
} from '@/app/(app)/tasks/calendar/date-grid'

/** Pure UTC-day grid maths for the Phase 5 calendar view. No Cairo/DST logic
 *  belongs here — that is `lib/calendar`'s, Phase 6's, and explicitly out of
 *  scope for what is decoration, not a lateness calculation. */

describe('startOfUtcDay / isSameUtcDay', () => {
  it('يُسقط مكوّنات الوقت ويُبقي على اليوم فقط', () => {
    const value = new Date('2026-08-15T23:59:59.999Z')
    expect(startOfUtcDay(value).toISOString()).toBe('2026-08-15T00:00:00.000Z')
  })

  it('يعتبر لحظتين في نفس اليوم متطابقتين رغم اختلاف الوقت', () => {
    expect(
      isSameUtcDay(new Date('2026-08-15T01:00:00Z'), new Date('2026-08-15T22:00:00Z')),
    ).toBe(true)
  })

  it('يعتبر منتصف الليل من يومين متتاليين مختلفين', () => {
    expect(
      isSameUtcDay(new Date('2026-08-15T23:59:59Z'), new Date('2026-08-16T00:00:00Z')),
    ).toBe(false)
  })
})

describe('startOfWeekUtc', () => {
  it('يرجع نفس اليوم عندما يكون الأحد بالفعل', () => {
    const sunday = new Date('2026-08-16T00:00:00Z') // a Sunday
    expect(startOfWeekUtc(sunday).toISOString()).toBe('2026-08-16T00:00:00.000Z')
  })

  it('يرجع الأحد السابق لأي يوم آخر في الأسبوع', () => {
    const saturday = new Date('2026-08-22T12:00:00Z') // a Saturday
    expect(startOfWeekUtc(saturday).toISOString()).toBe('2026-08-16T00:00:00.000Z')
  })
})

describe('monthGridRange', () => {
  it('يبني دائمًا شبكة من ٦ أسابيع (٤٢ خانة) بلا تغيّر في الارتفاع', () => {
    // August 2026 starts on a Saturday — a short month by weekday count, the
    // exact case that would produce only 5 rows if the grid were sized to
    // the month instead of pinned at 6.
    const { weeks } = monthGridRange(new Date('2026-08-01T00:00:00Z'))
    expect(weeks).toHaveLength(6)
    for (const week of weeks) expect(week).toHaveLength(7)
  })

  it('يبدأ الشبكة يوم أحد ولو كان الشهر لا يبدأ به', () => {
    const { from, weeks } = monthGridRange(new Date('2026-08-01T00:00:00Z'))
    expect(from.getUTCDay()).toBe(0)
    expect(weeks[0]?.[0]?.getUTCDay()).toBe(0)
  })

  it('يغطي أول وآخر يوم في الشهر داخل الشبكة', () => {
    const { from, to } = monthGridRange(new Date('2026-08-15T00:00:00Z'))
    const monthStart = startOfMonthUtc(new Date('2026-08-15T00:00:00Z'))
    const monthEnd = addMonthsUtc(monthStart, 1) // first of the *next* month
    expect(from.getTime()).toBeLessThanOrEqual(monthStart.getTime())
    expect(to.getTime()).toBeGreaterThanOrEqual(addDays(monthEnd, -1).getTime())
  })
})

describe('weekRange', () => {
  it('يبني أسبوعًا من ٧ أيام من الأحد إلى السبت', () => {
    const { from, to, days } = weekRange(new Date('2026-08-19T00:00:00Z')) // a Wednesday
    expect(days).toHaveLength(7)
    expect(from.getUTCDay()).toBe(0)
    expect(to.getUTCDay()).toBe(6)
    expect(days[0]?.getTime()).toBe(from.getTime())
    expect(days[6]?.getTime()).toBe(to.getTime())
  })
})

describe('toDateParam / fromDateParam round trip', () => {
  it('يحافظ على نفس اليوم عبر التحويل ذهابًا وإيابًا', () => {
    const date = new Date('2026-12-31T00:00:00Z')
    const param = toDateParam(date)
    expect(param).toBe('2026-12-31')
    expect(fromDateParam(param, new Date()).toISOString()).toBe(date.toISOString())
  })

  it('يرجع الاحتياطي عند قيمة تالفة أو مفقودة، بدل رمي خطأ', () => {
    const fallback = new Date('2026-01-01T00:00:00Z')
    expect(fromDateParam('not-a-date', fallback).toISOString()).toBe(
      fallback.toISOString(),
    )
    expect(fromDateParam(undefined, fallback).toISOString()).toBe(fallback.toISOString())
    expect(fromDateParam(null, fallback).toISOString()).toBe(fallback.toISOString())
  })
})
