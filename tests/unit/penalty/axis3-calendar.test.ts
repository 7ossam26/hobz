import { describe, expect, it } from 'vitest'

import { createCalendar, startOfCairoDay, type Calendar } from '@/lib/calendar'
import { toMoney } from '@/lib/money'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import {
  assessPenaltyForRow,
  type PenaltyAssessment,
  type PenaltySettings,
  type PenaltyTaskRow,
} from '@/modules/penalty/assess'
import type { PenaltyMode } from '@/modules/penalty/mode'

import {
  inMemoryCalendarSource,
  type InMemoryCalendarOptions,
} from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * docs/TESTING.md §4 axis 3 — the calendar, applied to the **amount**.
 *
 * `tests/unit/lateness/calendar-cases.test.ts` already sweeps this axis for
 * `lateWorkingDays`. It stops one layer short of the thing the منفّذ actually
 * argues about: the number of pounds. A day count and a deduction are not the
 * same assertion, because between them sit the grace chain, the profile, the
 * basis and the `_ONCE` modes — any of which can drop a calendar rule on the
 * floor while `modules/lateness` keeps answering correctly. So every case here
 * asserts on `assessment.target`, the figure the ledger is asked to hold.
 *
 * ── How to read every expectation below ───────────────────────────────────
 *
 * The منفّذ carries an explicit `FIXED_PER_DAY` profile priced at **100.00 a
 * day**, so the money is the working-day count with two zeros on the end and
 * the arithmetic never hides inside a percentage. That price is a test *input*
 * (a mode's value), which is why it is a literal; every Settings-owned number
 * — the weekend, the workday bounds, `workingDaysPerMonth`, the penalty
 * defaults — is read from `SETTINGS_CATALOG` instead, so an organization that moves
 * off Friday/Saturday breaks these cases loudly rather than leaving them
 * quietly proving something about a calendar nobody uses.
 *
 * Grace defaults to **0** here, again explicitly: it makes the measured window
 * exactly `[dueDate, submittedAt)`, so each comment can list the days it
 * contains and nothing else. The one section that is *about* grace sets it.
 *
 * ── The fixture weeks, with their weekdays stated once ────────────────────
 *
 *   March 2026     Sun 1, Mon 2, Tue 3, Wed 4, Thu 5, Fri 6, Sat 7,
 *                  Sun 8, Mon 9, Tue 10, Wed 11 …
 *   April/May 2026 Thu 30 Apr, Fri 1 May (عيد العمال), Sat 2, Sun 3 …
 *   Late May 2026  Mon 25, Tue 26, Wed 27 (عيد الأضحى), Thu 28 (عيد الأضحى),
 *                  Fri 29, Sat 30, Sun 31, Mon 1 Jun
 *   January 2026   Thu 22, Fri 23, Sat 24, Sun 25 (عيد الثورة والشرطة),
 *                  Mon 26, Tue 27
 *   January 2027   Thu 21, Fri 22, Sat 23, Sun 24, Mon 25 (same holiday,
 *                  a Monday that year), Tue 26
 *
 * A working day is counted when **its own Cairo midnight** falls inside the
 * half-open window (SPEC §5.3), which is why the day a delivery lands on is
 * charged whenever the delivery is later than that midnight.
 */

const WORKER = 'worker-1'
const OTHER_WORKER = 'worker-2'

/** The profile's price per late working day. An input, hence a literal. */
const PER_DAY = '100.00'

/** The task's own value. Only the `_ONCE` percentage case reads it. */
const TASK_VALUE = '1000.00'

/** Organization Settings, never retyped — docs/TESTING.md §5. */
const SETTINGS: PenaltySettings = {
  defaultMode: SETTINGS_CATALOG['penalty.defaultMode'].default,
  defaultValue: SETTINGS_CATALOG['penalty.defaultValue'].default,
  defaultGraceHours: SETTINGS_CATALOG['penalty.defaultGraceHours'].default,
  penalizeRevisionLateness: SETTINGS_CATALOG['penalty.penalizeRevisionLateness'].default,
  workingDaysPerMonth: SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default,
}

const WORK = {
  weekendDays: SETTINGS_CATALOG['calendar.weekendDays'].default,
  workdayStart: SETTINGS_CATALOG['calendar.workdayStart'].default,
  workdayEnd: SETTINGS_CATALOG['calendar.workdayEnd'].default,
  workingDaysPerMonth: SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default,
}

/** The *shipped* `lib/calendar`, fed from memory instead of Postgres. */
const calendarWith = (options: InMemoryCalendarOptions = {}): Calendar =>
  createCalendar(inMemoryCalendarSource({ ...WORK, ...options }))

/** عيد الأضحى 2026: Wednesday 27 and Thursday 28 May, running into the weekend. */
const ADHA = ['2026-05-27', '2026-05-28'] as const
const adhaCalendar = (): Calendar => calendarWith({ holidays: ADHA })

/** عيد العمال 2026 — 1 May, which is a Friday that year. */
const LABOUR_DAY = '2026-05-01'

/** Past every fixture, so a delivered task measures at its `submittedAt`. */
const FAR_FUTURE = cairo('2030-01-01T00:00')

interface BlockStretch {
  start: Date
  /** Null while the task is still blocked. */
  end: Date | null
}

interface Delivery {
  dueDate: Date
  submittedAt: Date
  /** Hours, on the project. Zero unless the case is about grace. */
  graceHours?: number
  /** `null` means nobody is accountable — the organization calendar applies. */
  assigneeId?: string | null
  mode?: PenaltyMode
  value?: string
  blocked?: readonly BlockStretch[]
}

type ActivityRow = PenaltyTaskRow['activity'][number]

/**
 * The `TaskActivity` rows a blocked stretch leaves behind. `modules/lateness`
 * reads intervals out of the feed rather than off a column (SPEC §5.3), so a
 * test that wants a blocked Friday has to write the same two rows the state
 * machine would have written.
 */
function blockRows(stretch: BlockStretch): ActivityRow[] {
  const rows: ActivityRow[] = [
    {
      type: 'STATUS_CHANGED',
      from: 'IN_PROGRESS',
      to: 'BLOCKED',
      createdAt: stretch.start,
    },
  ]
  if (stretch.end !== null) {
    rows.push({
      type: 'STATUS_CHANGED',
      from: 'BLOCKED',
      to: 'IN_PROGRESS',
      createdAt: stretch.end,
    })
  }
  return rows
}

function taskRow(delivery: Delivery): PenaltyTaskRow {
  const assigneeId = delivery.assigneeId === undefined ? WORKER : delivery.assigneeId

  return {
    id: 'task-1',
    title: 'تصميم هوية بصرية',
    // Delivered, so the clock has stopped at `submittedAt` and review time is
    // not the worker's (SPEC §5.3).
    status: 'SUBMITTED',
    taskValue: toMoney(TASK_VALUE),
    dueDate: delivery.dueDate,
    originalDueDate: delivery.dueDate,
    submittedAt: delivery.submittedAt,
    assigneeId,
    project: {
      id: 'project-1',
      // The grace is pinned on the **project**, not on the profile, and that is
      // load-bearing rather than arbitrary: `resolveGraceHours` reads project →
      // profile → global, and the profile hangs off the assignee. Putting the
      // fixture's grace on the profile made the unassigned row below fall back
      // to the organization's 24 hours while every other row used 0 — two variables
      // moving at once in a case that is supposed to isolate the calendar. The
      // project override is the one link that survives having nobody assigned.
      gracePeriodHours: delivery.graceHours ?? 0,
      penalizeRevisionLateness: null,
    },
    assignee:
      assigneeId === null
        ? null
        : {
            id: assigneeId,
            fullName: 'منفّذ الاختبار',
            deletedAt: null,
            payType: 'PER_TASK',
            monthlySalary: null,
            defaultTaskRate: toMoney(TASK_VALUE),
            penaltyProfile: {
              id: 'profile-1',
              name: 'خصم يومي ثابت',
              mode: delivery.mode ?? 'FIXED_PER_DAY',
              value: toMoney(delivery.value ?? PER_DAY),
              graceHours: null,
              deletedAt: null,
            },
          },
    activity: (delivery.blocked ?? []).flatMap(blockRows),
  }
}

const assess = (calendar: Calendar, delivery: Delivery): Promise<PenaltyAssessment> =>
  assessPenaltyForRow(taskRow(delivery), {
    calendar,
    settings: SETTINGS,
    now: FAR_FUTURE,
  })

/** What the ledger is asked to hold — the whole point of the axis. */
const amount = async (calendar: Calendar, delivery: Delivery): Promise<string> =>
  (await assess(calendar, delivery)).target

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
 * The distinct amounts a sweep produces. Exactly one entry means the منفّذ
 * cannot gain or lose money by choosing an hour inside the stretch.
 */
async function distinctAmounts(
  calendar: Calendar,
  instants: readonly Date[],
  deliver: (submittedAt: Date) => Delivery,
): Promise<string[]> {
  const answers = new Set<string>()
  for (const at of instants) answers.add(await amount(calendar, deliver(at)))
  return [...answers]
}

// ─────────────────────────────────────────────────────────────────────────────
// Deadlines that land on a weekend day
// ─────────────────────────────────────────────────────────────────────────────

describe('موعد التسليم يقع في عطلة نهاية الأسبوع', () => {
  it('موعد يوم الجمعة لا يكلّف شيئًا حتى يبدأ يوم الأحد', async () => {
    // A Friday deadline is the ordinary case at an organization whose week ends on
    // Thursday, and it is where a naive `submittedAt − dueDate` would charge
    // two days for a delivery the منفّذ could not legitimately have made
    // earlier. Due Fri 6 March 17:00, weekend Fri 6 + Sat 7.
    const calendar = calendarWith()
    const dueDate = cairo('2026-03-06T17:00')

    // [Fri 6 17:00 → Sat 7 23:00): only Sat 7's midnight falls inside, and
    // Saturday is a weekend day → 0 working days.
    await expect(
      amount(calendar, { dueDate, submittedAt: cairo('2026-03-07T23:00') }),
    ).resolves.toBe('0.00')

    // + Sun 8's midnight, the first working day → 1 × 100.00.
    await expect(
      amount(calendar, { dueDate, submittedAt: cairo('2026-03-08T09:00') }),
    ).resolves.toBe('100.00')

    // + Mon 9's midnight → 2 × 100.00.
    await expect(
      amount(calendar, { dueDate, submittedAt: cairo('2026-03-09T09:00') }),
    ).resolves.toBe('200.00')
  })

  it('موعد يوم السبت يكلّف ما يكلّفه موعد مساء الخميس نفسه', async () => {
    // Friday and Saturday are free, so a deadline anywhere between Thursday
    // evening and Saturday evening buys the same first chargeable day. If the
    // two ever disagreed, a manager could make a deduction bigger or smaller
    // by choosing which day off to write on the brief — exactly the "manager's
    // mood" this product exists to remove.
    const calendar = calendarWith()
    const submittedAt = cairo('2026-03-09T09:00') // Monday 09:00

    // Sat 7 17:00 → Mon 9 09:00: Sun 8 ✓, Mon 9 ✓ = 2 × 100.00.
    await expect(
      amount(calendar, { dueDate: cairo('2026-03-07T17:00'), submittedAt }),
    ).resolves.toBe('200.00')

    // Thu 5 17:00 → Mon 9 09:00: Fri 6 ✗, Sat 7 ✗, Sun 8 ✓, Mon 9 ✓ = 2.
    await expect(
      amount(calendar, { dueDate: cairo('2026-03-05T17:00'), submittedAt }),
    ).resolves.toBe('200.00')

    // Delivered on the Sunday instead: Sun 8 ✓ only = 1 × 100.00.
    await expect(
      amount(calendar, {
        dueDate: cairo('2026-03-07T17:00'),
        submittedAt: cairo('2026-03-08T23:00'),
      }),
    ).resolves.toBe('100.00')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Deadlines on an official holiday, and grace that expires on one
// ─────────────────────────────────────────────────────────────────────────────

describe('موعد التسليم يقع في عطلة رسمية', () => {
  it('عيد العمال الواقع يوم جمعة يُخصم مرة واحدة لا مرتين', async () => {
    // 1 May 2026 is عيد العمال *and* a Friday: the day is off for two reasons
    // and must be removed once. Subtracting it as a weekend day and again as a
    // holiday would answer zero for a delivery that really is a working day
    // late — a deduction that quietly disappears is worse than a wrong one,
    // because nobody ever files a ticket about it.
    const calendar = calendarWith({ holidays: [LABOUR_DAY] })

    // Thu 30 Apr 17:00 → Sun 3 May 09:00.
    // Fri 1 ✗ (weekend and holiday), Sat 2 ✗ (weekend), Sun 3 ✓ = 1 × 100.00.
    await expect(
      amount(calendar, {
        dueDate: cairo('2026-04-30T17:00'),
        submittedAt: cairo('2026-05-03T09:00'),
      }),
    ).resolves.toBe('100.00')
  })

  it('موعد يقع في أول أيام العيد يبدأ الخصم من أول يوم عمل بعده', async () => {
    // Due *on* عيد الأضحى, Wednesday 27 May. Four non-working days in a row
    // follow the deadline, and the bill starts at the Sunday.
    const calendar = adhaCalendar()
    const dueDate = cairo('2026-05-27T17:00')

    // → Sat 30 23:00: Thu 28 ✗ (عيد), Fri 29 ✗, Sat 30 ✗ = 0 working days.
    await expect(
      amount(calendar, { dueDate, submittedAt: cairo('2026-05-30T23:00') }),
    ).resolves.toBe('0.00')

    // → Sun 31 09:00: + Sun 31 ✓ = 1 × 100.00.
    await expect(
      amount(calendar, { dueDate, submittedAt: cairo('2026-05-31T09:00') }),
    ).resolves.toBe('100.00')
  })

  it('انتهاء المهلة داخل العيد لا يغيّر الخصم مهما طالت', async () => {
    // SPEC §5.3: grace is a *duration*, not working days — the working-day
    // filter applies to what comes after it. So a grace period spent entirely
    // inside عيد الأضحى buys the منفّذ nothing, and the organization loses nothing
    // by granting it: every one of these expires somewhere in the four-day
    // stretch Wed 27 → Sat 30, and the first chargeable day is Sun 31 either
    // way. Due Tue 26 May 17:00, delivered Mon 1 June 09:00 — Sun 31 ✓ and
    // Mon 1 ✓ once the grace is gone.
    const calendar = adhaCalendar()
    const delivery = {
      dueDate: cairo('2026-05-26T17:00'),
      submittedAt: cairo('2026-06-01T09:00'),
    }

    // 0h → Tue 26 17:00 · 24h → Wed 27 17:00 (عيد) · 48h → Thu 28 17:00 (عيد)
    // 72h → Fri 29 17:00 · 96h → Sat 30 17:00. All land before Sun 31 00:00.
    for (const graceHours of [0, 24, 48, 72, 96]) {
      await expect(amount(calendar, { ...delivery, graceHours })).resolves.toBe('200.00')
    }

    // 104h reaches Sun 31 01:00 — past that day's own midnight, so the Sunday
    // stops being chargeable and only Mon 1 remains. Grace bites exactly when
    // it survives into a working day, and not one hour earlier.
    await expect(amount(calendar, { ...delivery, graceHours: 104 })).resolves.toBe(
      '100.00',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A late window spanning a multi-day holiday
// ─────────────────────────────────────────────────────────────────────────────

describe('نافذة تأخير تمتد فوق عطلة متعددة الأيام', () => {
  it('أيام عيد الأضحى داخل النافذة لا تكلّف المنفّذ شيئًا', async () => {
    // Mon 25 May 17:00 → Mon 1 June 09:00, one week of wall clock.
    //   Tue 26 ✓ · Wed 27 ✗ عيد · Thu 28 ✗ عيد · Fri 29 ✗ · Sat 30 ✗ ·
    //   Sun 31 ✓ · Mon 1 ✓  → 3 × 100.00 = 300.00
    // The same week with no holiday rows charges Wed and Thu too → 5 × 100.00.
    // The عيد is therefore worth exactly 200.00 to this منفّذ, which is the
    // whole claim: a deduction may not grow because the country was closed.
    const delivery = {
      dueDate: cairo('2026-05-25T17:00'),
      submittedAt: cairo('2026-06-01T09:00'),
    }

    await expect(amount(adhaCalendar(), delivery)).resolves.toBe('300.00')
    await expect(amount(calendarWith(), delivery)).resolves.toBe('500.00')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Approved leave inside the late window
// ─────────────────────────────────────────────────────────────────────────────

describe('إجازة المنفّذ المعتمدة داخل نافذة التأخير', () => {
  it('أيام الإجازة المعتمدة لا تكلّف شيئًا وتخص صاحبها وحده', async () => {
    // Leave narrows one person's calendar; it does not close the organization. Two
    // منفّذين with identical deadlines and identical deliveries owe different
    // amounts, and that difference is exactly the approved leave.
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-03', end: '2026-03-04' }],
    })
    const delivery = {
      dueDate: cairo('2026-03-01T17:00'),
      submittedAt: cairo('2026-03-05T09:00'),
    }

    // Mon 2 ✓ · Tue 3 ✗ إجازة · Wed 4 ✗ إجازة · Thu 5 ✓ → 2 × 100.00.
    await expect(amount(calendar, delivery)).resolves.toBe('200.00')

    // Same window, somebody who was at their desk: 4 × 100.00.
    await expect(
      amount(calendar, { ...delivery, assigneeId: OTHER_WORKER }),
    ).resolves.toBe('400.00')
  })

  it('إجازة تغطي النافذة كلها تلغي الخصم', async () => {
    // SPEC §5.3: "approved leave never generates lateness". Not "generates
    // less" — none. Mon 2 → Thu 5 are all approved leave, so the four days the
    // window contains are worth 0.00 and there is no entry to write at all.
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-05' }],
    })

    const assessment = await assess(calendar, {
      dueDate: cairo('2026-03-01T17:00'),
      submittedAt: cairo('2026-03-05T09:00'),
    })

    expect(assessment.target).toBe('0.00')
    expect(assessment.calculation.status).toBe('NOT_LATE')
    expect(assessment.breakdown).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SPEC §5.2's T2 edge case, read from the money side
// ─────────────────────────────────────────────────────────────────────────────

describe('العمل التطوعي في يوم عطلة — SPEC §5.2 T2', () => {
  /** Due Sunday 1 March 17:00 for all three sweeps, so the amount is non-zero. */
  const DUE_SUNDAY = cairo('2026-03-01T17:00')

  it('التسليم في أي ساعة من عطلة نهاية الأسبوع يعطي نفس الخصم', async () => {
    // Forty-eight instants across Fri 6 and Sat 7, and one answer. Mon 2 ·
    // Tue 3 · Wed 4 · Thu 5 are chargeable and nothing after them is, so the
    // bill is 4 × 100.00 wherever inside the weekend the منفّذ pressed submit.
    const calendar = calendarWith()

    const answers = await distinctAmounts(
      calendar,
      everyHourOf(['2026-03-06', '2026-03-07']),
      (submittedAt) => ({ dueDate: DUE_SUNDAY, submittedAt }),
    )

    expect(answers).toEqual(['400.00'])
    // …and the same as delivering on the Thursday night, before the weekend
    // began. The weekend is invisible to the deduction in both directions.
    await expect(
      amount(calendar, { dueDate: DUE_SUNDAY, submittedAt: cairo('2026-03-05T23:59') }),
    ).resolves.toBe('400.00')
  })

  it('التسليم في أي ساعة من العطلة الرسمية يعطي نفس الخصم', async () => {
    // The same property over four non-working days that are half holiday and
    // half weekend: Wed 27 عيد, Thu 28 عيد, Fri 29, Sat 30. Due Mon 25 May
    // 17:00, so only Tue 26 is ever chargeable → 1 × 100.00, ninety-six times.
    const calendar = adhaCalendar()
    const dueDate = cairo('2026-05-25T17:00')

    const answers = await distinctAmounts(
      calendar,
      everyHourOf(['2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30']),
      (submittedAt) => ({ dueDate, submittedAt }),
    )

    expect(answers).toEqual(['100.00'])
    await expect(
      amount(calendar, { dueDate, submittedAt: cairo('2026-05-26T23:00') }),
    ).resolves.toBe('100.00')
  })

  it('التسليم في أي ساعة من إجازة معتمدة يعطي نفس الخصم', async () => {
    // T2 built out of the one ingredient that belongs to a single person:
    // approved leave Wed 4 + Thu 5, running straight into the Fri 6 / Sat 7
    // weekend. Due Sun 1 17:00 → Mon 2 ✓ and Tue 3 ✓ are the whole bill.
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-04', end: '2026-03-05' }],
    })

    const answers = await distinctAmounts(
      calendar,
      everyHourOf(['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']),
      (submittedAt) => ({ dueDate: DUE_SUNDAY, submittedAt }),
    )

    expect(answers).toEqual(['200.00'])
    await expect(
      amount(calendar, { dueDate: DUE_SUNDAY, submittedAt: cairo('2026-03-03T23:00') }),
    ).resolves.toBe('200.00')
  })

  it('من سلّم يوم العطلة لا يُخصم منه أكثر ممن سلّم مع بداية أول يوم عمل بعدها', async () => {
    // T2 stated as the comparison a منفّذ would actually make out loud: "I
    // worked through Saturday to get it in — did that cost me?" It must not,
    // and the only way to prove that is against the person who waited. Working
    // voluntarily on a day off never hurts and never helps.
    const calendar = calendarWith()

    // Saturday afternoon: Mon 2 · Tue 3 · Wed 4 · Thu 5 → 400.00.
    const onWeekend = await amount(calendar, {
      dueDate: DUE_SUNDAY,
      submittedAt: cairo('2026-03-07T12:00'),
    })
    // Sunday 00:00 — the instant the next working day begins. Its own midnight
    // is not *inside* the half-open window, so it is not chargeable yet.
    const atStartOfNextWorkingDay = await amount(calendar, {
      dueDate: DUE_SUNDAY,
      submittedAt: startOfCairoDay('2026-03-08'),
    })
    // Sunday 09:00 — the day is under way and is charged like any other.
    const duringNextWorkingDay = await amount(calendar, {
      dueDate: DUE_SUNDAY,
      submittedAt: cairo('2026-03-08T09:00'),
    })

    expect(onWeekend).toBe('400.00')
    expect(atStartOfNextWorkingDay).toBe(onWeekend)
    expect(duringNextWorkingDay).toBe('500.00')
    expect(Number(onWeekend)).toBeLessThanOrEqual(Number(duringNextWorkingDay))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A weekend other than the shipped Friday/Saturday
// ─────────────────────────────────────────────────────────────────────────────

describe('عطلة أسبوعية غير افتراضية', () => {
  it('تغيير أيام العطلة الأسبوعية يغيّر الخصم تبعًا لها', async () => {
    // One unchanged delivery — due Thu 5 March 17:00, submitted Sat 7 23:00 —
    // priced under three weekend configurations. T2 protects the *configured*
    // days off, not the word "weekend": move Friday back into the working week
    // and Friday costs money, exactly like any other working day.
    const delivery = {
      dueDate: cairo('2026-03-05T17:00'),
      submittedAt: cairo('2026-03-07T23:00'),
    }

    // FRI+SAT (the shipped default): Fri 6 ✗, Sat 7 ✗ → nothing owed.
    await expect(amount(calendarWith(), delivery)).resolves.toBe('0.00')

    // SAT+SUN: Fri 6 ✓, Sat 7 ✗ → 1 × 100.00.
    await expect(
      amount(calendarWith({ weekendDays: ['SAT', 'SUN'] }), delivery),
    ).resolves.toBe('100.00')

    // SUN alone: Fri 6 ✓, Sat 7 ✓ → 2 × 100.00.
    await expect(amount(calendarWith({ weekendDays: ['SUN'] }), delivery)).resolves.toBe(
      '200.00',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Recurring versus one-off holiday rows
// ─────────────────────────────────────────────────────────────────────────────

describe('العطلة السنوية المتكررة داخل النافذة', () => {
  /**
   * عيد الثورة وعيد الشرطة, 25 January — a fixed Gregorian date, so it is the
   * kind of row an operator would enter once as recurring. It lands on a
   * Sunday in 2026 and a Monday in 2027: both working days under the default
   * weekend, so in both years it is the recurrence itself that removes a day.
   */
  const POLICE_DAY = '01-25'

  const IN_2026 = {
    dueDate: cairo('2026-01-22T17:00'), // Thursday
    submittedAt: cairo('2026-01-27T09:00'), // Tuesday
  }
  const IN_2027 = {
    dueDate: cairo('2027-01-21T17:00'), // Thursday
    submittedAt: cairo('2027-01-26T09:00'), // Tuesday
  }

  it('العطلة المتكررة تُسقط يومًا من الخصم في كل سنة', async () => {
    // 2026: Fri 23 ✗ · Sat 24 ✗ · Sun 25 ✗ عطلة · Mon 26 ✓ · Tue 27 ✓ → 200.00
    // 2027: Fri 22 ✗ · Sat 23 ✗ · Sun 24 ✓ · Mon 25 ✗ عطلة · Tue 26 ✓ → 200.00
    // Same amount, different weekday — which is what "annual" has to mean.
    const calendar = calendarWith({ recurringHolidays: [POLICE_DAY] })

    await expect(amount(calendar, IN_2026)).resolves.toBe('200.00')
    await expect(amount(calendar, IN_2027)).resolves.toBe('200.00')

    // Without the row, each window charges its third working day: 3 × 100.00.
    await expect(amount(calendarWith(), IN_2026)).resolves.toBe('300.00')
    await expect(amount(calendarWith(), IN_2027)).resolves.toBe('300.00')
  })

  it('العطلة غير المتكررة لا تُسقط شيئًا في السنة التالية', async () => {
    // The mirror image, and the reason the distinction is worth a test: an
    // over-eager expansion would invent a day off in 2027 and forgive 100.00
    // that was genuinely owed. Nothing in a one-off row says "every year".
    const calendar = calendarWith({ holidays: ['2026-01-25'] })

    await expect(amount(calendar, IN_2026)).resolves.toBe('200.00')
    await expect(amount(calendar, IN_2027)).resolves.toBe('300.00')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKED stretches meeting weekends, holidays and leave
// ─────────────────────────────────────────────────────────────────────────────

describe('الإيقاف المؤقت فوق العطلات والإجازات', () => {
  /**
   * `modules/lateness/service.ts` is explicit that the exclusion is a
   * subtraction, and that both halves go through the *same* `workingDaysBetween`
   * with the *same* assignee — "a blocked Friday, a blocked holiday and a
   * blocked day of approved leave are all worth zero on both sides of the
   * subtraction, so none of them can be excused twice". These four cases are
   * that sentence priced in pounds. The failure they rule out is not academic:
   * a blocked stretch measured in calendar days would refund days nobody was
   * ever charged for, and the deduction would silently shrink or vanish.
   */

  it('يوم جمعة موقوف لا يُعفى مرتين', async () => {
    // Due Thu 5 March 17:00, delivered Mon 9 09:00.
    //   Fri 6 ✗ weekend · Sat 7 ✗ weekend · Sun 8 ✓ · Mon 9 ✓ → 2 × 100.00.
    // Block exactly the Friday: it was already worth nothing, so the bill does
    // not move and `blockedWorkingDays` reports the honest zero.
    const calendar = calendarWith()
    const delivery = {
      dueDate: cairo('2026-03-05T17:00'),
      submittedAt: cairo('2026-03-09T09:00'),
    }

    await expect(amount(calendar, delivery)).resolves.toBe('200.00')

    const blocked = await assess(calendar, {
      ...delivery,
      blocked: [{ start: cairo('2026-03-06T00:00'), end: cairo('2026-03-07T00:00') }],
    })

    expect(blocked.target).toBe('200.00')
    expect(blocked.lateness.blockedWorkingDays).toBe(0)
  })

  it('يوم عطلة رسمية موقوف لا يُعفى مرتين', async () => {
    // Due Tue 26 May 17:00, delivered Mon 1 June 09:00.
    //   Wed 27 ✗ عيد · Thu 28 ✗ عيد · Fri 29 ✗ · Sat 30 ✗ · Sun 31 ✓ ·
    //   Mon 1 ✓ → 2 × 100.00. Blocking both عيد days refunds nothing.
    const calendar = adhaCalendar()
    const delivery = {
      dueDate: cairo('2026-05-26T17:00'),
      submittedAt: cairo('2026-06-01T09:00'),
    }

    await expect(amount(calendar, delivery)).resolves.toBe('200.00')

    const blocked = await assess(calendar, {
      ...delivery,
      blocked: [{ start: cairo('2026-05-27T00:00'), end: cairo('2026-05-29T00:00') }],
    })

    expect(blocked.target).toBe('200.00')
    expect(blocked.lateness.blockedWorkingDays).toBe(0)
  })

  it('يوم إجازة معتمدة موقوف لا يُعفى مرتين', async () => {
    // Approved leave Tue 3 + Wed 4. Due Sun 1 17:00, delivered Thu 5 09:00:
    //   Mon 2 ✓ · Tue 3 ✗ إجازة · Wed 4 ✗ إجازة · Thu 5 ✓ → 2 × 100.00.
    // The block covers the two leave days and changes nothing — the same
    // `userId` is passed to both sides of the subtraction, so the leave is
    // already gone from the total before anything is taken out of it.
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-03', end: '2026-03-04' }],
    })
    const delivery = {
      dueDate: cairo('2026-03-01T17:00'),
      submittedAt: cairo('2026-03-05T09:00'),
    }

    await expect(amount(calendar, delivery)).resolves.toBe('200.00')

    const blocked = await assess(calendar, {
      ...delivery,
      blocked: [{ start: cairo('2026-03-03T00:00'), end: cairo('2026-03-05T00:00') }],
    })

    expect(blocked.target).toBe('200.00')
    expect(blocked.lateness.blockedWorkingDays).toBe(0)
  })

  it('إيقاف ممتد فوق عطلة وإجازة يعفي أيام العمل وحدها', async () => {
    // The case where all three kinds of day off meet one block. Holiday Tue 3,
    // approved leave Wed 4, weekend Fri 6 + Sat 7. Due Sun 1 17:00, delivered
    // Mon 9 09:00:
    //   Mon 2 ✓ · Tue 3 ✗ عطلة · Wed 4 ✗ إجازة · Thu 5 ✓ · Fri 6 ✗ ·
    //   Sat 7 ✗ · Sun 8 ✓ · Mon 9 ✓ → 4 × 100.00 unblocked.
    // The block runs Mon 2 00:00 → Sat 7 00:00, five calendar days, of which
    // only Mon 2 and Thu 5 were ever chargeable → 2 excused, 2 × 100.00 left.
    // Counting the block in calendar days would have refunded five and driven
    // the arithmetic negative.
    const calendar = calendarWith({
      holidays: ['2026-03-03'],
      leave: [{ userId: WORKER, start: '2026-03-04', end: '2026-03-04' }],
    })
    const delivery = {
      dueDate: cairo('2026-03-01T17:00'),
      submittedAt: cairo('2026-03-09T09:00'),
    }

    await expect(amount(calendar, delivery)).resolves.toBe('400.00')

    const blocked = await assess(calendar, {
      ...delivery,
      blocked: [{ start: cairo('2026-03-02T00:00'), end: cairo('2026-03-07T00:00') }],
    })

    expect(blocked.lateness.blockedWorkingDays).toBe(2)
    expect(blocked.lateness.lateWorkingDays).toBe(2)
    expect(blocked.target).toBe('200.00')
  })

  it('إيقاف يغطي النافذة كلها ينزل بالخصم إلى صفر ولا يجعله سالبًا', async () => {
    // The block starts before the deadline and ends after the delivery, so it
    // is clipped to the whole measured window. Every day the window counted is
    // taken back out: 4 − 4 = 0, and there is no entry to write. A deduction
    // can reach zero; it can never become a credit (SPEC §5.4 gives penalties
    // no negative form).
    const calendar = calendarWith()

    const blocked = await assess(calendar, {
      dueDate: cairo('2026-03-01T17:00'),
      submittedAt: cairo('2026-03-05T09:00'),
      blocked: [{ start: cairo('2026-03-01T00:00'), end: cairo('2026-03-06T00:00') }],
    })

    expect(blocked.lateness.blockedWorkingDays).toBe(4)
    expect(blocked.lateness.lateWorkingDays).toBe(0)
    expect(blocked.target).toBe('0.00')
    expect(blocked.calculation.status).toBe('NOT_LATE')
    expect(blocked.breakdown).toBeNull()
    expect(Number(blocked.target)).toBeGreaterThanOrEqual(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// No assignee — the organization calendar, and nobody's leave
// ─────────────────────────────────────────────────────────────────────────────

describe('مهمة بلا منفّذ', () => {
  it('تُقاس بتقويم المؤسسة ولا تسري عليها إجازة أحد', async () => {
    // `computeLateness` passes `assigneeId ?? undefined`, and `undefined` means
    // "organization calendar only" — no leave query at all. The count therefore has
    // to be the unnarrowed one even though a leave row exists for someone else
    // in the same window, and the deduction is skipped for a reason that names
    // the missing person rather than being silently zero.
    //
    // The two rows below differ in exactly one thing, the assignee: the grace
    // lives on the project precisely so that removing the منفّذ does not also
    // remove their profile's grace and change the window under the comparison.
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-03', end: '2026-03-04' }],
    })
    const delivery = {
      dueDate: cairo('2026-03-01T17:00'),
      submittedAt: cairo('2026-03-05T09:00'),
    }

    const unassigned = await assess(calendar, { ...delivery, assigneeId: null })

    // Mon 2 ✓ · Tue 3 ✓ · Wed 4 ✓ · Thu 5 ✓ — the organization worked all four.
    expect(unassigned.lateness.lateWorkingDays).toBe(4)
    expect(unassigned.userId).toBeNull()
    expect(unassigned.skipReason).toBe('no-assignee')
    expect(unassigned.target).toBe('0.00')
    expect(unassigned.breakdown).toBeNull()

    // The same task with the منفّذ attached sees only two of those days.
    const assigned = await assess(calendar, delivery)
    expect(assigned.lateness.lateWorkingDays).toBe(2)
    expect(assigned.target).toBe('200.00')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A `_ONCE` mode still answers to the calendar
// ─────────────────────────────────────────────────────────────────────────────

describe('نمط الخصم لمرة واحدة والتقويم', () => {
  /** 10% of a 1000.00 task = 100.00, charged once however long the delay. */
  const ONCE = { mode: 'PCT_TASK_VALUE_ONCE' as PenaltyMode, value: '10' }

  it('الخصم لمرة واحدة لا يكبر بعدد الأيام لكن التقويم قد يلغيه', async () => {
    // Worth a case of its own because the calendar reaches a `_ONCE` mode
    // through a single question — "were they late at all?" — and a rule that
    // holds for `_PER_DAY` can still be dropped there. Three days late and one
    // day late cost the same 100.00; a delivery the calendar scores at zero
    // working days costs nothing, even though the wall clock says three days.
    const calendar = adhaCalendar()

    // Mon 25 17:00 → Mon 1 June 09:00: Tue 26 ✓, Sun 31 ✓, Mon 1 ✓ = 3 days.
    await expect(
      amount(calendar, {
        ...ONCE,
        dueDate: cairo('2026-05-25T17:00'),
        submittedAt: cairo('2026-06-01T09:00'),
      }),
    ).resolves.toBe('100.00')

    // Mon 25 17:00 → Wed 27 09:00: Tue 26 ✓, Wed 27 ✗ عيد = 1 day.
    await expect(
      amount(calendar, {
        ...ONCE,
        dueDate: cairo('2026-05-25T17:00'),
        submittedAt: cairo('2026-05-27T09:00'),
      }),
    ).resolves.toBe('100.00')

    // Wed 27 17:00 → Sat 30 23:00: عيد, عيد, weekend, weekend = 0 days.
    await expect(
      amount(calendar, {
        ...ONCE,
        dueDate: cairo('2026-05-27T17:00'),
        submittedAt: cairo('2026-05-30T23:00'),
      }),
    ).resolves.toBe('0.00')
  })
})
