import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import {
  cairoParts,
  cairoWeekday,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTime,
  isSameCairoDay,
  toCairoDateInput,
  toCairoDateTimeInput,
} from '@/lib/datetime'

/**
 * docs/TESTING.md §4 axis 2 (time) and axis 10 (Arabic).
 *
 * Everything is asserted in Cairo wall-clock terms from a UTC instant, because
 * that is the only conversion this module performs and the only one that can be
 * wrong in a way a user notices — a deadline that reads 23:00 on the 14th to a
 * manager and 01:00 on the 15th to a worker is a dispute about a deduction.
 *
 * Egypt has had no DST since 2014 and reinstated it in 2023, so the offset is
 * +02:00 in winter and +03:00 in summer. The cases below deliberately sit on
 * both sides of that.
 */

/** 14 August 2026, 09:30 UTC → 12:30 Cairo (summer, UTC+3). */
const SUMMER = new Date('2026-08-14T09:30:00.000Z')
/** 14 January 2026, 09:30 UTC → 11:30 Cairo (winter, UTC+2). */
const WINTER = new Date('2026-01-14T09:30:00.000Z')

describe('cairoParts', () => {
  it('يحوّل لحظة UTC إلى ساعة القاهرة', () => {
    expect(cairoParts(SUMMER)).toMatchObject({
      year: 2026,
      month: 8,
      day: 14,
      hour: 12,
      minute: 30,
    })
  })

  it('يحترم فرق التوقيت الصيفي والشتوي', () => {
    expect(cairoParts(WINTER).hour).toBe(11)
    expect(cairoParts(SUMMER).hour).toBe(12)
  })

  it('يعبر حدّ منتصف الليل إلى اليوم التالي بتوقيت القاهرة', () => {
    // 22:30 UTC on the 14th is already 01:30 on the 15th in Cairo.
    const parts = cairoParts(new Date('2026-08-14T22:30:00.000Z'))
    expect(parts.day).toBe(15)
    expect(parts.hour).toBe(1)
  })

  it('يعرض منتصف الليل كالساعة صفر لا 24', () => {
    expect(cairoParts(new Date('2026-08-14T21:00:00.000Z')).hour).toBe(0)
  })

  it('يعطي يوم الأسبوع الصحيح', () => {
    expect(cairoWeekday(SUMMER)).toBe('FRI')
  })
})

describe('formatDate', () => {
  it('يكتب التاريخ ميلاديًا باسم شهر عربي وأرقام غربية', () => {
    expect(formatDate(SUMMER)).toBe(`14 ${ar.months[7]} 2026`)
    expect(formatDate(WINTER)).toBe(`14 ${ar.months[0]} 2026`)
  })

  it('لا يستخدم الأرقام العربية-الهندية إطلاقًا', () => {
    // SPEC §2: Western numerals everywhere, including inside Arabic text.
    expect(formatDate(SUMMER)).not.toMatch(/[٠-٩]/)
    expect(formatDateTime(SUMMER)).not.toMatch(/[٠-٩]/)
  })

  it('الصيغة المختصرة تحذف السنة', () => {
    expect(formatDateShort(SUMMER)).toBe(`14 ${ar.months[7]}`)
  })

  it('يكتب الوقت بنظام 24 ساعة بتوقيت القاهرة', () => {
    expect(formatTime(SUMMER)).toBe('12:30')
    expect(formatTime(new Date('2026-08-14T05:05:00.000Z'))).toBe('08:05')
  })

  it('يجمع التاريخ والوقت بالفاصلة العربية', () => {
    expect(formatDateTime(SUMMER)).toBe(
      `14 ${ar.months[7]} 2026${ar.common.listSeparator}12:30`,
    )
  })
})

describe('machine forms', () => {
  it('يكتب التاريخ بصيغة حقل الإدخال بتوقيت القاهرة', () => {
    expect(toCairoDateInput(SUMMER)).toBe('2026-08-14')
    expect(toCairoDateInput(new Date('2026-08-14T22:30:00.000Z'))).toBe('2026-08-15')
  })

  it('يكتب التاريخ والوقت بصيغة datetime-local', () => {
    expect(toCairoDateTimeInput(SUMMER)).toBe('2026-08-14T12:30')
  })

  it('يقارن اليومين بتوقيت القاهرة لا بتوقيت UTC', () => {
    const lateNightCairo = new Date('2026-08-14T21:30:00.000Z') // 15 Aug, 00:30 Cairo
    const nextMorning = new Date('2026-08-15T06:00:00.000Z')

    expect(isSameCairoDay(lateNightCairo, nextMorning)).toBe(true)
    expect(isSameCairoDay(SUMMER, lateNightCairo)).toBe(false)
  })
})

describe('formatRelative', () => {
  const now = SUMMER

  const past = (ms: number) => new Date(now.getTime() - ms)
  const future = (ms: number) => new Date(now.getTime() + ms)

  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  it('يقول «الآن» تحت عتبة الدقيقة', () => {
    expect(formatRelative(past(10_000), now)).toBe(ar.time.now)
    expect(formatRelative(future(10_000), now)).toBe(ar.time.now)
  })

  it('يستخدم صيغة المفرد والمثنى والجمع الصحيحة', () => {
    // Arabic counts in four bands, not two. Getting this wrong is the fastest
    // way to make a product read as machine-translated.
    expect(formatRelative(past(MINUTE), now)).toBe('منذ دقيقة')
    expect(formatRelative(past(2 * MINUTE), now)).toBe('منذ دقيقتين')
    expect(formatRelative(past(5 * MINUTE), now)).toBe('منذ 5 دقائق')
    expect(formatRelative(past(20 * MINUTE), now)).toBe('منذ 20 دقيقة')
  })

  it('يميّز الماضي عن المستقبل', () => {
    expect(formatRelative(past(3 * HOUR), now)).toBe('منذ 3 ساعات')
    expect(formatRelative(future(3 * HOUR), now)).toBe('خلال 3 ساعات')
  })

  it('يختار أخشن وحدة مناسبة', () => {
    expect(formatRelative(past(90 * MINUTE), now)).toBe('منذ ساعة')
    expect(formatRelative(past(3 * DAY), now)).toBe('منذ 3 أيام')
    expect(formatRelative(past(10 * DAY), now)).toBe('منذ أسبوع')
    expect(formatRelative(past(60 * DAY), now)).toBe('منذ شهرين')
    expect(formatRelative(past(400 * DAY), now)).toBe('منذ سنة')
  })

  it('لا يقول «منذ 0 دقيقة» عند تجاوز العتبة بقليل', () => {
    expect(formatRelative(past(50_000), now)).toBe('منذ دقيقة')
  })
})

describe('formatDuration', () => {
  it('يكتب المدة بالساعات والدقائق', () => {
    expect(formatDuration(195)).toBe('3 ساعات و15 دقيقة')
    expect(formatDuration(60)).toBe('ساعة')
    expect(formatDuration(120)).toBe('ساعتين')
    expect(formatDuration(45)).toBe('45 دقيقة')
  })

  it('يتعامل مع الصفر والقيم السالبة', () => {
    expect(formatDuration(0)).toBe('0 دقيقة')
    expect(formatDuration(-30)).toBe('0 دقيقة')
  })

  it('يقرّب الكسور إلى أقرب دقيقة', () => {
    expect(formatDuration(59.6)).toBe('ساعة')
  })
})
