import { describe, expect, it } from 'vitest'

import { createCalendar, startOfCairoDay } from '@/lib/calendar'

import { cairoDate, inMemoryCalendarSource } from '../../helpers/calendar'
import { cairo, findCairoTransitions } from '../../helpers/time'

/**
 * `workingMinutesBetween` — SPEC §5.2's `elapsedMinutesWorking`.
 *
 * Minutes accrue only inside the configured workday window, and only on days
 * that are working days for the person being measured. That is what makes
 * "submitted at 22:00 on a Friday" contribute exactly zero, and it is why the
 * T2 edge case holds without any special-casing.
 *
 * Fixture week is March 2026 again: 1 March is a Sunday, 6–7 the weekend.
 */

const WORKER = 'user-1'
const FULL_DAY = 8 * 60

const plain = () => createCalendar(inMemoryCalendarSource())

describe('workingMinutesBetween — يوم واحد', () => {
  it('يحتسب نافذة العمل كاملة', async () => {
    await expect(
      plain().workingMinutesBetween(cairo('2026-03-01T09:00'), cairo('2026-03-01T17:00')),
    ).resolves.toBe(FULL_DAY)
  })

  it('يقصّ ما قبل بداية الدوام وما بعد نهايته', async () => {
    await expect(
      plain().workingMinutesBetween(cairo('2026-03-01T06:00'), cairo('2026-03-01T23:00')),
    ).resolves.toBe(FULL_DAY)
  })

  it('يحتسب جزءًا من اليوم بالدقيقة', async () => {
    await expect(
      plain().workingMinutesBetween(cairo('2026-03-01T12:00'), cairo('2026-03-01T13:30')),
    ).resolves.toBe(90)
  })

  it('لا يحتسب شيئًا خارج نافذة العمل', async () => {
    await expect(
      plain().workingMinutesBetween(cairo('2026-03-01T17:00'), cairo('2026-03-01T23:59')),
    ).resolves.toBe(0)
  })

  it('لا يحتسب شيئًا عند تساوي الطرفين أو عكسهما', async () => {
    const at = cairo('2026-03-01T10:00')
    await expect(plain().workingMinutesBetween(at, at)).resolves.toBe(0)
    await expect(
      plain().workingMinutesBetween(at, cairo('2026-03-01T09:00')),
    ).resolves.toBe(0)
  })

  it('يحترم نافذة عمل مختلفة من الإعدادات', async () => {
    const shortDay = createCalendar(
      inMemoryCalendarSource({ workdayStart: '10:00', workdayEnd: '14:00' }),
    )
    await expect(
      shortDay.workingMinutesBetween(
        cairo('2026-03-01T00:00'),
        cairo('2026-03-02T00:00'),
      ),
    ).resolves.toBe(240)
  })

  it('لا يحتسب شيئًا عندما تكون نهاية الدوام قبل بدايته', async () => {
    // A misconfigured window has no honest length. Zero is the only answer
    // that cannot inflate someone's elapsed time.
    const inverted = createCalendar(
      inMemoryCalendarSource({ workdayStart: '17:00', workdayEnd: '09:00' }),
    )
    await expect(
      inverted.workingMinutesBetween(
        cairo('2026-03-01T00:00'),
        cairo('2026-03-05T00:00'),
      ),
    ).resolves.toBe(0)
  })
})

