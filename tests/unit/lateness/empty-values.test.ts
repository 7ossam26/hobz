import { describe, expect, it } from 'vitest'

import {
  addHours,
  buildWorkCalendar,
  createCalendar,
  dateColumnValue,
  expandHolidayRows,
  expandLeaveRows,
} from '@/lib/calendar'
import { SETTINGS_CATALOG } from '@/lib/settings'
import {
  escalationLevelFor,
  nextEscalationLevel,
  type EscalationThresholds,
} from '@/modules/lateness/escalation'
import {
  computeLateness,
  latenessInputFromRow,
  type LatenessRow,
  type LatenessTaskInput,
} from '@/modules/lateness/service'
import { rangesOverlap } from '@/modules/leave/service'
import { computeElapsed } from '@/modules/task/elapsed'

import { inMemoryCalendarSource, stubCalendar } from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * docs/TESTING.md §4 axis 12 — **empty and null**, over Phase 6.
 *
 * On the day this system is installed, every table that feeds `lib/calendar` is
 * empty: no holidays, no leave, no submissions, nobody has been assigned
 * anything. Axis 12 is the claim that all of those answer with an honest zero
 * or an empty list — never a throw, and never an invented value.
 *
 * ── Why the inverse is asserted just as hard ──────────────────────────────
 *
 * "Answers zero" is only half of it, and the dangerous half to test alone. A
 * `workingDaysBetween` that returned 0 because the holiday table is empty would
 * pass every "no crash" test in this file while computing no deductions at all
 * — the failure Phase 0 named as the worst one this product can have. So every
 * emptiness here is paired with the thing it must *not* suppress:
 *
 *  - an empty holiday table still leaves Sunday–Thursday as working days;
 *  - a منفّذ with no leave row is measured exactly like the agency calendar,
 *    and the emptiness is *queried*, not assumed;
 *  - a zero-length workday zeroes elapsed *minutes* and leaves late *days*
 *    untouched, because they are different measurements of different things.
 */

const WORKER = 'worker-1'

/** Business values are read, never typed in (docs/TESTING.md §5). */
const DEFAULT_GRACE = SETTINGS_CATALOG['penalty.defaultGraceHours'].default
const WEEKEND = SETTINGS_CATALOG['calendar.weekendDays'].default
const WORKDAY_START = SETTINGS_CATALOG['calendar.workdayStart'].default
const WORKDAY_END = SETTINGS_CATALOG['calendar.workdayEnd'].default
const DAYS_PER_MONTH = SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default

/**
 * An empty weekend is a *legitimate* Settings value, not a fantasy: the
 * catalog's own validator is `min(0)`. Parsing it through that validator here
 * is what says so — if the schema is ever tightened to require at least one
 * weekend day, this line fails and the tests below stop claiming to cover a
 * configuration nobody can reach.
 */
const NO_WEEKEND = SETTINGS_CATALOG['calendar.weekendDays'].schema.parse([])

/**
 * Fixture week is March 2026, as everywhere else in this suite: 1 March is a
 * Sunday, so 1–5 are working days and 6–7 are the default weekend.
 */
const SUNDAY_DUE = cairo('2026-03-01T17:00')
const NEXT_SUNDAY = cairo('2026-03-08T09:00')

/** Past every fixture, so a delivered task measures at its own `submittedAt`. */
const FAR_FUTURE = cairo('2030-01-01T00:00')

function task(overrides: Partial<LatenessTaskInput> = {}): LatenessTaskInput {
  const dueDate = overrides.dueDate ?? SUNDAY_DUE
  return {
    id: 'task-1',
    status: 'SUBMITTED',
    assigneeId: WORKER,
    dueDate,
    originalDueDate: dueDate,
    submittedAt: null,
    blockedIntervals: [],
    ...overrides,
  }
}

/** The agency on day one: the holiday table and the leave table are both empty. */
const brandNewAgency = () => inMemoryCalendarSource({ weekendDays: WEEKEND })

