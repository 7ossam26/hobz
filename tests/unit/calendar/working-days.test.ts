import { describe, expect, it } from 'vitest'

import { createCalendar, startOfCairoDay } from '@/lib/calendar'

import { inMemoryCalendarSource } from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * `workingDaysBetween` — the number SPEC §5.3 turns into money.
 *
 * The contract, fixed in Phase 0 and honoured here:
 *
 *   Half-open `[from, to)`. A Cairo day counts when **its own start** falls in
 *   the range and it is a working day. So a task due and submitted at the same
 *   instant is 0 days late, not 1, and each further working-day boundary
 *   crossed adds exactly one.
 *
 * March 2026 is the fixture week throughout: 1 March is a Sunday, so 1–5 are
 * working days and 6–7 (Friday, Saturday) are the default weekend.
 */

const SUNDAY = '2026-03-01'
const THURSDAY = '2026-03-05'
const FRIDAY = '2026-03-06'
const SATURDAY = '2026-03-07'
const NEXT_SUNDAY = '2026-03-08'
const NEXT_MONDAY = '2026-03-09'

const WORKER = 'user-1'

const plain = () => createCalendar(inMemoryCalendarSource())

describe('workingDaysBetween — boundaries', () => {
  it('لا يحتسب أي يوم عندما تكون البداية والنهاية نفس اللحظة', async () => {
    const at = cairo(`${SUNDAY}T09:00`)
    await expect(plain().workingDaysBetween(at, at)).resolves.toBe(0)
  })

  it('لا يحتسب يومًا داخل اليوم الواحد', async () => {
    await expect(
      plain().workingDaysBetween(cairo(`${SUNDAY}T09:00`), cairo(`${SUNDAY}T23:59`)),
    ).resolves.toBe(0)
  })

  it('يحتسب يوم عمل واحد عند عبور منتصف الليل إلى يوم عمل', async () => {
    await expect(
      plain().workingDaysBetween(cairo(`${SUNDAY}T09:00`), cairo('2026-03-02T09:00')),
    ).resolves.toBe(1)
  })

  it('يشمل بداية اليوم ويستبعد نهايته — النطاق نصف مفتوح', async () => {
    const monday = cairo('2026-03-02T00:00')
    const tuesday = cairo('2026-03-03T00:00')
    // Monday's own start is included; Tuesday's is the exclusive end.
    await expect(plain().workingDaysBetween(monday, tuesday)).resolves.toBe(1)
  })

  it('لا يحتسب شيئًا عند عكس اتجاه النطاق', async () => {
    await expect(
      plain().workingDaysBetween(cairo('2026-03-05T09:00'), cairo('2026-03-01T09:00')),
    ).resolves.toBe(0)
  })

  it('يحتسب دقيقة واحدة بعد منتصف الليل كيوم كامل، ودقيقة قبله كصفر', async () => {
    const thursdayEvening = cairo(`${THURSDAY}T17:00`)
    await expect(
      plain().workingDaysBetween(thursdayEvening, cairo(`${NEXT_SUNDAY}T00:01`)),
    ).resolves.toBe(1)
    await expect(
      plain().workingDaysBetween(thursdayEvening, cairo(`${SATURDAY}T23:59`)),
    ).resolves.toBe(0)
  })
})