describe('workingMinutesBetween — عدة أيام', () => {
  it('يجمع الأيام الكاملة الواقعة بين الطرفين', async () => {
    // Sunday 00:00 → next Sunday 00:00: five working days, no partial ones.
    await expect(
      plain().workingMinutesBetween(
        startOfCairoDay('2026-03-01'),
        startOfCairoDay('2026-03-08'),
      ),
    ).resolves.toBe(5 * FULL_DAY)
  })

  it('يجمع طرفين جزئيين مع أيام كاملة بينهما', async () => {
    // Sunday 16:00 → Tuesday 10:00 = 60 + 480 + 60.
    await expect(
      plain().workingMinutesBetween(cairo('2026-03-01T16:00'), cairo('2026-03-03T10:00')),
    ).resolves.toBe(60 + FULL_DAY + 60)
  })

  it('لا يحتسب عطلة نهاية الأسبوع', async () => {
    // Thursday 16:00 → Sunday 10:00 = 60 (Thu) + 0 (Fri, Sat) + 60 (Sun).
    await expect(
      plain().workingMinutesBetween(cairo('2026-03-05T16:00'), cairo('2026-03-08T10:00')),
    ).resolves.toBe(120)
  })

  it('العمل التطوعي يوم الإجازة لا يزيد الوقت ولا ينقصه (SPEC §5.2 T2)', async () => {
    const calendar = plain()
    const from = cairo('2026-03-05T16:00')

    const stoppedThursday = await calendar.workingMinutesBetween(
      from,
      cairo('2026-03-05T23:59'),
    )
    const workedFriday = await calendar.workingMinutesBetween(
      from,
      cairo('2026-03-06T22:00'),
    )
    const workedSaturday = await calendar.workingMinutesBetween(
      from,
      cairo('2026-03-07T22:00'),
    )

    expect(stoppedThursday).toBe(60)
    expect(workedFriday).toBe(stoppedThursday)
    expect(workedSaturday).toBe(stoppedThursday)
  })

  it('لا يحتسب يوم عطلة رسمية', async () => {
    const calendar = createCalendar(inMemoryCalendarSource({ holidays: ['2026-03-03'] }))
    await expect(
      calendar.workingMinutesBetween(
        startOfCairoDay('2026-03-01'),
        startOfCairoDay('2026-03-05'),
      ),
    ).resolves.toBe(3 * FULL_DAY)
  })

  it('لا يحتسب أيام إجازة المنفّذ المعتمدة', async () => {
    const source = inMemoryCalendarSource({
      leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-03' }],
    })
    const calendar = createCalendar(source)
    const span = [startOfCairoDay('2026-03-01'), startOfCairoDay('2026-03-05')] as const

    await expect(calendar.workingMinutesBetween(...span, WORKER)).resolves.toBe(
      2 * FULL_DAY,
    )
    await expect(calendar.workingMinutesBetween(...span, 'other')).resolves.toBe(
      4 * FULL_DAY,
    )
  })
})

describe('workingMinutesBetween — التوقيت الصيفي', () => {
  const alwaysWorking = () => createCalendar(inMemoryCalendarSource({ weekendDays: [] }))

  it('يوم تقديم الساعة يعطي نافذة عمل كاملة', async () => {
    // The transition lands at midnight, outside 09:00–17:00, so the workday
    // itself is a real eight hours — the clock the منفّذ reads is the truth,
    // even though that Cairo day is only 23 hours long.
    const { forward } = findCairoTransitions(2026)
    expect(forward).not.toBeNull()
    const key = cairoDate(forward as Date)

    await expect(
      alwaysWorking().workingMinutesBetween(cairo(`${key}T00:00`), cairo(`${key}T23:59`)),
    ).resolves.toBe(FULL_DAY)
  })

  it('يوم تأخير الساعة يعطي نافذة عمل كاملة أيضًا', async () => {
    const { back } = findCairoTransitions(2026)
    expect(back).not.toBeNull()
    // Egypt ends summer time at 24:00 local: the clock repeats 23:00 on the
    // same Cairo date, so that date is the 25-hour one.
    const key = cairoDate(back as Date)

    await expect(
      alwaysWorking().workingMinutesBetween(cairo(`${key}T00:00`), cairo(`${key}T23:59`)),
    ).resolves.toBe(FULL_DAY)
  })

  it('يُقاس الوقت بساعة الحائط لا بفرق المللي ثانية عبر التحويل', async () => {
    // Midnight before the jump → 09:30 on the short day. Only the 30 minutes
    // inside the workday window count, even though the raw millisecond span
    // across that boundary is an hour shorter than the clock suggests.
    const { forward } = findCairoTransitions(2026)
    const key = cairoDate(forward as Date)
    const previousKey = cairoDate(new Date((forward as Date).getTime() - 60_000))

    await expect(
      alwaysWorking().workingMinutesBetween(
        cairo(`${previousKey}T23:00`),
        cairo(`${key}T09:30`),
      ),
    ).resolves.toBe(30)
  })
})
