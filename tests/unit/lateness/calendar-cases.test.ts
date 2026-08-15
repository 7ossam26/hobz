import { describe, expect, it } from 'vitest'

import {
  createCalendar,
  parseTimeOfDay,
  startOfCairoDay,
  type Calendar,
} from '@/lib/calendar'
import { SETTINGS_CATALOG } from '@/lib/settings'
import { computeLateness, type LatenessTaskInput } from '@/modules/lateness/service'

import { HOLIDAYS_2026 } from '../../fixtures/holidays-2026'
import {
  inMemoryCalendarSource,
  type InMemoryCalendarOptions,
} from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * docs/TESTING.md §4 axis 3 — the calendar edge cases, swept rather than
 * sampled.
 *
 * `working-days.test.ts` and `lateness.test.ts` already pin one instant per
 * rule: a Friday deadline, a holiday deadline, a leave range, a submission on
 * one day off. What they cannot pin one instant at a time is the *shape* of
 * SPEC §5.2 T2:
 *
 *   > if a worker submits on a weekend/holiday, that is allowed … Working
 *   > voluntarily on a day off never hurts and never helps.
 *
 * T2 is a statement about every instant in a contiguous non-working stretch,
 * in both directions — the submission may land in one, and so may the
 * effective due date after an extension. So the cases here sweep whole
 * stretches hour by hour and demand a single answer, and the examples that
 * remain are the ones the sweep cannot reach: holidays that are also weekend
 * days, leave that is also a holiday, leave ranges that start or end outside
 * the measured window, one-off versus recurring rows, and weekend
 * configurations other than the default.
 *
 * Fixture weeks: March 2026 (1 March is a Sunday) and May 2026, where the real
 * عيد الأضحى runs into the weekend.
 */

const WORKER = 'worker-1'
const OTHER_WORKER = 'worker-2'

/**
 * The calendar under test is the *shipped* one: weekend days and workday
 * bounds come from the catalog rather than being retyped here. If the agency
 * ever moves off Friday/Saturday, these cases must fail loudly rather than go
 * on quietly proving something about a calendar nobody uses.
 */
const WORK = {
  weekendDays: SETTINGS_CATALOG['calendar.weekendDays'].default,
  workdayStart: SETTINGS_CATALOG['calendar.workdayStart'].default,
  workdayEnd: SETTINGS_CATALOG['calendar.workdayEnd'].default,
  workingDaysPerMonth: SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default,
}

/** One full workday, derived from Settings — never the number 480. */
const FULL_WORKDAY = parseTimeOfDay(WORK.workdayEnd) - parseTimeOfDay(WORK.workdayStart)

const calendarWith = (options: InMemoryCalendarOptions = {}): Calendar =>
  createCalendar(inMemoryCalendarSource({ ...WORK, ...options }))

/** The real Egyptian 2026 holidays, as one-off rows — which is what they are. */
const EGYPT_2026: readonly string[] = HOLIDAYS_2026.map((holiday) => holiday.date)

const egyptianCalendar = (options: InMemoryCalendarOptions = {}): Calendar =>
  calendarWith({ holidays: EGYPT_2026, ...options })

/** Every hour of the given Cairo dates, in order — the sweep T2 asks for. */
function everyHourOf(keys: readonly string[]): Date[] {
  const instants: Date[] = []
  for (const key of keys) {
    for (let hour = 0; hour < 24; hour += 1) {
      instants.push(cairo(`${key}T${String(hour).padStart(2, '0')}:00`))
    }
  }
  return instants
}

/**
 * The distinct answers a measurement gives across a sweep. Exactly one entry
 * means T2 holds; more than one names the instants where it broke.
 */
async function distinct(
  instants: readonly Date[],
  measure: (at: Date) => Promise<number>,
): Promise<number[]> {
  const answers = new Set<number>()
  for (const at of instants) answers.add(await measure(at))
  return [...answers]
}

/** `2026-03-01` + n, computed without touching the module under test. */
const marchKey = (offset: number): string =>
  new Date(Date.UTC(2026, 2, 1 + offset)).toISOString().slice(0, 10)

/** Past every fixture, so a delivered task measures at its `submittedAt`. */
const FAR_FUTURE = cairo('2030-01-01T00:00')