describe('وكالة جديدة — لا عطلات مسجَّلة ولا إجازات', () => {
  it('جدول عطلات فارغ لا يُلغي التأخير — أيام الأسبوع تظل أيام عمل', async () => {
    // The inverse that matters. Nothing is configured yet, and the honest
    // answer is *not* zero: Sunday 17:00 → the next Sunday 09:00 crosses seven
    // day boundaries, two of which are the weekend.
    const source = brandNewAgency()

    const result = await computeLateness(createCalendar(source), {
      task: task({ submittedAt: NEXT_SUNDAY }),
      graceHours: 0,
      now: FAR_FUTURE,
    })

    expect(result.lateWorkingDays).toBe(5)
    // …and the emptiness was measured rather than skipped: the source was asked.
    expect(source.holidayCalls).toBe(1)
  })

  it('منفّذ جديد بلا سجل إجازات يُقاس بنفس تقويم الوكالة', async () => {
    const calendar = createCalendar(brandNewAgency())
    const submitted = { submittedAt: NEXT_SUNDAY }

    const forNewcomer = await computeLateness(calendar, {
      task: task({ ...submitted, assigneeId: 'hired-this-morning' }),
      graceHours: 0,
      now: FAR_FUTURE,
    })
    const agencyOnly = await computeLateness(calendar, {
      task: task({ ...submitted, assigneeId: null }),
      graceHours: 0,
      now: FAR_FUTURE,
    })

    expect(forNewcomer.lateWorkingDays).toBe(agencyOnly.lateWorkingDays)
    expect(forNewcomer.lateWorkingDays).toBeGreaterThan(0)
  })

  it('مهمة بلا منفّذ لا تسأل عن إجازات أحد، والمنفّذ الجديد يُسأل عنه فعلًا', async () => {
    // Two different kinds of nothing. "No assignee" means there is nobody whose
    // leave could apply, so the query must not be issued at all; "a منفّذ with
    // no rows" means the query is issued and comes back empty. Collapsing the
    // two would either invent a user or trust an assumption.
    const source = brandNewAgency()
    const calendar = createCalendar(source)

    await computeLateness(calendar, {
      task: task({ assigneeId: null, submittedAt: NEXT_SUNDAY }),
      graceHours: 0,
      now: FAR_FUTURE,
    })
    expect(source.leaveCalls).toBe(0)

    await computeLateness(calendar, {
      task: task({ assigneeId: 'hired-this-morning', submittedAt: NEXT_SUNDAY }),
      graceHours: 0,
      now: FAR_FUTURE,
    })
    expect(source.leaveCalls).toBe(1)
  })

  it('نطاق بلا امتداد يجيب بصفر دون أن يسأل المصدر أصلًا', async () => {
    // A span containing no day boundary cannot contain a working day either, so
    // there is nothing to look up. The nightly job runs this case for every
    // on-time task in the agency; a query per task would be a query for nothing.
    const source = brandNewAgency()
    const at = cairo('2026-03-02T09:00')

    await expect(createCalendar(source).workingDaysBetween(at, at, WORKER)).resolves.toBe(
      0,
    )

    expect(source.holidayCalls).toBe(0)
    expect(source.leaveCalls).toBe(0)
  })
})

