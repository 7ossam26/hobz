import { describe, expect, it } from 'vitest'

import {
  addCairoDays,
  cairoDateKey,
  cairoDaysBetweenKeys,
  cairoInstant,
  cairoOffsetMs,
  cairoParts,
  createCalendar,
  endOfCairoDay,
  isCairoDateKey,
  parseTimeOfDay,
  startOfCairoDay,
  weekdayOfKey,
  type CairoDateKey,
  type Weekday,
} from '@/lib/calendar'
import {
  cairoParts as cairoPartsFromDisplay,
  cairoWeekday as cairoWeekdayFromDisplay,
  toCairoDateInput,
} from '@/lib/datetime'
import { SETTINGS_CATALOG } from '@/lib/settings'
import { computeLateness, type LatenessTaskInput } from '@/modules/lateness/service'

import { inMemoryCalendarSource } from '../../helpers/calendar'
import {
  cairoOffsetMinutes,
  DAY_MS,
  findCairoTransitions,
  HOUR_MS,
  MINUTE_MS,
} from '../../helpers/time'

/**
 * docs/TESTING.md §4 axis 2 — time: Cairo vs UTC, midnight, month ends,
 * February, **and DST**.
 *
 * The axis originally read "DST-free" and was corrected in Phase 4: Egypt
 * reinstated summer time in 2023, so a Cairo year contains one 23-hour day and
 * one 25-hour day. Everything below therefore *derives* the two transitions
 * from the platform's timezone database (`findCairoTransitions`) instead of
 * naming dates. Hardcoding them would test the tzdata build shipped with the
 * runner, not the code — and the code's whole promise is that it survives
 * tzdata being revised, which Egypt has done twice in a decade.
 *
 * The recurring question in every case here: **would subtracting two `Date`s
 * give a different answer?** Wherever it would, that is the case worth pinning
 * (CLAUDE.md invariant 5).
 */

const YEAR = 2026

/** Both transitions of the fixture year, measured rather than assumed. */
const TRANSITIONS = findCairoTransitions(YEAR)

function transition(which: 'forward' | 'back'): Date {
  const at = TRANSITIONS[which]
  if (at === null) {
    throw new Error(`Africa/Cairo has no ${which} DST transition in ${YEAR}`)
  }
  return at
}

const FORWARD = transition('forward')
const BACK = transition('back')

/** The 23-hour Cairo day — the clock jumps forward into it, skipping 00:00. */
const SHORT_DAY: CairoDateKey = cairoDateKey(FORWARD)
/** The 25-hour Cairo day — the clock falls back inside it, repeating 23:00. */
const LONG_DAY: CairoDateKey = cairoDateKey(BACK)

// Business values come from the catalog, never from a literal here
// (docs/TESTING.md §5, CLAUDE.md invariant 4).
const WEEKEND = SETTINGS_CATALOG['calendar.weekendDays'].default as readonly Weekday[]
const WORKDAY_START = SETTINGS_CATALOG['calendar.workdayStart'].default
const WORKDAY_END = SETTINGS_CATALOG['calendar.workdayEnd'].default
const DEFAULT_GRACE_HOURS = SETTINGS_CATALOG['penalty.defaultGraceHours'].default

/** The agency calendar exactly as Settings configures it. */
const agencyCalendar = () =>
  createCalendar(
    inMemoryCalendarSource({
      weekendDays: WEEKEND,
      workdayStart: WORKDAY_START,
      workdayEnd: WORKDAY_END,
    }),
  )

/** Every day is a working day — isolates day *counting* from the weekend rule. */
const everyDayWorking = () => createCalendar(inMemoryCalendarSource({ weekendDays: [] }))

// ─────────────────────────────────────────────────────────────────────────
// The offset itself
// ─────────────────────────────────────────────────────────────────────────