function task(overrides: Partial<LatenessTaskInput> = {}): LatenessTaskInput {
  const dueDate = overrides.dueDate ?? cairo('2026-03-01T17:00')
  return {
    id: 'task-1',
    status: 'SUBMITTED',
    assigneeId: WORKER,
    dueDate,
    originalDueDate: overrides.originalDueDate ?? dueDate,
    submittedAt: null,
    ...overrides,
  }
}

const lateDays = async (
  calendar: Calendar,
  overrides: Partial<LatenessTaskInput>,
): Promise<number> =>
  (
    await computeLateness(calendar, {
      task: task(overrides),
      graceHours: 0,
      now: FAR_FUTURE,
    })
  ).lateWorkingDays

// ─────────────────────────────────────────────────────────────────────────────
// SPEC §5.2 T2, as a property over whole stretches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * عيد الأضحى 2026 falls on Wednesday 27 and Thursday 28 May, and Friday 29 /
 * Saturday 30 are the weekend: four non-working days in a row, bounded by two
 * ordinary working days. Real data, and exactly the shape T2 is about.
 */
const ADHA_STRETCH = ['2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30'] as const
const BEFORE_ADHA = '2026-05-26'
const AFTER_ADHA = '2026-05-31'
const DUE_BEFORE_ADHA = cairo('2026-05-24T17:00')

/**
 * A weekend that runs straight into approved leave: Friday 6 and Saturday 7
 * March are the weekend, and the منفّذ is on approved leave Sunday 8 and
 * Monday 9. Same four-day shape as عيد الأضحى, built out of the one ingredient
 * that belongs to a single person.
 */
const LEAVE_STRETCH = ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'] as const
const AFTER_LEAVE = '2026-03-10'

const leaveCalendar = (): Calendar =>
  calendarWith({ leave: [{ userId: WORKER, start: '2026-03-08', end: '2026-03-09' }] })