describe('قائمة عطلة أسبوعية فارغة', () => {
  const noWeekend = () =>
    createCalendar(
      inMemoryCalendarSource({
        weekendDays: NO_WEEKEND,
        workdayStart: WORKDAY_START,
        workdayEnd: WORKDAY_END,
      }),
    )

  it('الجمعة والسبت يوما عمل حين لا تكون هناك عطلة أسبوعية', async () => {
    // An empty weekend list is "we work every day", not "we never work". The
    // arithmetic short-circuits on `weekend.size === 0`, and this is what keeps
    // that shortcut from meaning the opposite of what it says.
    const calendar = noWeekend()

    await expect(calendar.isWorkingDay(cairo('2026-03-06T12:00'))).resolves.toBe(true)
    await expect(calendar.isWorkingDay(cairo('2026-03-07T12:00'))).resolves.toBe(true)
  })

  it('اليوم التالي للخميس هو الجمعة حين لا توجد عطلة أسبوعية', async () => {
    await expect(noWeekend().nextWorkingDay(cairo('2026-03-05T15:00'))).resolves.toEqual(
      cairo(`2026-03-06T${WORKDAY_START}`),
    )
  })

  it('عطلة أسبوعية فارغة لا تُفرّغ عدد أيام العمل في الشهر', () => {
    // Two independent Settings keys that a fresh install could leave in any
    // combination. `workingDaysPerMonth` is the divisor SPEC §5.4 turns a
    // monthly salary into a daily rate with, and an empty weekend list must not
    // be allowed to reach into it — a zero divisor there is an infinite rate.
    const work = buildWorkCalendar({
      weekendDays: NO_WEEKEND,
      workdayStart: WORKDAY_START,
      workdayEnd: WORKDAY_END,
      workingDaysPerMonth: DAYS_PER_MONTH,
    })

    expect(work.weekendDays.size).toBe(0)
    expect(work.workingDaysPerMonth).toBe(DAYS_PER_MONTH)
  })
})

describe('يوم عمل بطول صفر', () => {
  /** `workdayStart === workdayEnd`: a window with no minutes in it. */
  const zeroLengthDay = () =>
    inMemoryCalendarSource({
      weekendDays: WEEKEND,
      workdayStart: WORKDAY_START,
      workdayEnd: WORKDAY_START,
    })

  it('نافذة عمل بلا طول تعطي صفر دقيقة، لا يومًا كاملًا', () => {
    const work = buildWorkCalendar({
      weekendDays: WEEKEND,
      workdayStart: WORKDAY_START,
      workdayEnd: WORKDAY_START,
      workingDaysPerMonth: DAYS_PER_MONTH,
    })

    expect(work.workdayStartMinutes).toBe(work.workdayEndMinutes)
    expect(work.workdayMinutes).toBe(0)
  })

  it('يوم العمل الفارغ لا يحتسب دقيقة واحدة على مدى أسبوع', async () => {
    await expect(
      createCalendar(zeroLengthDay()).workingMinutesBetween(SUNDAY_DUE, NEXT_SUNDAY),
    ).resolves.toBe(0)
  })

  it('يوم العمل الفارغ لا يُلغي أيام التأخير', async () => {
    // Minutes and days are two different measurements: SPEC §5.2 counts the
    // first, SPEC §5.3 turns the second into money. A workday window that has
    // been misconfigured to nothing must not quietly cancel every deduction in
    // the agency along with it.
    const result = await computeLateness(createCalendar(zeroLengthDay()), {
      task: task({ submittedAt: NEXT_SUNDAY }),
      graceHours: 0,
      now: FAR_FUTURE,
    })

    expect(result.lateWorkingDays).toBe(5)
  })

  it('يوم العمل الفارغ يُبقي الزمن الخام صادقًا', async () => {
    // `working` collapses to zero because no minute of the span falls inside a
    // workday window. `raw` is wall clock and owes the calendar nothing, so it
    // must not collapse with it (SPEC §5.2).
    const result = await computeElapsed(createCalendar(zeroLengthDay()), {
      assignedAt: cairo('2026-03-01T09:00'),
      submittedAt: cairo('2026-03-02T17:00'),
      assigneeId: WORKER,
    })

    expect(result.working).toBe(0)
    expect(result.raw).toBe(32 * 60)
  })
})

describe('صفوف فارغة ونوافذ مقلوبة في مصدر التقويم', () => {
  it('لا صفوف إجازة أصلًا — الإفراد يعطي مجموعة فارغة', () => {
    expect(expandLeaveRows([], '2026-03-01', '2026-03-31').size).toBe(0)
  })

  it('نافذة مقلوبة لا تُخرج عطلة من العدم', () => {
    // The expanders are pure functions and cannot see the query that bounded
    // them. A recurring row plus a backwards window is the one shape where a
    // string comparison could invent a day off for everybody.
    const recurring = [{ date: dateColumnValue('2026-05-01'), isRecurring: true }]

    expect(expandHolidayRows(recurring, '2026-03-05', '2026-03-01').size).toBe(0)
  })

  it('نافذة مقلوبة لا تُخرج يوم إجازة من العدم', () => {
    const wholeYear = [
      {
        startDate: dateColumnValue('2026-01-01'),
        endDate: dateColumnValue('2026-12-31'),
      },
    ]

    expect(expandLeaveRows(wholeYear, '2026-03-05', '2026-03-01').size).toBe(0)
  })
})