describe('إزاحة القاهرة تُشتقّ من قاعدة المناطق الزمنية', () => {
  it('تتغيّر الإزاحة ساعة واحدة بالضبط عند كل تحويل', () => {
    const beforeForward = cairoOffsetMs(new Date(FORWARD.getTime() - 1))
    const afterForward = cairoOffsetMs(FORWARD)
    const beforeBack = cairoOffsetMs(new Date(BACK.getTime() - 1))
    const afterBack = cairoOffsetMs(BACK)

    // One hour, in both directions. A codebase that assumed a fixed +02:00
    // would be an hour wrong for half the year and would never notice, because
    // an hour is invisible in everything except a deadline.
    expect(afterForward - beforeForward).toBe(HOUR_MS)
    expect(afterBack - beforeBack).toBe(-HOUR_MS)
  })

  it('تتفق إزاحة الإنتاج مع إزاحة مقيسة مستقلًّا في كل يوم من السنة', () => {
    // `lib/calendar` derives the offset one way and `tests/helpers/time` another.
    // Two independent readings of the same tz database must agree on all 365
    // days, transitions included — otherwise every instant this suite builds
    // and every instant the product builds are subtly different instants.
    let key = `${YEAR}-01-01`
    for (let day = 0; day < 365; day += 1) {
      const noon = cairoInstant(key, 12 * 60)
      expect(cairoOffsetMs(noon) / MINUTE_MS).toBe(cairoOffsetMinutes(noon))
      key = addCairoDays(key, 1)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// UTC vs Cairo — where the calendar day actually turns over
// ─────────────────────────────────────────────────────────────────────────

describe('حدّ منتصف الليل بين UTC والقاهرة', () => {
  it('اللحظة نفسها من ساعة UTC تقع في يومين مختلفين حسب الفصل', () => {
    // 21:30Z is the case that catches a hardcoded offset: in winter it is still
    // last night's 23:30, in summer it is already half past midnight tomorrow.
    // Same UTC wall time, two different Cairo dates, one working-day count apart.
    expect(cairoDateKey(new Date(`${YEAR}-01-14T21:30:00Z`))).toBe(`${YEAR}-01-14`)
    expect(cairoDateKey(new Date(`${YEAR}-07-14T21:30:00Z`))).toBe(`${YEAR}-07-15`)
  })

  it('لحظة بدء اليوم بتوقيت UTC تتقدّم ساعة في الصيف', () => {
    const winter = startOfCairoDay(`${YEAR}-01-15`)
    const summer = startOfCairoDay(`${YEAR}-07-15`)

    // Derived from the measured offset, not written down: a Cairo day begins
    // 24h − offset into the previous UTC day, which is 22:00Z in winter and
    // 21:00Z in summer.
    expect(winter.getUTCHours()).toBe(24 - cairoOffsetMs(winter) / HOUR_MS)
    expect(summer.getUTCHours()).toBe(24 - cairoOffsetMs(summer) / HOUR_MS)
    expect(summer.getUTCHours()).toBe(winter.getUTCHours() - 1)
  })

  it('يوم العمل يُقرأ على حدّ القاهرة الصيفي لا على حدّ 22:00Z الشتوي', async () => {
    // Arrange — a summer Thursday whose next day is the weekend, so the answer
    // flips exactly at the rollover and nowhere else.
    const thursday = `${YEAR}-07-02`
    expect(WEEKEND).not.toContain(weekdayOfKey(thursday))
    expect(WEEKEND).toContain(weekdayOfKey(addCairoDays(thursday, 1)))

    const calendar = agencyCalendar()

    // 20:30Z is 23:30 Thursday; 21:30Z has already rolled into Friday. In
    // winter the same pair of instants would both still be Thursday.
    await expect(calendar.isWorkingDay(new Date(`${thursday}T20:30:00Z`))).resolves.toBe(
      true,
    )
    await expect(calendar.isWorkingDay(new Date(`${thursday}T21:30:00Z`))).resolves.toBe(
      false,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────
// The 23-hour and 25-hour days
// ─────────────────────────────────────────────────────────────────────────

describe('يوم الـ23 ساعة ويوم الـ25 ساعة', () => {
  it('كل دقيقة من الساعة المحذوفة تبقى داخل يوم القاهرة نفسه', () => {
    // 00:00–00:59 does not exist on the short day. Whatever an implementation
    // resolves those readings to, it must never resolve them onto the *previous*
    // date: a deadline stored as "midnight on the 24th" landing on the 23rd is a
    // whole working day of penalty out of thin air.
    for (let minute = 0; minute < 60; minute += 1) {
      const at = cairoInstant(SHORT_DAY, minute)
      expect(cairoDateKey(at)).toBe(SHORT_DAY)
      expect(at.getTime()).toBeGreaterThanOrEqual(startOfCairoDay(SHORT_DAY).getTime())
      expect(at.getTime()).toBeLessThan(endOfCairoDay(SHORT_DAY).getTime())
    }
  })

  it('الساعة المكرّرة بمرّتيها تقع في يوم القاهرة نفسه', () => {
    // On the long day the wall clock reads 23:xx twice, an hour of real time
    // apart. The two readings are indistinguishable on the clock, so the date
    // key is the only thing that must stay unambiguous — and it does.
    const firstPass = new Date(BACK.getTime() - 30 * MINUTE_MS)
    const secondPass = new Date(BACK.getTime() + 30 * MINUTE_MS)

    expect(cairoDateKey(firstPass)).toBe(LONG_DAY)
    expect(cairoDateKey(secondPass)).toBe(LONG_DAY)
    expect(cairoParts(secondPass).hour).toBe(cairoParts(firstPass).hour)
    expect(cairoParts(secondPass).minute).toBe(cairoParts(firstPass).minute)
  })

  it('طرح لحظتين يعطي صفر يوم عبر يوم الـ23 ساعة بينما الحساب المدني يعطي يومًا', () => {
    const elapsedMs =
      endOfCairoDay(SHORT_DAY).getTime() - startOfCairoDay(SHORT_DAY).getTime()

    // This is CLAUDE.md invariant 5 stated as a number: the millisecond span of
    // the short day floors to zero days, and a lateness engine built on
    // `(to − from) / DAY_MS` would forgive a full day once a year.
    expect(elapsedMs).toBe(23 * HOUR_MS)
    expect(Math.floor(elapsedMs / DAY_MS)).toBe(0)
    expect(cairoDaysBetweenKeys(SHORT_DAY, addCairoDays(SHORT_DAY, 1))).toBe(1)
  })

  it('يوما التحويل يلغي أحدهما الآخر فلا يتغيّر طول السنة', () => {
    // −1h in April and +1h in October cancel exactly, so a whole year *is* a
    // whole number of 24-hour days in real time. That is why a yearly span
    // looks harmless to millisecond arithmetic and a single day does not:
    // the bug only shows between the two transitions, which is the worst
    // possible place for it to hide.
    const common =
      startOfCairoDay('2027-01-01').getTime() - startOfCairoDay('2026-01-01').getTime()
    const leap =
      startOfCairoDay('2029-01-01').getTime() - startOfCairoDay('2028-01-01').getTime()

    expect(common / DAY_MS).toBe(cairoDaysBetweenKeys('2026-01-01', '2027-01-01'))
    expect(leap / DAY_MS).toBe(cairoDaysBetweenKeys('2028-01-01', '2029-01-01'))
    expect(leap - common).toBe(DAY_MS)
  })

  it('يوم الـ23 ساعة عطلة أسبوعية ويوم الـ25 ساعة يوم عمل في كل سنة', () => {
    // The corrected axis in docs/TESTING.md §4 says both transitions land on the
    // Friday/Thursday pair the default weekend is built around. That is not
    // trivia: it means the short day is never counted (it is a weekend day) and
    // the long day always is, so the transitions can never silently add or drop
    // a working day under the default calendar.
    for (let year = 2024; year <= 2030; year += 1) {
      const { forward, back } = findCairoTransitions(year)
      expect(forward).not.toBeNull()
      expect(back).not.toBeNull()

      expect(WEEKEND).toContain(weekdayOfKey(cairoDateKey(forward as Date)))
      expect(WEEKEND).not.toContain(weekdayOfKey(cairoDateKey(back as Date)))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Working-day counting across the transitions
// ─────────────────────────────────────────────────────────────────────────

describe('عدّ أيام العمل عبر تحويلي التوقيت', () => {
  it('يوم الـ23 ساعة يُحتسب يوم عمل كاملًا', async () => {
    await expect(
      everyDayWorking().workingDaysBetween(
        startOfCairoDay(SHORT_DAY),
        startOfCairoDay(addCairoDays(SHORT_DAY, 1)),
      ),
    ).resolves.toBe(1)
  })

  it('يوم الـ25 ساعة يُحتسب يوم عمل واحدًا لا أكثر', async () => {
    await expect(
      everyDayWorking().workingDaysBetween(
        startOfCairoDay(LONG_DAY),
        startOfCairoDay(addCairoDays(LONG_DAY, 1)),
      ),
    ).resolves.toBe(1)
  })

  it('منتصف الليل الذي لا وجود له يظل حدًّا يُحتسب مرة واحدة', async () => {
    const calendar = everyDayWorking()
    const dayStart = startOfCairoDay(SHORT_DAY)

    // The short day begins at 01:00 because 00:00 was skipped. The half-open
    // rule still has to bite there exactly as it does on an ordinary midnight:
    // starting *at* the boundary counts the day, one millisecond later does not.
    await expect(
      calendar.workingDaysBetween(dayStart, startOfCairoDay(addCairoDays(SHORT_DAY, 1))),
    ).resolves.toBe(1)
    await expect(
      calendar.workingDaysBetween(
        new Date(dayStart.getTime() + 1),
        startOfCairoDay(addCairoDays(SHORT_DAY, 1)),
      ),
    ).resolves.toBe(0)
  })

  it('أي سبعة أيام متتالية تعطي العدد نفسه من أيام العمل حتى في أسبوعي التحويل', async () => {
    const calendar = agencyCalendar()
    const week = async (anchor: CairoDateKey, offset: number) =>
      calendar.workingDaysBetween(
        startOfCairoDay(addCairoDays(anchor, offset)),
        startOfCairoDay(addCairoDays(anchor, offset + 7)),
      )

    // Seven consecutive Cairo days contain each weekday exactly once, so the
    // count is a property of Settings alone — the 23-hour and 25-hour weeks
    // included. A DST-free control week a fortnight earlier proves the number
    // is not an accident of the transition week.
    const expected = 7 - WEEKEND.length
    await expect(week(SHORT_DAY, -3)).resolves.toBe(expected)
    await expect(week(LONG_DAY, -3)).resolves.toBe(expected)
    await expect(week(SHORT_DAY, -17)).resolves.toBe(expected)
  })

  it('الخميس الطويل يبقى يوم عمل بعد التحويل بنصف ساعة من الزمن الفعلي', async () => {
    // Arrange — the long day is a working day under the default weekend.
    expect(WEEKEND).not.toContain(weekdayOfKey(LONG_DAY))

    // The repeated hour hands the منفّذ an extra hour of real time on a day the
    // clock still calls Thursday. Anything that decided "which day is it" from
    // a fixed summer offset would have called this Friday and stopped counting.
    await expect(
      agencyCalendar().isWorkingDay(new Date(BACK.getTime() + 30 * MINUTE_MS)),
    ).resolves.toBe(true)
    expect(cairoDateKey(new Date(BACK.getTime() + 30 * MINUTE_MS))).toBe(LONG_DAY)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// A workday window that straddles a transition
// ─────────────────────────────────────────────────────────────────────────

describe('نافذة عمل تمتدّ عبر تحويل التوقيت', () => {
  /** A deliberately extreme window: the only shape that can contain a transition. */
  const roundTheClock = () =>
    createCalendar(
      inMemoryCalendarSource({
        weekendDays: [],
        workdayStart: '00:00',
        workdayEnd: '23:59',
      }),
    )

  const wholeDay = async (key: CairoDateKey) =>
    roundTheClock().workingMinutesBetween(
      startOfCairoDay(key),
      startOfCairoDay(addCairoDays(key, 1)),
    )

  it('نافذة تبدأ عند الساعة المحذوفة تُحتسب بساعة الحائط لا بالزمن الفعلي', async () => {
    const work = await roundTheClock().workCalendar()

    // The منفّذ works the window their clock shows. On the short day only 22h59m
    // of real time passes inside it, but the workday is still the workday —
    // which is also the only reading that agrees with the interior of a longer
    // span, where every whole day contributes `workdayMinutes` flat.
    await expect(wholeDay(SHORT_DAY)).resolves.toBe(work.workdayMinutes)
  })

  it('نافذة تمتدّ عبر الساعة المكرّرة لا تحتسبها مرتين', async () => {
    const work = await roundTheClock().workCalendar()
    await expect(wholeDay(LONG_DAY)).resolves.toBe(work.workdayMinutes)
  })

  it('تقسيم المدة عند منتصف الليل لا يغيّر مجموع دقائق العمل عبر التحويل', async () => {
    const calendar = roundTheClock()
    const additive = async (key: CairoDateKey) => {
      const before = startOfCairoDay(addCairoDays(key, -1))
      const midnight = startOfCairoDay(key)
      const after = startOfCairoDay(addCairoDays(key, 1))

      // Same two instants, measured whole and measured in two halves. If the
      // clipped ends and the counted interior disagreed about how long a
      // transition day is, elapsed working time would depend on when the job
      // happened to slice the span — the same task, two different numbers.
      const whole = await calendar.workingMinutesBetween(before, after)
      const first = await calendar.workingMinutesBetween(before, midnight)
      const second = await calendar.workingMinutesBetween(midnight, after)
      return { whole, split: first + second }
    }

    const short = await additive(SHORT_DAY)
    const long = await additive(LONG_DAY)

    expect(short.split).toBe(short.whole)
    expect(long.split).toBe(long.whole)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Grace — a duration, not a wall-clock appointment
// ─────────────────────────────────────────────────────────────────────────

describe('مهلة السماح مدة فعلية لا موعد على ساعة الحائط', () => {
  const WORKER = 'worker-1'

  const lateness = async (dueDate: Date, submittedAt: Date | null = null) => {
    const task: LatenessTaskInput = {
      id: 'task-1',
      status: submittedAt === null ? 'IN_PROGRESS' : 'SUBMITTED',
      dueDate,
      originalDueDate: dueDate,
      submittedAt,
      assigneeId: WORKER,
      blockedIntervals: [],
    }
    return computeLateness(agencyCalendar(), {
      task,
      graceHours: DEFAULT_GRACE_HOURS,
      now: cairoInstant(addCairoDays(cairoDateKey(dueDate), 30), 0),
    })
  }

  const effectiveDueDate = async (dueDate: Date) =>
    (await lateness(dueDate)).effectiveDueDate

  /** A deadline at the end of the workday on `key`, per Settings. */
  const deadlineOn = (key: CairoDateKey) => cairoInstant(key, parseTimeOfDay(WORKDAY_END))

  it('المهلة عبر يوم الـ23 ساعة تظل ساعات فعلية وتنتهي متأخرة ساعة على ساعة الحائط', async () => {
    const dueDate = deadlineOn(addCairoDays(SHORT_DAY, -1))

    const effective = await effectiveDueDate(dueDate)

    // Grace is a duration (SPEC §5.3): the same number of real hours for every
    // منفّذ, whichever day it lands on. The منفّذ lived through a 23-hour day, so
    // those real hours run out an hour later than the deadline's own wall clock.
    expect(effective.getTime() - dueDate.getTime()).toBe(DEFAULT_GRACE_HOURS * HOUR_MS)
    expect(cairoParts(effective).hour).toBe(parseTimeOfDay(WORKDAY_END) / 60 + 1)
  })

  it('المهلة عبر يوم الـ25 ساعة تظل ساعات فعلية وتنتهي مبكرة ساعة على ساعة الحائط', async () => {
    const dueDate = deadlineOn(LONG_DAY)

    const effective = await effectiveDueDate(dueDate)

    expect(effective.getTime() - dueDate.getTime()).toBe(DEFAULT_GRACE_HOURS * HOUR_MS)
    expect(cairoParts(effective).hour).toBe(parseTimeOfDay(WORKDAY_END) / 60 - 1)
  })

  it('منفّذان على جانبَي التحويل يحصلان على المهلة نفسها بالمللي ثانية', async () => {
    const acrossTransition = deadlineOn(addCairoDays(SHORT_DAY, -1))
    const ordinaryDay = deadlineOn(addCairoDays(SHORT_DAY, -8))

    const across = await effectiveDueDate(acrossTransition)
    const ordinary = await effectiveDueDate(ordinaryDay)

    // The one thing a grace period must never be is a lottery on the calendar.
    expect(across.getTime() - acrossTransition.getTime()).toBe(
      ordinary.getTime() - ordinaryDay.getTime(),
    )
  })

  it('التأخير عبر يوم الـ25 ساعة ونهاية الشهر معًا لا يكسب يوم عمل', async () => {
    const lateDays = async (offset: number) => {
      const dueDate = deadlineOn(addCairoDays(LONG_DAY, offset))
      const submittedAt = cairoInstant(
        addCairoDays(LONG_DAY, offset + 5),
        parseTimeOfDay(WORKDAY_START),
      )
      return (await lateness(dueDate, submittedAt)).lateWorkingDays
    }

    // The whole chain at once — grace as a real duration, then the working-day
    // count — over a span that crosses the fall-back *and* the end of a 31-day
    // month. The identically shaped span one week earlier crosses neither, and
    // a منفّذ must not be charged differently for the calendar they landed on.
    expect(await lateDays(0)).toBe(await lateDays(-7))
    expect(await lateDays(0)).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Month ends and February
// ─────────────────────────────────────────────────────────────────────────

describe('نهايات الشهور وفبراير', () => {
  it('طول كل شهر في السنة يطابق التقويم الميلادي', () => {
    // 28/30/31 in one sweep, against a reference the module under test does not
    // share. Month length is the other half of invariant 5: `addMonths` by
    // millisecond arithmetic is wrong eleven times a year, not twice.
    for (let month = 1; month <= 12; month += 1) {
      const first = `${YEAR}-${String(month).padStart(2, '0')}-01`
      const nextFirst =
        month === 12
          ? `${YEAR + 1}-01-01`
          : `${YEAR}-${String(month + 1).padStart(2, '0')}-01`
      const reference = new Date(Date.UTC(YEAR, month, 0)).getUTCDate()

      expect(cairoDaysBetweenKeys(first, nextFirst)).toBe(reference)
    }
  })

  it('فبراير سنة القرن غير الكبيسة 28 يومًا وفبراير سنة القرن الكبيسة 29', () => {
    // The century rule a naive `% 4` gets wrong in both directions: 1900 was
    // not a leap year, 2000 was.
    expect(cairoDaysBetweenKeys('1900-02-01', '1900-03-01')).toBe(28)
    expect(cairoDaysBetweenKeys('2000-02-01', '2000-03-01')).toBe(29)
  })

  it('يرفض 29 فبراير 1900 ويقبل 29 فبراير 2000', () => {
    expect(isCairoDateKey('1900-02-29')).toBe(false)
    expect(isCairoDateKey('2000-02-29')).toBe(true)
  })

  it('يعبر آخر يوم في الشهر إلى أول يوم عمل في الشهر التالي', async () => {
    // Arrange — 30 April 2026 is the last day of a 30-day month, and it sits
    // just after the spring-forward, so the count runs on the summer offset
    // while the previous month ran on the winter one.
    const lastOfApril = `${YEAR}-04-30`
    expect(cairoDaysBetweenKeys(`${YEAR}-04-01`, lastOfApril)).toBe(29)

    const next = await agencyCalendar().nextWorkingDay(cairoInstant(lastOfApril, 12 * 60))

    expect(cairoDateKey(next)).toBe(`${YEAR}-05-03`)
    expect(WEEKEND).toContain(weekdayOfKey(`${YEAR}-05-01`))
  })

  it('اليوم التالي بعد يوم الـ23 ساعة يبدأ على ساعة الحائط لا بعد 24 ساعة صافية', async () => {
    const calendar = createCalendar(
      inMemoryCalendarSource({ weekendDays: [], workdayStart: WORKDAY_START }),
    )
    const previousStart = cairoInstant(
      addCairoDays(SHORT_DAY, -1),
      parseTimeOfDay(WORKDAY_START),
    )

    const next = await calendar.nextWorkingDay(previousStart)

    // The workday opens when the clock says it opens. Across the short day that
    // is 23 real hours after the previous opening, not 24 — a scheduler that
    // added `DAY_MS` would open an hour late, every year, on one day.
    expect(cairoDateKey(next)).toBe(SHORT_DAY)
    expect(cairoParts(next).hour * 60 + cairoParts(next).minute).toBe(
      parseTimeOfDay(WORKDAY_START),
    )
    expect(next.getTime() - previousStart.getTime()).toBe(23 * HOUR_MS)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Display and arithmetic cannot disagree
// ─────────────────────────────────────────────────────────────────────────

describe('طبقة العرض وطبقة الحساب لا يمكن أن تختلفا', () => {
  it('lib/datetime يعيد تصدير دالة cairoParts نفسها لا نسخة منها', () => {
    // Two implementations of "what does the Cairo clock say" is the worst kind
    // of bug to chase: the deadline on screen and the deadline in the penalty
    // differ by a day and both look right. Identity, not equality of behaviour,
    // is what makes that impossible rather than merely unlikely.
    expect(cairoPartsFromDisplay).toBe(cairoParts)
  })

  it('يطابق تاريخ حقل الإدخال مفتاح يوم القاهرة عند التحويلين وعند حدود منتصف الليل', () => {
    const samples = [
      new Date(FORWARD.getTime() - 1),
      FORWARD,
      new Date(BACK.getTime() - 1),
      BACK,
      new Date(`${YEAR}-01-14T21:59:59Z`),
      new Date(`${YEAR}-01-14T22:00:00Z`),
      new Date(`${YEAR}-07-14T20:59:59Z`),
      new Date(`${YEAR}-07-14T21:00:00Z`),
      new Date(`${YEAR}-12-31T22:00:00Z`),
    ]

    for (const at of samples) {
      expect(toCairoDateInput(at)).toBe(cairoDateKey(at))
    }
  })

  it('يطابق يوم الأسبوع المعروض يوم الأسبوع المحسوب مدنيًّا عبر السنة', () => {
    // The display layer reads the weekday off an instant; the business layer
    // derives it from the civil date. A week where those two disagree is a week
    // where the weekend moves for one of them.
    let key = `${YEAR}-01-01`
    for (let day = 0; day < 365; day += 1) {
      const noon = cairoInstant(key, 12 * 60)
      expect(cairoWeekdayFromDisplay(noon)).toBe(weekdayOfKey(key))
      key = addCairoDays(key, 1)
    }
  })
})
