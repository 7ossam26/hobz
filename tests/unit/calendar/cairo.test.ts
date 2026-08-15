import { describe, expect, it } from 'vitest'

import {
  addCairoDays,
  cairoDateKey,
  cairoDaysBetweenKeys,
  cairoInstant,
  endOfCairoDay,
  isCairoDateKey,
  parseTimeOfDay,
  startOfCairoDay,
  weekdayOfKey,
} from '@/lib/calendar'

import {
  cairo,
  cairoOffsetMinutes,
  findCairoTransitions,
  HOUR_MS,
} from '../../helpers/time'

/**
 * The civil-date layer under `lib/calendar` (SPEC §4 Calendar, CLAUDE.md
 * invariant 5). Everything above it — lateness, elapsed working time, the
 * penalty engine — is only as correct as "which Cairo day is this instant on"
 * and "what is the next day", so those two questions get their own suite.
 *
 * Nothing here subtracts two `Date`s. Day arithmetic runs on the civil fields.
 */

describe('cairoDateKey', () => {
  it('يعطي تاريخ القاهرة لا تاريخ UTC عند منتصف الليل', () => {
    // 22:30Z on 14 August is already 00:30 on the 15th in Cairo.
    expect(cairoDateKey(new Date('2026-08-14T22:30:00Z'))).toBe('2026-08-15')
  })

  it('يعطي اليوم نفسه قبل منتصف الليل بالقاهرة', () => {
    expect(cairoDateKey(new Date('2026-08-14T20:59:00Z'))).toBe('2026-08-14')
  })

  it('يتعامل مع بداية السنة الميلادية', () => {
    expect(cairoDateKey(new Date('2025-12-31T22:00:00Z'))).toBe('2026-01-01')
  })
})

describe('weekdayOfKey', () => {
  it('يحسب اليوم من التاريخ المدني لا من كائن Date', () => {
    // 2026-08-14 is a Friday; the rest of that week follows.
    expect(weekdayOfKey('2026-08-14')).toBe('FRI')
    expect(weekdayOfKey('2026-08-15')).toBe('SAT')
    expect(weekdayOfKey('2026-08-16')).toBe('SUN')
    expect(weekdayOfKey('2026-08-20')).toBe('THU')
  })

  it('يتفق مع Intl على مدى سنة كاملة', () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      weekday: 'short',
    })

    let key = '2026-01-01'
    for (let day = 0; day < 365; day += 1) {
      const viaIntl = formatter.format(cairo(`${key}T12:00`)).toUpperCase()
      expect(weekdayOfKey(key)).toBe(viaIntl)
      key = addCairoDays(key, 1)
    }
  })
})