describe('مهمة بأعمدة فارغة', () => {
  it('حالة مسلَّمة بلا لحظة تسليم — الساعة تظل تعمل', async () => {
    // A row whose status says SUBMITTED while `submittedAt` is null is a data
    // gap, and the honest reading is "we have no proof of delivery": measure to
    // now and say the clock is still running. Freezing on a missing timestamp
    // would hand the منفّذ a deduction that stops growing for free.
    const now = cairo('2026-03-03T12:00')

    const result = await computeLateness(createCalendar(brandNewAgency()), {
      task: task({ status: 'SUBMITTED', submittedAt: null }),
      graceHours: 0,
      now,
    })

    expect(result.frozen).toBe(false)
    expect(result.measuredAt).toEqual(now)
    expect(result.lateWorkingDays).toBe(2)
  })

  it('مهمة لم تُمدَّد قط تُبلّغ بعدم التمديد رغم اختلاف كائني التاريخ', async () => {
    // Every task is born with `dueDate === originalDueDate`, and the two arrive
    // from Prisma as two distinct `Date` objects. Comparing references rather
    // than instants would flag the whole agency as extended.
    const result = await computeLateness(createCalendar(brandNewAgency()), {
      task: task({
        dueDate: cairo('2026-03-01T17:00'),
        originalDueDate: cairo('2026-03-01T17:00'),
        submittedAt: null,
      }),
      graceHours: 0,
      now: cairo('2026-03-02T09:00'),
    })

    expect(result.extended).toBe(false)
  })

  it('المهمة الملغاة تعطي صفرًا دون أن تسأل التقويم أصلًا', async () => {
    // Cancelled is not "zero days late as it happens" — it is "there is nothing
    // to measure". Reaching the calendar at all would mean the zero depended on
    // what the calendar said.
    const source = brandNewAgency()

    const result = await computeLateness(createCalendar(source), {
      task: task({ status: 'CANCELLED', submittedAt: null }),
      graceHours: DEFAULT_GRACE,
      now: FAR_FUTURE,
    })

    expect(result.lateWorkingDays).toBe(0)
    expect(source.holidayCalls).toBe(0)
    expect(source.leaveCalls).toBe(0)
  })

  it('المهمة الملغاة تحتفظ بتفصيل صادق لا بحقول فارغة', async () => {
    // SPEC §8 wants the breakdown shown to the منفّذ — due date, grace, days.
    // A zero with the surrounding facts blanked out is unexplainable, which is
    // the one thing CLAUDE.md says a money figure may never be.
    const result = await computeLateness(createCalendar(brandNewAgency()), {
      task: task({ status: 'CANCELLED', submittedAt: null }),
      graceHours: DEFAULT_GRACE,
      now: FAR_FUTURE,
    })

    expect(result.dueDate).toEqual(SUNDAY_DUE)
    expect(result.originalDueDate).toEqual(SUNDAY_DUE)
    expect(result.graceHours).toBe(DEFAULT_GRACE)
    expect(result.effectiveDueDate).toEqual(addHours(SUNDAY_DUE, DEFAULT_GRACE))
    expect(result.measuredAt).toEqual(FAR_FUTURE)
  })

  it('صف مهمة بأعمدة اختيارية فارغة يُترجم دون اختراع قيم', () => {
    // Straight off a freshly created row: no assignee, no submission, and a
    // project that has never set a grace override. Only the last of the three
    // has a fallback, and it is the agency default — not zero, and not a guess.
    const now = cairo('2026-03-02T09:00')
    const row: LatenessRow = {
      id: 'task-1',
      status: 'BACKLOG',
      dueDate: SUNDAY_DUE,
      originalDueDate: SUNDAY_DUE,
      submittedAt: null,
      assigneeId: null,
      activity: [],
      project: { gracePeriodHours: null },
    }

    const input = latenessInputFromRow(row, DEFAULT_GRACE, now)

    expect(input.graceHours).toBe(DEFAULT_GRACE)
    expect(input.task.assigneeId).toBeNull()
    expect(input.task.submittedAt).toBeNull()
    expect(input.now).toEqual(now)
  })
})