describe('workingDaysBetween — عطلة نهاية الأسبوع', () => {
  it('يتخطى الجمعة والسبت', async () => {
    // Thursday 17:00 → Sunday 09:00 crosses Fri, Sat and Sun; only Sunday works.
    await expect(
      plain().workingDaysBetween(
        cairo(`${THURSDAY}T17:00`),
        cairo(`${NEXT_SUNDAY}T09:00`),
      ),
    ).resolves.toBe(1)
  })

  it('التسليم يوم الجمعة لا يزيد التأخير ولا ينقصه (SPEC §5.2 T2)', async () => {
    const calendar = plain()
    const due = cairo(`${THURSDAY}T17:00`)

    const onThursdayNight = await calendar.workingDaysBetween(
      due,
      cairo(`${THURSDAY}T23:59`),
    )
    const onFriday = await calendar.workingDaysBetween(due, cairo(`${FRIDAY}T10:00`))
    const lateOnFriday = await calendar.workingDaysBetween(due, cairo(`${FRIDAY}T23:00`))
    const onSaturday = await calendar.workingDaysBetween(due, cairo(`${SATURDAY}T10:00`))

    // Working voluntarily on a day off never hurts and never helps: every
    // instant inside the weekend answers the same as the instant before it.
    expect(onFriday).toBe(onThursdayNight)
    expect(lateOnFriday).toBe(onThursdayNight)
    expect(onSaturday).toBe(onThursdayNight)
    expect(onThursdayNight).toBe(0)
  })

  it('يحتسب اليوم التالي لعطلة نهاية الأسبوع', async () => {
    await expect(
      plain().workingDaysBetween(
        cairo(`${THURSDAY}T17:00`),
        cairo(`${NEXT_MONDAY}T09:00`),
      ),
    ).resolves.toBe(2)
  })

  it('يحترم عطلة أسبوعية مختلفة من الإعدادات', async () => {
    const fridayOnly = createCalendar(inMemoryCalendarSource({ weekendDays: ['FRI'] }))
    // Saturday now works, so the same span answers 2 instead of 1.
    await expect(
      fridayOnly.workingDaysBetween(
        cairo(`${THURSDAY}T17:00`),
        cairo(`${NEXT_SUNDAY}T09:00`),
      ),
    ).resolves.toBe(2)
  })

  it('يحتسب كل الأيام عندما لا توجد عطلة أسبوعية', async () => {
    const noWeekend = createCalendar(inMemoryCalendarSource({ weekendDays: [] }))
    await expect(
      noWeekend.workingDaysBetween(cairo(`${SUNDAY}T00:00`), cairo('2026-04-01T00:00')),
    ).resolves.toBe(31)
  })
})

describe('workingDaysBetween — العطلات الرسمية', () => {
  it('يتخطى يوم عطلة رسمية في وسط الأسبوع', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({ holidays: ['2026-03-03'] }), // a Tuesday
    )
    await expect(
      calendar.workingDaysBetween(cairo(`${SUNDAY}T09:00`), cairo(`${THURSDAY}T09:00`)),
    ).resolves.toBe(3)
  })

  it('لا يخصم العطلة مرتين عندما تقع في عطلة نهاية الأسبوع', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({ holidays: [FRIDAY] }), // already a weekend day
    )
    await expect(
      calendar.workingDaysBetween(
        cairo(`${THURSDAY}T17:00`),
        cairo(`${NEXT_MONDAY}T09:00`),
      ),
    ).resolves.toBe(2)
  })

  it('يتخطى عطلة ممتدة عدة أيام', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({ holidays: ['2026-03-02', '2026-03-03', '2026-03-04'] }),
    )
    await expect(
      calendar.workingDaysBetween(cairo(`${SUNDAY}T09:00`), cairo(`${THURSDAY}T23:00`)),
    ).resolves.toBe(1)
  })

  it('يوسّع العطلة المتكررة على كل سنة في النطاق', async () => {
    // 7 January 2027 is a Thursday — the last working day of that week, and a
    // working day but for عيد الميلاد المجيد, which recurs every year.
    const span = [cairo('2027-01-06T09:00'), cairo('2027-01-08T09:00')] as const

    await expect(
      createCalendar(inMemoryCalendarSource()).workingDaysBetween(...span),
    ).resolves.toBe(1)

    await expect(
      createCalendar(
        inMemoryCalendarSource({ recurringHolidays: ['01-07'] }),
      ).workingDaysBetween(...span),
    ).resolves.toBe(0)
  })
})