describe('فترة توقف متصلة — SPEC §5.2 T2', () => {
  it('أيام عيد الأضحى الأربعة المتصلة بعطلة نهاية الأسبوع ليست أيام عمل', async () => {
    const calendar = egyptianCalendar()

    const inside = await Promise.all(
      ADHA_STRETCH.map((key) => calendar.isWorkingDay(startOfCairoDay(key))),
    )

    expect(inside).toEqual([false, false, false, false])
    // Bounded on both sides by ordinary working days: this is what makes the
    // sweeps below a statement about a *stretch* rather than about one day off.
    await expect(calendar.isWorkingDay(startOfCairoDay(BEFORE_ADHA))).resolves.toBe(true)
    await expect(calendar.isWorkingDay(startOfCairoDay(AFTER_ADHA))).resolves.toBe(true)
  })

  it('التسليم في أي ساعة داخل فترة التوقف يعطي نفس عدد أيام التأخير', async () => {
    const calendar = egyptianCalendar()
    const beforeStretch = await calendar.workingDaysBetween(
      DUE_BEFORE_ADHA,
      cairo(`${BEFORE_ADHA}T23:59`),
    )

    const answers = await distinct(everyHourOf(ADHA_STRETCH), (at) =>
      calendar.workingDaysBetween(DUE_BEFORE_ADHA, at),
    )

    // Ninety-six instants, one answer: nowhere inside the stretch does the
    // منفّذ gain or lose a day by delivering earlier or later.
    expect(answers).toEqual([beforeStretch])
    expect(beforeStretch).toBe(2)
  })

  it('لا يُحتسب يوم العمل التالي لفترة التوقف قبل أن يبدأ فعلًا', async () => {
    const calendar = egyptianCalendar()

    await expect(
      calendar.workingDaysBetween(DUE_BEFORE_ADHA, cairo('2026-05-30T23:59')),
    ).resolves.toBe(2)
    // Half-open [from, to): the Sunday's own start has to fall *inside* the
    // range, so the stretch ends at that instant rather than before it.
    await expect(
      calendar.workingDaysBetween(DUE_BEFORE_ADHA, startOfCairoDay(AFTER_ADHA)),
    ).resolves.toBe(2)
    await expect(
      calendar.workingDaysBetween(DUE_BEFORE_ADHA, cairo(`${AFTER_ADHA}T00:01`)),
    ).resolves.toBe(3)
  })

  it('تحريك بداية القياس داخل فترة التوقف لا يغيّر عدد أيام العمل', async () => {
    // The other direction of T2. It is not only the submission that can land
    // inside a stretch: an extension approved during عيد الأضحى moves the
    // effective due date into it, and that must not cost or save a day either.
    const calendar = egyptianCalendar()
    const to = cairo('2026-06-01T09:00')

    const answers = await distinct(everyHourOf(ADHA_STRETCH), (from) =>
      calendar.workingDaysBetween(from, to),
    )

    expect(answers).toEqual([2])
  })

  it('العمل التطوعي في أي ساعة من فترة التوقف لا يضيف دقيقة واحدة', async () => {
    // The same property for SPEC §5.2's `elapsedMinutesWorking`: a منفّذ who
    // works through all four days of the عيد accrues exactly the Tuesday.
    const calendar = egyptianCalendar()
    const from = cairo(`${BEFORE_ADHA}T${WORK.workdayStart}`)

    const answers = await distinct(everyHourOf(ADHA_STRETCH), (at) =>
      calendar.workingMinutesBetween(from, at),
    )

    expect(answers).toEqual([FULL_WORKDAY])
  })

  it('فترة التوقف الممتدة من عطلة الأسبوع إلى الإجازة المعتمدة تخص صاحبها وحده', async () => {
    const calendar = leaveCalendar()

    const forWorker = await Promise.all(
      LEAVE_STRETCH.map((key) => calendar.isWorkingDay(startOfCairoDay(key), WORKER)),
    )
    const forOther = await Promise.all(
      LEAVE_STRETCH.map((key) =>
        calendar.isWorkingDay(startOfCairoDay(key), OTHER_WORKER),
      ),
    )

    expect(forWorker).toEqual([false, false, false, false])
    // Four days off for one person and two for everybody else, from the same
    // rows: leave narrows the calendar, it does not close the agency.
    expect(forOther).toEqual([false, false, true, true])
  })

  it('تحريك بداية القياس داخل عطلة أسبوعية تليها إجازة معتمدة لا يغيّر دقائق العمل', async () => {
    const calendar = leaveCalendar()
    const to = cairo(`${AFTER_LEAVE}T${WORK.workdayEnd}`)

    const answers = await distinct(everyHourOf(LEAVE_STRETCH), (from) =>
      calendar.workingMinutesBetween(from, to, WORKER),
    )

    expect(answers).toEqual([FULL_WORKDAY])
  })

  it('التسليم في أي ساعة من فترة التوقف يعطي نفس التأخير المحسوب للمهمة', async () => {
    // T2 restated where it decides money: through `computeLateness`, over a
    // stretch that is half agency calendar and half this منفّذ's own leave.
    const calendar = leaveCalendar()
    const dueDate = cairo('2026-03-03T17:00')
    const beforeStretch = await lateDays(calendar, {
      dueDate,
      submittedAt: cairo('2026-03-05T23:59'),
    })

    const answers = await distinct(everyHourOf(LEAVE_STRETCH), (submittedAt) =>
      lateDays(calendar, { dueDate, submittedAt }),
    )

    expect(answers).toEqual([beforeStretch])
    expect(beforeStretch).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Deadlines that land on days off
// ─────────────────────────────────────────────────────────────────────────────

describe('موعد التسليم يقع على يوم عطلة', () => {
  it('موعد يوم جمعة يصادف عيد العمال يُخصم مرة واحدة لا مرتين', async () => {
    // 1 May 2026 is both عيد العمال and a Friday. The day is already off;
    // removing it twice would drag the first chargeable day a day earlier.
    const calendar = egyptianCalendar()
    const dueDate = cairo('2026-05-01T17:00')

    await expect(
      lateDays(calendar, { dueDate, submittedAt: cairo('2026-05-02T23:00') }),
    ).resolves.toBe(0)
    await expect(
      lateDays(calendar, { dueDate, submittedAt: cairo('2026-05-03T09:00') }),
    ).resolves.toBe(1)
  })

  it('موعد في ليلة عطلة ممتدة يكلّف يوم عمل واحدًا بعد انتهائها', async () => {
    // Due on the Tuesday before عيد الأضحى, delivered on the Sunday after it:
    // four non-working days sit between the two and none is chargeable.
    await expect(
      lateDays(egyptianCalendar(), {
        dueDate: cairo(`${BEFORE_ADHA}T17:00`),
        submittedAt: cairo(`${AFTER_ADHA}T09:00`),
      }),
    ).resolves.toBe(1)
  })

  it('عيد الفطر الممتد فوق نهاية الأسبوع لا يُخصم مرتين', async () => {
    // عيد الفطر 2026 runs 20–22 March, and the 20th and 21st are already the
    // Friday/Saturday weekend. Subtracting them as weekend *and* as holiday
    // would answer zero for a delivery five days past its deadline.
    await expect(
      lateDays(egyptianCalendar(), {
        dueDate: cairo('2026-03-18T17:00'),
        submittedAt: cairo('2026-03-23T09:00'),
      }),
    ).resolves.toBe(2)
  })

  it('موعد يقع داخل إجازة المنفّذ المعتمدة لا يولّد تأخيرًا', async () => {
    // SPEC §5.3: "approved leave never generates lateness" — including when it
    // is the deadline itself that landed in the leave.
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-04' }],
    })
    const delivery = {
      dueDate: cairo('2026-03-02T17:00'),
      submittedAt: cairo('2026-03-04T16:00'),
    }

    await expect(lateDays(calendar, delivery)).resolves.toBe(0)
    await expect(
      lateDays(calendar, { ...delivery, assigneeId: OTHER_WORKER }),
    ).resolves.toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Days that are excluded for two reasons at once
// ─────────────────────────────────────────────────────────────────────────────

describe('تداخل الإجازة المعتمدة مع العطلة الرسمية', () => {
  it('اليوم الذي هو عطلة رسمية وإجازة معتمدة معًا يُخصم مرة واحدة', async () => {
    // Tuesday the 3rd is both. The arithmetic subtracts *days*, not reasons:
    // counting it twice would answer 2 instead of 3 and quietly forgive a day.
    const calendar = calendarWith({
      holidays: ['2026-03-03'],
      leave: [{ userId: WORKER, start: '2026-03-03', end: '2026-03-04' }],
    })

    await expect(
      calendar.workingDaysBetween(
        startOfCairoDay('2026-03-01'),
        startOfCairoDay('2026-03-06'),
        WORKER,
      ),
    ).resolves.toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Where a leave range starts and ends relative to the measured window
// ─────────────────────────────────────────────────────────────────────────────

describe('أشكال نطاق الإجازة المعتمدة', () => {
  const DUE_SUNDAY = cairo('2026-03-01T17:00')
  const SUBMITTED_THURSDAY = cairo('2026-03-05T09:00')

  it('إجازة بدأت قبل الموعد وانتهت في منتصف المدى تُخصم أيامها الواقعة بعده وحدها', async () => {
    // The row starts in February, outside the window the deduction is measured
    // over. Clipping it to the window is what keeps Monday and Tuesday off the
    // bill while Wednesday and Thursday stay on it.
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-02-25', end: '2026-03-03' }],
    })

    await expect(
      lateDays(calendar, { dueDate: DUE_SUNDAY, submittedAt: SUBMITTED_THURSDAY }),
    ).resolves.toBe(2)
  })

  it('إجازة يوم واحد تُنقص يوم تأخير واحدًا بالضبط', async () => {
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-03', end: '2026-03-03' }],
    })

    await expect(
      lateDays(calendar, { dueDate: DUE_SUNDAY, submittedAt: SUBMITTED_THURSDAY }),
    ).resolves.toBe(3)
  })

  it('إجازة تنتهي يوم الموعد نفسه لا تغيّر ما بعده', async () => {
    // Lateness is measured over `[dueDate, submittedAt)`, so leave that ends on
    // the deadline day is entirely behind the window. A منفّذ who returns to
    // work on the day the deadline passes owes exactly what anyone else owes.
    const delivery = {
      dueDate: cairo('2026-03-03T17:00'),
      submittedAt: SUBMITTED_THURSDAY,
    }
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-01', end: '2026-03-03' }],
    })

    await expect(lateDays(calendar, delivery)).resolves.toBe(2)
    await expect(lateDays(calendarWith(), delivery)).resolves.toBe(2)
  })

  it('إجازة تغطي كامل المدى بين الموعد والتسليم تلغي التأخير كله', async () => {
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-05' }],
    })

    await expect(
      lateDays(calendar, {
        dueDate: DUE_SUNDAY,
        submittedAt: cairo('2026-03-05T14:00'),
      }),
    ).resolves.toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// One-off versus recurring holiday rows
// ─────────────────────────────────────────────────────────────────────────────

describe('العطلات المتكررة وغير المتكررة', () => {
  it('العطلة غير المتكررة لا تتكرر في السنة التالية', async () => {
    // 30 June is عيد ثورة 30 يونيو, stored as a one-off row for 2026 — a
    // Tuesday that year and a Wednesday the next. Nothing in the row says
    // "every year", so 2027 must charge for it like any other working day; an
    // over-eager expansion would invent a day off and forgive a real deduction.
    const calendar = egyptianCalendar()

    await expect(
      calendar.workingDaysBetween(
        startOfCairoDay('2026-06-29'),
        startOfCairoDay('2026-07-01'),
      ),
    ).resolves.toBe(1)
    await expect(
      calendar.workingDaysBetween(
        startOfCairoDay('2027-06-29'),
        startOfCairoDay('2027-07-01'),
      ),
    ).resolves.toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Weekend configurations other than the default
// ─────────────────────────────────────────────────────────────────────────────

describe('عطلات أسبوعية غير افتراضية', () => {
  const splitWeekend = (): Calendar => calendarWith({ weekendDays: ['FRI', 'SUN'] })

  it('عطلة الجمعة والأحد تترك السبت يوم عمل بين يومي توقف', async () => {
    // A weekend does not have to be two adjacent days. Thursday → Monday then
    // charges the Saturday and the Monday, and skips the Friday and Sunday.
    await expect(
      lateDays(splitWeekend(), {
        dueDate: cairo('2026-03-05T17:00'),
        submittedAt: cairo('2026-03-09T09:00'),
      }),
    ).resolves.toBe(2)
  })

  it('يوم التوقف المنفرد يخضع لقاعدة T2 نفسها', async () => {
    // T2 is not a rule about long weekends: an isolated Sunday off behaves the
    // same way, and every hour of it answers what the Saturday night answered.
    const calendar = splitWeekend()
    const dueDate = cairo('2026-03-05T17:00')
    const beforeSunday = await lateDays(calendar, {
      dueDate,
      submittedAt: cairo('2026-03-07T23:59'),
    })

    const answers = await distinct(everyHourOf(['2026-03-08']), (submittedAt) =>
      lateDays(calendar, { dueDate, submittedAt }),
    )

    expect(answers).toEqual([beforeSunday])
    expect(beforeSunday).toBe(1)
  })

  it('العدّ الحسابي يطابق العدّ يومًا بيوم مع عطلة أسبوعية غير متصلة', async () => {
    // Whole weeks are counted as `weekendDays.size` each and only the 0–6 day
    // remainder is walked. A weekend whose two days are not adjacent is where
    // an off-by-one in that remainder would hide, so every remainder length is
    // checked against the day-by-day truth.
    const calendar = splitWeekend()

    let walked = 0
    for (let length = 1; length <= 28; length += 1) {
      if (await calendar.isWorkingDay(startOfCairoDay(marchKey(length - 1)))) {
        walked += 1
      }
      await expect(
        calendar.workingDaysBetween(
          startOfCairoDay(marchKey(0)),
          startOfCairoDay(marchKey(length)),
        ),
      ).resolves.toBe(walked)
    }
  })

  it('مع عطلة الجمعة وحدها يصبح التسليم يوم السبت يومَ تأخير', async () => {
    // T2 protects the *configured* days off, not the word "weekend". Move
    // Saturday back into the working week and delivering on it costs exactly
    // what delivering on any other working day costs.
    const delivery = {
      dueDate: cairo('2026-03-05T17:00'),
      submittedAt: cairo('2026-03-07T09:00'),
    }

    await expect(
      lateDays(calendarWith({ weekendDays: ['FRI'] }), delivery),
    ).resolves.toBe(1)
    await expect(lateDays(calendarWith(), delivery)).resolves.toBe(0)
  })

  it('عطلة أسبوعية من ستة أيام تجعل كل أسبوع يوم تأخير واحدًا', async () => {
    // The extreme the Settings schema still allows. Two weeks of delay cost
    // two days, which is the whole-week shortcut answering at `size = 6`.
    const calendar = calendarWith({
      weekendDays: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'],
    })

    await expect(
      lateDays(calendar, {
        dueDate: cairo('2026-03-01T17:00'),
        submittedAt: cairo('2026-03-15T09:00'),
      }),
    ).resolves.toBe(2)
  })
})