describe('addCairoDays', () => {
  it('يعبر نهاية الشهر ذي الثلاثين يومًا', () => {
    expect(addCairoDays('2026-04-30', 1)).toBe('2026-05-01')
  })

  it('يعبر نهاية الشهر ذي الواحد والثلاثين يومًا', () => {
    expect(addCairoDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addCairoDays('2026-03-31', 1)).toBe('2026-04-01')
  })

  it('يتعامل مع فبراير في سنة عادية', () => {
    expect(addCairoDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addCairoDays('2026-02-27', 2)).toBe('2026-03-01')
  })

  it('يتعامل مع 29 فبراير في سنة كبيسة', () => {
    expect(addCairoDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addCairoDays('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('يتعامل مع القرن غير الكبيس ومع القرن الكبيس', () => {
    // 1900 was not a leap year; 2000 was. Both are the proleptic-Gregorian
    // rules a naive `% 4` would get wrong.
    expect(addCairoDays('1900-02-28', 1)).toBe('1900-03-01')
    expect(addCairoDays('2000-02-28', 1)).toBe('2000-02-29')
  })

  it('يعبر نهاية السنة في الاتجاهين', () => {
    expect(addCairoDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addCairoDays('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('يرجع نفس اليوم عند إضافة صفر', () => {
    expect(addCairoDays('2026-02-28', 0)).toBe('2026-02-28')
  })
})

describe('cairoDaysBetweenKeys', () => {
  it('يعد الأيام بين تاريخين مدنيين', () => {
    expect(cairoDaysBetweenKeys('2026-08-14', '2026-08-14')).toBe(0)
    expect(cairoDaysBetweenKeys('2026-08-14', '2026-08-15')).toBe(1)
    expect(cairoDaysBetweenKeys('2026-01-31', '2026-03-01')).toBe(29)
  })

  it('يعطي عددًا سالبًا عند عكس الاتجاه', () => {
    expect(cairoDaysBetweenKeys('2026-08-15', '2026-08-14')).toBe(-1)
  })

  it('لا يتأثر بالتوقيت الصيفي', () => {
    // April has 30 days regardless of the 23-hour day inside it. Counting via
    // millisecond subtraction would return 29.958… and floor to 29.
    expect(cairoDaysBetweenKeys('2026-04-01', '2026-05-01')).toBe(30)
    expect(cairoDaysBetweenKeys('2026-10-01', '2026-11-01')).toBe(31)
  })
})

describe('isCairoDateKey', () => {
  it('يقبل الصيغة الصحيحة فقط', () => {
    expect(isCairoDateKey('2026-08-14')).toBe(true)
    expect(isCairoDateKey('2026-8-14')).toBe(false)
    expect(isCairoDateKey('2026-13-01')).toBe(false)
    expect(isCairoDateKey('2026-02-30')).toBe(false)
    expect(isCairoDateKey('')).toBe(false)
  })

  it('يقبل 29 فبراير في السنة الكبيسة فقط', () => {
    expect(isCairoDateKey('2028-02-29')).toBe(true)
    expect(isCairoDateKey('2026-02-29')).toBe(false)
  })
})

describe('parseTimeOfDay', () => {
  it('يحول HH:mm إلى دقائق من بداية اليوم', () => {
    expect(parseTimeOfDay('00:00')).toBe(0)
    expect(parseTimeOfDay('09:00')).toBe(540)
    expect(parseTimeOfDay('17:30')).toBe(1050)
    expect(parseTimeOfDay('23:59')).toBe(1439)
  })

  it('يرفض الصيغ غير الصالحة', () => {
    expect(() => parseTimeOfDay('9:00')).toThrow()
    expect(() => parseTimeOfDay('24:00')).toThrow()
    expect(() => parseTimeOfDay('09:60')).toThrow()
  })
})

describe('startOfCairoDay / cairoInstant', () => {
  it('يبني اللحظة المقابلة لساعة الحائط بالقاهرة', () => {
    expect(cairoInstant('2026-01-15', 9 * 60)).toEqual(cairo('2026-01-15T09:00'))
    expect(cairoInstant('2026-07-15', 9 * 60)).toEqual(cairo('2026-07-15T09:00'))
  })

  it('يستخدم الإزاحة الشتوية والصيفية كلًّا في موضعه', () => {
    // Winter is +02:00, summer +03:00 — derived, never assumed.
    const winter = startOfCairoDay('2026-01-15')
    const summer = startOfCairoDay('2026-07-15')
    expect(cairoOffsetMinutes(winter)).toBe(120)
    expect(cairoOffsetMinutes(summer)).toBe(180)
  })

  it('يعطي أول لحظة موجودة فعلًا في يوم يبدأ بتقديم الساعة', () => {
    const { forward } = findCairoTransitions(2026)
    expect(forward).not.toBeNull()

    // The Cairo day the clock jumps forward into starts at 01:00, not 00:00 —
    // 00:00 does not exist on that date. `startOfCairoDay` must still land on
    // that date rather than on the previous one.
    const key = cairoDateKey(forward as Date)
    const start = startOfCairoDay(key)
    expect(cairoDateKey(start)).toBe(key)
    expect(start.getTime()).toBe((forward as Date).getTime())
  })

  it('يعطي يومًا مدته 23 ساعة عند تقديم الساعة', () => {
    const { forward } = findCairoTransitions(2026)
    const key = cairoDateKey(forward as Date)
    const length = endOfCairoDay(key).getTime() - startOfCairoDay(key).getTime()
    expect(length).toBe(23 * HOUR_MS)
  })

  it('يعطي يومًا مدته 25 ساعة عند تأخير الساعة', () => {
    const { back } = findCairoTransitions(2026)
    expect(back).not.toBeNull()
    // Egypt ends summer time at 24:00 local, so the clock reads 23:00 again on
    // the *same* Cairo date — that date is the 25-hour one.
    const key = cairoDateKey(back as Date)
    const length = endOfCairoDay(key).getTime() - startOfCairoDay(key).getTime()
    expect(length).toBe(25 * HOUR_MS)
  })

  it('كل يوم في السنة مدته 23 أو 24 أو 25 ساعة، ولا يومين يتداخلان', () => {
    let key = '2026-01-01'
    let previousEnd = startOfCairoDay(key)

    for (let day = 0; day < 365; day += 1) {
      const start = startOfCairoDay(key)
      const end = endOfCairoDay(key)

      // No gaps and no overlaps: yesterday ends exactly where today starts.
      expect(start.getTime()).toBe(previousEnd.getTime())
      expect([23, 24, 25]).toContain((end.getTime() - start.getTime()) / HOUR_MS)
      expect(cairoDateKey(start)).toBe(key)

      previousEnd = end
      key = addCairoDays(key, 1)
    }
  })
})