describe('workingDaysBetween — الإجازات المعتمدة', () => {
  const source = () =>
    inMemoryCalendarSource({
      leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-04' }],
    })

  it('يستبعد أيام إجازة المنفّذ المعتمدة', async () => {
    await expect(
      createCalendar(source()).workingDaysBetween(
        cairo(`${SUNDAY}T09:00`),
        cairo(`${THURSDAY}T23:00`),
        WORKER,
      ),
    ).resolves.toBe(1)
  })

  it('لا يستبعدها لمنفّذ آخر', async () => {
    await expect(
      createCalendar(source()).workingDaysBetween(
        cairo(`${SUNDAY}T09:00`),
        cairo(`${THURSDAY}T23:00`),
        'someone-else',
      ),
    ).resolves.toBe(4)
  })

  it('يستخدم تقويم الوكالة وحده عند عدم تمرير منفّذ', async () => {
    await expect(
      createCalendar(source()).workingDaysBetween(
        cairo(`${SUNDAY}T09:00`),
        cairo(`${THURSDAY}T23:00`),
      ),
    ).resolves.toBe(4)
  })

  it('لا يسأل عن الإجازات أصلًا عندما لا يُمرَّر منفّذ', async () => {
    const spy = source()
    await createCalendar(spy).workingDaysBetween(
      cairo(`${SUNDAY}T09:00`),
      cairo(`${THURSDAY}T23:00`),
    )
    expect(spy.leaveCalls).toBe(0)
  })

  it('لا يخصم يوم إجازة يقع أصلًا في عطلة أسبوعية', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({
        leave: [{ userId: WORKER, start: FRIDAY, end: SATURDAY }],
      }),
    )
    await expect(
      calendar.workingDaysBetween(
        cairo(`${THURSDAY}T17:00`),
        cairo(`${NEXT_MONDAY}T09:00`),
        WORKER,
      ),
    ).resolves.toBe(2)
  })
})

describe('workingDaysBetween — حدود الشهور والسنة', () => {
  const monthSpan = async (from: string, to: string, userId?: string) =>
    createCalendar(inMemoryCalendarSource()).workingDaysBetween(
      startOfCairoDay(from),
      startOfCairoDay(to),
      userId,
    )

  it('مارس 2026 — 31 يومًا، 23 يوم عمل', async () => {
    await expect(monthSpan('2026-03-01', '2026-04-01')).resolves.toBe(23)
  })

  it('أبريل 2026 لا يفقد يومًا رغم يوم الـ23 ساعة', async () => {
    // April holds the spring-forward. 30 days − 4 Fridays − 4 Saturdays.
    await expect(monthSpan('2026-04-01', '2026-05-01')).resolves.toBe(22)
  })

  it('أكتوبر 2026 لا يكسب يومًا رغم يوم الـ25 ساعة', async () => {
    // October holds the fall-back. 31 days − 5 Fridays − 5 Saturdays.
    await expect(monthSpan('2026-10-01', '2026-11-01')).resolves.toBe(21)
  })

  it('فبراير 2026 — 28 يومًا', async () => {
    await expect(monthSpan('2026-02-01', '2026-03-01')).resolves.toBe(20)
  })

  it('فبراير 2028 الكبيس — 29 يومًا', async () => {
    await expect(monthSpan('2028-02-01', '2028-03-01')).resolves.toBe(21)
  })

  it('يعبر نهاية السنة', async () => {
    // 28 Dec 2026 (Mon) → 4 Jan 2027 (Mon): Mon 28, Tue 29, Wed 30, Thu 31,
    // then Fri 1 and Sat 2 are the weekend, Sun 3 and Mon 4 work.
    await expect(monthSpan('2026-12-28', '2027-01-05')).resolves.toBe(6)
  })

  it('يتفق العدّ الحسابي مع العدّ يومًا بيوم على مدى سنة', async () => {
    // `workingDaysBetween` counts full weeks arithmetically rather than
    // walking every day, so that a year-long span costs the same as a
    // one-day one. This is the test that keeps the shortcut honest: walk the
    // year a day at a time and demand the same answer.
    const calendar = createCalendar(
      inMemoryCalendarSource({
        holidays: ['2026-05-01', '2026-07-23'],
        leave: [{ userId: WORKER, start: '2026-06-01', end: '2026-06-14' }],
      }),
    )

    let walked = 0
    for (let day = 0; day < 365; day += 1) {
      const at = startOfCairoDay(dayKey(day))
      if (await calendar.isWorkingDay(at, WORKER)) walked += 1
    }

    await expect(
      calendar.workingDaysBetween(
        startOfCairoDay('2026-01-01'),
        startOfCairoDay('2027-01-01'),
        WORKER,
      ),
    ).resolves.toBe(walked)
  })
})

/** `2026-01-01` + n, computed without touching the module under test. */
function dayKey(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10)
}