describe('مهمة جديدة لم تبدأ بعد', () => {
  it('لا إسناد ولا تسليم — صفران دون سؤال التقويم', async () => {
    // Both columns null is the state of every task in the backlog. There is no
    // span to hand the calendar, and asking it about one would be asking about
    // a range that does not exist.
    const calendar = stubCalendar({ workingMinutesBetween: async () => 999 })

    const result = await computeElapsed(calendar, {
      assignedAt: null,
      submittedAt: null,
      assigneeId: null,
    })

    expect(result).toEqual({ raw: 0, working: 0 })
    expect(calendar.calls).toHaveLength(0)
  })

  it('مدة أقصر من دقيقة تُقرأ كصفر ولا تصل إلى التقويم', async () => {
    // A span that exists but rounds to nothing. `minutesBetween` truncates, so
    // 59 seconds of work is zero minutes — and once it is zero there is no
    // half-open range left to ask the calendar about. Rounding *up* instead
    // would be the start of an estimate-accuracy score built on noise.
    const calendar = stubCalendar({ workingMinutesBetween: async () => 999 })

    const result = await computeElapsed(calendar, {
      assignedAt: new Date('2026-03-01T09:00:00.000Z'),
      submittedAt: new Date('2026-03-01T09:00:59.000Z'),
      assigneeId: WORKER,
    })

    expect(result).toEqual({ raw: 0, working: 0 })
    expect(calendar.calls).toHaveLength(0)
  })
})

describe('حدود تصعيد صفرية', () => {
  it('حدّان بصفر يومًا — الصفر لا يصعّد وأول يوم تأخير يقفز إلى الإدارة', () => {
    // Both thresholds at zero is a valid Settings state ("escalate the moment
    // anything slips"), and it is the one that exposes the `> 0` guard: without
    // it every on-time task in the agency would satisfy `0 >= 0` and page the
    // admin nightly.
    const immediate: EscalationThresholds = { pmAfterDays: 0, adminAfterDays: 0 }

    expect(escalationLevelFor(0, immediate)).toBe('NONE')
    expect(escalationLevelFor(1, immediate)).toBe('ADMIN')
  })

  it('مهمة لم تتأخر قط تبقى بلا تصعيد مهما تكرّر الحساب', () => {
    // The nightly job re-runs this for every open task, every night, for the
    // life of the agency. `NONE → NONE` has to be a fixed point or the first
    // healthy task would eventually acquire a flag from nothing.
    let level = nextEscalationLevel('NONE', 'NONE')
    for (let run = 0; run < 10; run += 1) level = nextEscalationLevel(level, 'NONE')

    expect(level).toBe('NONE')
  })
})

describe('rangesOverlap عند أصغر نطاق ممكن', () => {
  it('إجازة يوم واحد تتداخل مع نفسها', () => {
    // The degenerate range: start and end on the same day. Two requests for the
    // same single day are the commonest double-booking there is, and an
    // exclusive comparison would let both through.
    expect(rangesOverlap('2026-03-02', '2026-03-02', '2026-03-02', '2026-03-02')).toBe(
      true,
    )
  })

  it('إجازة يوم واحد لا تتداخل مع اليوم التالي لها مباشرة', () => {
    expect(rangesOverlap('2026-03-02', '2026-03-02', '2026-03-03', '2026-03-03')).toBe(
      false,
    )
  })
})
