import { describe, expect, it } from 'vitest'

import { cairoParts } from '@/lib/calendar/cairo'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { CYCLE_END_MINUTE_OF_DAY, cycleEndAfter } from '@/modules/payout/period'

import { cairo, cairoOffsetMinutes, findCairoTransitions } from '../../helpers/time'

/**
 * SPEC §5.5: "Cycle auto-closes on `settings.payoutCycleDay` (default 28) at
 * 23:59 Cairo."
 *
 * The whole of that sentence is arithmetic on a Cairo wall clock, and every
 * assertion below is written against a Cairo wall clock (`cairo('…')`) rather
 * than a UTC instant — so nothing here encodes a `+02:00` that stops being true
 * for half the year (docs/TESTING.md §4 axis 2).
 */
const CYCLE_DAY = SETTINGS_CATALOG['payout.cycleDay'].default

describe('modules/payout/period — نهاية الدورة القادمة', () => {
  it('تقع في نفس الشهر إذا لم يمر يوم الإغلاق بعد', () => {
    expect(cycleEndAfter(cairo('2026-08-15T10:00'), 28)).toEqual(
      cairo('2026-08-28T23:59'),
    )
  })

  it('تقع الليلة نفسها قبل 23:59 بدقيقة واحدة', () => {
    expect(cycleEndAfter(cairo('2026-08-28T23:58'), 28)).toEqual(
      cairo('2026-08-28T23:59'),
    )
  })

  it('تنتقل للشهر التالي عند 23:59 بالضبط — الحد مفتوح من الأعلى', () => {
    // Strictly after `now`: closing a cycle at its own periodEnd must open the
    // next one a month out, not re-open the one that just ended.
    expect(cycleEndAfter(cairo('2026-08-28T23:59'), 28)).toEqual(
      cairo('2026-09-28T23:59'),
    )
  })

  it('تنتقل للشهر التالي بعد مرور يوم الإغلاق', () => {
    expect(cycleEndAfter(cairo('2026-08-29T00:00'), 28)).toEqual(
      cairo('2026-09-28T23:59'),
    )
  })

  it('تعبر رأس السنة', () => {
    expect(cycleEndAfter(cairo('2026-12-29T09:00'), 28)).toEqual(
      cairo('2027-01-28T23:59'),
    )
  })

  it('يوم 28 موجود في فبراير — بما فيه غير الكبيسة', () => {
    // The catalog caps `payout.cycleDay` at 28 precisely so this needs no
    // special case. 2027 is not a leap year.
    expect(cycleEndAfter(cairo('2027-02-01T09:00'), 28)).toEqual(
      cairo('2027-02-28T23:59'),
    )
    expect(cycleEndAfter(cairo('2028-02-01T09:00'), 28)).toEqual(
      cairo('2028-02-28T23:59'),
    )
  })

  it('يحترم يوم إغلاق مخصّصًا', () => {
    expect(cycleEndAfter(cairo('2026-08-15T10:00'), 1)).toEqual(cairo('2026-09-01T23:59'))
    expect(cycleEndAfter(cairo('2026-08-15T10:00'), 20)).toEqual(
      cairo('2026-08-20T23:59'),
    )
    expect(cycleEndAfter(cairo('2026-08-15T10:00'), 15)).toEqual(
      cairo('2026-08-15T23:59'),
    )
  })

  it('يرفض يوم إغلاق خارج نطاق الإعدادات', () => {
    expect(() => cycleEndAfter(cairo('2026-08-15T10:00'), 0)).toThrow(RangeError)
    expect(() => cycleEndAfter(cairo('2026-08-15T10:00'), 29)).toThrow(RangeError)
    expect(() => cycleEndAfter(cairo('2026-08-15T10:00'), 1.5)).toThrow(RangeError)
  })

  it('الافتراضي في الكتالوج يقع دائمًا في يوم موجود بكل شهر', () => {
    expect(CYCLE_DAY).toBeLessThanOrEqual(28)
    expect(CYCLE_DAY).toBeGreaterThanOrEqual(1)
  })

  it('الدقيقة المستهدفة هي 23:59 بتوقيت القاهرة', () => {
    expect(CYCLE_END_MINUTE_OF_DAY).toBe(23 * 60 + 59)
  })
})

describe('modules/payout/period — التوقيت الصيفي', () => {
  it('يظل 23:59 بتوقيت القاهرة على جانبي التحويل', () => {
    // Egypt reinstated summer time in 2023 (docs/TESTING.md §4 axis 2). A cycle
    // end computed as "periodStart + 30 days" or against a fixed +02:00 would
    // land at 22:59 or 00:59 for half the year; this one must not.
    const transitions = findCairoTransitions(2026)
    expect(transitions.forward).not.toBeNull()
    expect(transitions.back).not.toBeNull()

    const summerEnd = cycleEndAfter(cairo('2026-06-15T10:00'), 28)
    const winterEnd = cycleEndAfter(cairo('2026-12-15T10:00'), 28)

    expect(cairoParts(summerEnd).hour).toBe(23)
    expect(cairoParts(summerEnd).minute).toBe(59)
    expect(cairoParts(winterEnd).hour).toBe(23)
    expect(cairoParts(winterEnd).minute).toBe(59)

    // And the two really are on different offsets, or the assertion above
    // would pass for a reason that has nothing to do with DST.
    expect(cairoOffsetMinutes(summerEnd)).not.toBe(cairoOffsetMinutes(winterEnd))
  })

  it('يعبر ليلة التحويل نفسها دون أن يفقد يومًا', () => {
    const { forward } = findCairoTransitions(2026)
    if (!forward) throw new Error('expected a spring-forward transition in 2026')

    const dayOfTransition = cairoParts(forward).day
    const end = cycleEndAfter(new Date(forward.getTime() - 60_000), dayOfTransition)

    expect(cairoParts(end).day).toBe(dayOfTransition)
    expect(cairoParts(end).hour).toBe(23)
    expect(cairoParts(end).minute).toBe(59)
  })
})
