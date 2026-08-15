import { describe, expect, it } from 'vitest'

import {
  addCairoDays,
  addHours,
  buildWorkCalendar,
  cairoDateKey,
  cairoDaysBetweenKeys,
  cairoInstant,
  createCalendar,
  endOfCairoDay,
  isCairoDateKey,
  parseTimeOfDay,
  startOfCairoDay,
  type Calendar,
  type Weekday,
} from '@/lib/calendar'
import { DomainError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings'
import {
  escalationLevelFor,
  type EscalationThresholds,
} from '@/modules/lateness/escalation'
import { computeLateness, type LatenessTaskInput } from '@/modules/lateness/service'

import {
  inMemoryCalendarSource,
  type InMemoryCalendarOptions,
} from '../../helpers/calendar'
import { cairo, findCairoTransitions, HOUR_MS, MINUTE_MS } from '../../helpers/time'

/**
 * docs/TESTING.md §4 axis 1 — **boundaries** — swept across everything Phase 6
 * landed: `lib/calendar/cairo.ts`, `lib/calendar/calendar.ts`,
 * `lib/calendar/work-calendar.ts` and `modules/lateness`.
 *
 * The other files in this directory pin the *shape* of each function. This one
 * pins the exact instant each answer changes, because that is where a
 * deduction is either owed or not: zero and one, the millisecond either side of
 * a day boundary, the first and last minute a workday window can hold, exactly
 * at a threshold versus one past it, the smallest and largest range the
 * arithmetic will take, and the point at which the search refuses to keep
 * looking.
 *
 * Fixture week is March 2026, as everywhere else here: 1 March is a Sunday, so
 * 1–5 are working days and 6–7 (Friday, Saturday) are the default weekend.
 */

const SUNDAY = '2026-03-01'
const MONDAY = '2026-03-02'
const TUESDAY = '2026-03-03'
const FRIDAY = '2026-03-06'
const SATURDAY = '2026-03-07'
const NEXT_SUNDAY = '2026-03-08'
const NEXT_MONDAY = '2026-03-09'

const DEFAULT_GRACE = SETTINGS_CATALOG['penalty.defaultGraceHours'].default

const plain = () => createCalendar(inMemoryCalendarSource())
const calendarWith = (options: InMemoryCalendarOptions = {}): Calendar =>
  createCalendar(inMemoryCalendarSource(options))

/**
 * An instant shifted by whole milliseconds.
 *
 * `helpers/time` stops at minutes, and the sharpest boundary in this module is
 * a single millisecond either side of a Cairo midnight. Always derived from an
 * instant `cairo()` built — never from the wall clock.
 */
const plusMs = (at: Date, ms: number): Date => new Date(at.getTime() + ms)

// ─────────────────────────────────────────────────────────────────────────────
// cairo.ts — the civil-date primitives
// ─────────────────────────────────────────────────────────────────────────────

describe('parseTimeOfDay — أطراف الصيغة', () => {
  it('يقبل الحد الفاصل بين نمطي الساعة في التعبير النمطي', () => {
    // `[01]\d|2[0-3]`: 19:59 is the last reading the first alternative covers
    // and 20:00 the first the second does. A regex that lost the seam would
    // reject a legitimate workday bound and `buildWorkCalendar` would throw on
    // a Settings value the Settings schema had already accepted.
    expect(parseTimeOfDay('19:59')).toBe(19 * 60 + 59)
    expect(parseTimeOfDay('20:00')).toBe(20 * 60)
  })

  it('يرفض ما يشبه الصيغة دون أن يكونها', () => {
    // The pattern is anchored, so nothing may hide before or after the four
    // digits. A silently-accepted `09:00:00` would parse as 09:00 and quietly
    // shorten or lengthen every workday in the agency.
    for (const value of ['', ' 09:00', '09:00 ', '09:00:00', '0900', '-1:00']) {
      expect(() => parseTimeOfDay(value)).toThrow(DomainError)
    }
  })
})

describe('cairoInstant — آخر دقيقة في اليوم', () => {
  it('أقصى دقيقة يمكن التعبير عنها تسبق نهاية اليوم بدقيقة واحدة', () => {
    // 23:59 is the largest reading `parseTimeOfDay` accepts, so a workday
    // window can never contain the day's final minute. Measured on a day
    // proven ordinary rather than assumed to be: the two transition days are
    // 23 and 25 hours long and this identity does not hold on them.
    const { forward, back } = findCairoTransitions(2026)
    expect(cairoDateKey(forward as Date)).not.toBe(SUNDAY)
    expect(cairoDateKey(back as Date)).not.toBe(SUNDAY)

    const lastMinute = cairoInstant(SUNDAY, parseTimeOfDay('23:59'))
    expect(endOfCairoDay(SUNDAY).getTime() - lastMinute.getTime()).toBe(MINUTE_MS)
  })
})

describe('isCairoDateKey — أطراف الشهر واليوم', () => {
  it('يرفض الصفر في الشهر أو اليوم ويرفض اليوم الثاني والثلاثين', () => {
    // The round-trip through the day number is what rejects these; a naive
    // range check on the digits would let `2026-01-00` through as "the day
    // before the first", which is a real date one month earlier.
    expect(isCairoDateKey('2026-00-01')).toBe(false)
    expect(isCairoDateKey('2026-01-00')).toBe(false)
    expect(isCairoDateKey('2026-01-32')).toBe(false)
  })

  it('يقبل أول يوم في السنة وآخر يوم فيها', () => {
    expect(isCairoDateKey('2026-01-01')).toBe(true)
    expect(isCairoDateKey('2026-12-31')).toBe(true)
  })
})

describe('addCairoDays و cairoDaysBetweenKeys — أكبر المسافات', () => {
  it('يعكس أحدهما الآخر عند الصفر والواحد وعشرة آلاف يوم في الاتجاهين', () => {
    // Integer civil arithmetic has no accumulating error, so the inverse must
    // be exact at any magnitude — including the negative direction the
    // extension and reminder code walks.
    for (const days of [-10_000, -1, 0, 1, 10_000]) {
      expect(cairoDaysBetweenKeys(SUNDAY, addCairoDays(SUNDAY, days))).toBe(days)
    }
  })
})

describe('addHours — الصفر والسالب', () => {
  it('إضافة صفر ساعة لا تحرّك اللحظة', () => {
    // A project configured with zero grace (SPEC §5.3) must land its effective
    // deadline exactly on the deadline, not a rounding away from it.
    const due = cairo(`${SUNDAY}T17:00`)
    expect(addHours(due, 0)).toEqual(due)
  })

  it('الساعات السالبة تتراجع بنفس مقدار تقدّم الموجبة', () => {
    const due = cairo(`${SUNDAY}T17:00`)
    const afterGrace = addHours(due, DEFAULT_GRACE)

    expect(afterGrace.getTime() - due.getTime()).toBe(DEFAULT_GRACE * HOUR_MS)
    expect(addHours(afterGrace, -DEFAULT_GRACE)).toEqual(due)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// work-calendar.ts — the workday window at its extremes
// ─────────────────────────────────────────────────────────────────────────────

describe('buildWorkCalendar — طرفا نافذة الدوام', () => {
  const windowOf = (workdayStart: string, workdayEnd: string) =>
    buildWorkCalendar({
      weekendDays: ['FRI', 'SAT'],
      workdayStart,
      workdayEnd,
      workingDaysPerMonth: SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default,
    })

  it('نافذة صفرية عندما تتساوى بداية الدوام مع نهايته', () => {
    // Not an inverted window — an *equal* one. The Settings schema validates
    // each bound on its own and cannot compare the two, so a copy-paste that
    // sets both to 09:00 arrives here looking valid.
    expect(windowOf('09:00', '09:00').workdayMinutes).toBe(0)
  })

  it('أصغر نافذة غير صفرية تساوي دقيقة واحدة', () => {
    expect(windowOf('09:00', '09:01').workdayMinutes).toBe(1)
  })

  it('أوسع نافذة ممكنة تنقص دقيقة واحدة عن اليوم الكامل', () => {
    expect(windowOf('00:00', '23:59').workdayMinutes).toBe(24 * 60 - 1)
  })
})

describe('workingMinutesBetween — نافذة دوام عند الطرفين', () => {
  const dayLong = (options: InMemoryCalendarOptions) =>
    calendarWith(options).workingMinutesBetween(
      startOfCairoDay(SUNDAY),
      startOfCairoDay(MONDAY),
    )

  it('لا تتراكم دقائق عندما تتساوى بداية الدوام مع نهايته', async () => {
    await expect(dayLong({ workdayStart: '09:00', workdayEnd: '09:00' })).resolves.toBe(0)
  })

  it('نافذة الدقيقة الواحدة تعطي دقيقة واحدة في اليوم الكامل', async () => {
    await expect(dayLong({ workdayStart: '09:00', workdayEnd: '09:01' })).resolves.toBe(1)
  })

  it('أوسع نافذة تعطي يومًا كاملًا ناقصًا دقيقة', async () => {
    await expect(dayLong({ workdayStart: '00:00', workdayEnd: '23:59' })).resolves.toBe(
      24 * 60 - 1,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// calendar.ts — the half-open rule, to the millisecond
// ─────────────────────────────────────────────────────────────────────────────

describe('workingDaysBetween — أصغر نطاق ممكن', () => {
  it('مللي ثانية واحدة تحتوي بداية يوم عمل تُحتسب يومًا كاملًا', async () => {
    const start = startOfCairoDay(SUNDAY)
    await expect(plain().workingDaysBetween(start, plusMs(start, 1))).resolves.toBe(1)
  })

  it('نطاق يغطي اليوم كله إلا أول مللي ثانية منه لا يُحتسب', async () => {
    // The rule is "the day's own start falls inside [from, to)", not "the
    // range touches the day". This is its sharpest form, and the reason a
    // deadline at 00:00 and a submission at 23:59 the same day are zero days
    // apart.
    await expect(
      plain().workingDaysBetween(
        plusMs(startOfCairoDay(SUNDAY), 1),
        startOfCairoDay(MONDAY),
      ),
    ).resolves.toBe(0)
  })

  it('مللي ثانية واحدة بعد نهاية النطاق تضيف يوم عمل كاملًا', async () => {
    const from = startOfCairoDay(SUNDAY)
    const to = startOfCairoDay(MONDAY)

    await expect(plain().workingDaysBetween(from, to)).resolves.toBe(1)
    await expect(plain().workingDaysBetween(from, plusMs(to, 1))).resolves.toBe(2)
  })

  it('نطاق طوله مللي ثانية داخل اليوم لا يحتوي بداية يوم فلا يُحتسب', async () => {
    const at = cairo(`${SUNDAY}T12:00`)
    await expect(plain().workingDaysBetween(at, plusMs(at, 1))).resolves.toBe(0)
  })
})

describe('workingDaysBetween — عطلة أسبوعية عند طرفي الحجم', () => {
  // Settings caps `calendar.weekendDays` at six entries, so these are the two
  // extremes the arithmetic can actually be handed.
  const SIX_DAY_WEEKEND: readonly Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI']
  const DUPLICATED_WEEKEND: readonly Weekday[] = ['FRI', 'FRI', 'SAT', 'SAT']

  it('عطلة من ستة أيام تترك يوم عمل واحدًا في كل أسبوع كامل', async () => {
    // The seam in the arithmetic shortcut: six days is no full week and is
    // walked, seven is exactly one full week, eight is a week plus a walked
    // remainder. All three must agree with the single Saturday in the span.
    const calendar = calendarWith({ weekendDays: SIX_DAY_WEEKEND })
    const from = startOfCairoDay(SUNDAY)

    await expect(
      calendar.workingDaysBetween(from, startOfCairoDay(SATURDAY)),
    ).resolves.toBe(0)
    await expect(
      calendar.workingDaysBetween(from, startOfCairoDay(NEXT_SUNDAY)),
    ).resolves.toBe(1)
    await expect(
      calendar.workingDaysBetween(from, startOfCairoDay(NEXT_MONDAY)),
    ).resolves.toBe(1)
  })

  it('بلا عطلة أسبوعية يُحتسب الأسبوع الكامل سبعة أيام', async () => {
    await expect(
      calendarWith({ weekendDays: [] }).workingDaysBetween(
        startOfCairoDay(SUNDAY),
        startOfCairoDay(NEXT_SUNDAY),
      ),
    ).resolves.toBe(7)
  })

  it('تكرار اليوم نفسه في قائمة العطلة لا يخصمه مرتين', async () => {
    // `weekendDays` is a list in Settings, not a set, and nothing there rejects
    // a duplicate. Subtracting Friday twice would invent a working day out of
    // thin air and shrink somebody's deduction.
    await expect(
      calendarWith({ weekendDays: DUPLICATED_WEEKEND }).workingDaysBetween(
        startOfCairoDay(SUNDAY),
        startOfCairoDay(NEXT_SUNDAY),
      ),
    ).resolves.toBe(5)
  })
})

describe('workingDaysBetween — أطول مدى', () => {
  it('يعدّ عشرين سنة دفعة واحدة بلا أفق يوقفه', async () => {
    // Counting has no search horizon — only `addWorkingDays` does. With no
    // weekend and no holidays every calendar day is a working day, so the
    // answer must equal the civil day count exactly, across five leap years
    // and twenty pairs of DST transitions.
    await expect(
      calendarWith({ weekendDays: [] }).workingDaysBetween(
        startOfCairoDay('2020-01-01'),
        startOfCairoDay('2040-01-01'),
      ),
    ).resolves.toBe(cairoDaysBetweenKeys('2020-01-01', '2040-01-01'))
  })
})

describe('addWorkingDays — أفق البحث', () => {
  const everyDayWorks = () => calendarWith({ weekendDays: [] })

  it('يقبل أطول مدى يبحث فيه ويرفض ما بعده بيوم واحد', async () => {
    // The horizon is deliberately not a Settings value — it is the point past
    // which "there is no next working day" is the only honest answer. It is
    // therefore measured here rather than typed in: with every day a working
    // day, the number of days asked for is exactly the number of steps taken,
    // so bisecting on it finds the constant itself.
    const from = cairo(`${SUNDAY}T09:00`)
    const accepts = async (days: number): Promise<boolean> => {
      try {
        await everyDayWorks().addWorkingDays(from, days)
        return true
      } catch {
        return false
      }
    }

    let accepted = 1
    let refused = 16_384
    expect(await accepts(accepted)).toBe(true)
    expect(await accepts(refused)).toBe(false)
    while (refused - accepted > 1) {
      const mid = accepted + Math.floor((refused - accepted) / 2)
      if (await accepts(mid)) accepted = mid
      else refused = mid
    }

    // Ten years is the stated intent: far beyond any deadline this product
    // will ever set, so no real caller can meet the refusal.
    expect(accepted).toBeGreaterThanOrEqual(10 * 365)
    await expect(everyDayWorks().addWorkingDays(from, accepted)).resolves.toEqual(
      cairoInstant(addCairoDays(SUNDAY, accepted), parseTimeOfDay('09:00')),
    )
    await expect(everyDayWorks().addWorkingDays(from, accepted + 1)).rejects.toThrow(
      DomainError,
    )
  })

  it('صفر يوم عمل لا يحرّك التاريخ ولو وقع على يوم عطلة', async () => {
    // Zero steps means the loop never runs, so no skipping is implied: the
    // call only normalises the clock to the workday start. A caller that wants
    // "the first working day after this one" must ask `nextWorkingDay`.
    await expect(plain().addWorkingDays(cairo(`${FRIDAY}T15:00`), 0)).resolves.toEqual(
      cairo(`${FRIDAY}T09:00`),
    )
  })
})

describe('workingMinutesBetween — أول دقيقة وآخر دقيقة', () => {
  it('الدقيقة الأولى في النافذة تُحتسب وما قبلها لا يُحتسب', async () => {
    await expect(
      plain().workingMinutesBetween(cairo(`${SUNDAY}T09:00`), cairo(`${SUNDAY}T09:01`)),
    ).resolves.toBe(1)
    await expect(
      plain().workingMinutesBetween(cairo(`${SUNDAY}T08:59`), cairo(`${SUNDAY}T09:00`)),
    ).resolves.toBe(0)
  })

  it('الدقيقة الأخيرة في النافذة تُحتسب وما بعدها لا يُحتسب', async () => {
    await expect(
      plain().workingMinutesBetween(cairo(`${SUNDAY}T16:59`), cairo(`${SUNDAY}T17:00`)),
    ).resolves.toBe(1)
    await expect(
      plain().workingMinutesBetween(cairo(`${SUNDAY}T17:00`), cairo(`${SUNDAY}T17:01`)),
    ).resolves.toBe(0)
  })

  it('ما دون الدقيقة الكاملة يُحتسب صفرًا', async () => {
    // Floored, not rounded: 59.999 seconds of work is not a minute, and
    // rounding up would let a fraction of a second inflate elapsed working
    // time on every task in the agency.
    const start = cairo(`${SUNDAY}T09:00`)
    await expect(
      plain().workingMinutesBetween(start, plusMs(start, 59_999)),
    ).resolves.toBe(0)
    await expect(
      plain().workingMinutesBetween(start, plusMs(start, 60_000)),
    ).resolves.toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// modules/lateness — the boundaries the منفّذ is told about
// ─────────────────────────────────────────────────────────────────────────────

const FAR_FUTURE = cairo('2030-01-01T00:00')

function task(overrides: Partial<LatenessTaskInput> = {}): LatenessTaskInput {
  const dueDate = overrides.dueDate ?? cairo(`${SUNDAY}T17:00`)
  return {
    id: 'task-1',
    status: 'SUBMITTED',
    assigneeId: 'worker-1',
    dueDate,
    originalDueDate: overrides.originalDueDate ?? dueDate,
    submittedAt: null,
    blockedIntervals: [],
    ...overrides,
  }
}

const lateDays = async (
  input: Partial<LatenessTaskInput>,
  options: { graceHours?: number; now?: Date } = {},
) =>
  (
    await computeLateness(plain(), {
      task: task(input),
      graceHours: options.graceHours ?? 0,
      now: options.now ?? FAR_FUTURE,
    })
  ).lateWorkingDays

describe('computeLateness — لحظة القياس بالضبط', () => {
  it('التسليم في نفس لحظة القياس يُعلن أن الساعة توقّفت', async () => {
    // `min(now, submittedAt)` has already reached its cap: the count cannot
    // grow again. Reporting "still accruing" here and "frozen" one millisecond
    // later would flicker in the منفّذ's breakdown without the number moving.
    const at = cairo(`${MONDAY}T09:00`)
    const result = await computeLateness(plain(), {
      task: task({ status: 'SUBMITTED', submittedAt: at }),
      graceHours: 0,
      now: cairo(`${MONDAY}T09:00`),
    })

    expect(result.measuredAt).toEqual(at)
    expect(result.frozen).toBe(true)
  })

  it('التسليم المسجَّل في المستقبل تبقى ساعته تعمل', async () => {
    // The mirror of the case above: `measuredAt` is `now`, and as real time
    // advances toward the recorded submission the count genuinely can still
    // grow, so it is not frozen yet.
    const now = cairo(`${MONDAY}T09:00`)
    const result = await computeLateness(plain(), {
      task: task({ status: 'SUBMITTED', submittedAt: cairo(`${TUESDAY}T09:00`) }),
      graceHours: 0,
      now,
    })

    expect(result.measuredAt).toEqual(now)
    expect(result.frozen).toBe(false)
  })
})

describe('computeLateness — حدود المهلة', () => {
  it('التسليم في اللحظة التي تنتهي فيها المهلة بالضبط لا يولّد تأخيرًا', async () => {
    const due = cairo(`${SUNDAY}T17:00`)
    const expiry = addHours(due, DEFAULT_GRACE)
    const result = await computeLateness(plain(), {
      task: task({ dueDate: due, submittedAt: expiry }),
      graceHours: DEFAULT_GRACE,
      now: FAR_FUTURE,
    })

    expect(result.effectiveDueDate).toEqual(expiry)
    expect(result.lateWorkingDays).toBe(0)
  })

  it('لا يبدأ العدّ إلا بعد عبور منتصف الليل بمللي ثانية واحدة', async () => {
    // Grace expires on Monday evening, so Tuesday's own start is the first
    // boundary inside the range — and a range ending exactly at that start
    // does not contain it.
    const due = cairo(`${SUNDAY}T17:00`)
    const midnight = startOfCairoDay(TUESDAY)

    await expect(
      lateDays({ dueDate: due, submittedAt: midnight }, { graceHours: DEFAULT_GRACE }),
    ).resolves.toBe(0)
    await expect(
      lateDays(
        { dueDate: due, submittedAt: plusMs(midnight, 1) },
        { graceHours: DEFAULT_GRACE },
      ),
    ).resolves.toBe(1)
  })
})

describe('computeLateness — حدّ التمديد', () => {
  it('موعد لم يتحرّك ليس تمديدًا وحركة مللي ثانية واحدة تمديد', async () => {
    // `extended` drives what the breakdown shows the منفّذ (SPEC §8), so any
    // movement of the deadline counts as one — there is no tolerance band in
    // which a moved deadline is still "the original".
    const due = cairo(`${SUNDAY}T17:00`)
    const common = { submittedAt: due, originalDueDate: due }

    const unchanged = await computeLateness(plain(), {
      task: task({ ...common, dueDate: due }),
      graceHours: 0,
      now: FAR_FUTURE,
    })
    const moved = await computeLateness(plain(), {
      task: task({ ...common, dueDate: plusMs(due, 1) }),
      graceHours: 0,
      now: FAR_FUTURE,
    })

    expect(unchanged.extended).toBe(false)
    expect(moved.extended).toBe(true)
  })
})

describe('escalationLevelFor — حدود متطابقة وصفرية', () => {
  it('عند تساوي الحدّين يفوز الأشد عند بلوغهما بالضبط', () => {
    const threshold = SETTINGS_CATALOG['notifications.escalateToPmAfterDays'].default
    const same: EscalationThresholds = {
      pmAfterDays: threshold,
      adminAfterDays: threshold,
    }

    expect(escalationLevelFor(threshold - 1, same)).toBe('NONE')
    expect(escalationLevelFor(threshold, same)).toBe('ADMIN')
  })

  it('حدّان بصفر يقفزان إلى الإدارة عند أول يوم تأخير لا قبله', () => {
    // Both thresholds at their minimum: the `lateWorkingDays > 0` guard is the
    // only thing standing between "escalate as soon as it slips" and
    // escalating every on-time task in the agency to the admin.
    const immediate: EscalationThresholds = { pmAfterDays: 0, adminAfterDays: 0 }

    expect(escalationLevelFor(0, immediate)).toBe('NONE')
    expect(escalationLevelFor(1, immediate)).toBe('ADMIN')
  })
})
