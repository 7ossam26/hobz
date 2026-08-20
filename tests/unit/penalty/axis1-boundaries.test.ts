import { describe, expect, it } from 'vitest'

import { createCalendar, type Calendar } from '@/lib/calendar'
import { fitsColumn, MONEY_MAX, toMoney, toStorageString } from '@/lib/money'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import {
  assessPenaltyForRow,
  type PenaltySettings,
  type PenaltyTaskRow,
} from '@/modules/penalty/assess'
import {
  calculatePenalty,
  isChargeable,
  type PenaltyCalculationInput,
} from '@/modules/penalty/calculate'

import { inMemoryCalendarSource } from '../../helpers/calendar'
import { advanceMinutes, cairo } from '../../helpers/time'

/**
 * docs/TESTING.md §4 axis 1 — **Boundaries** — for the penalty engine.
 *
 *   > 0, 1, exactly-at-deadline, one minute after, max values.
 *
 * The other penalty suites prove the *middle* of each range: five formulas
 * against hand-computed values (`calculate.test.ts`), five pay shapes against
 * the figure each one actually carries (`basis.test.ts`), and which delivery a
 * penalty belongs to (`rounds.test.ts`). This file only visits the edges, on
 * the argument that a deduction engine is wrong at an edge or it is not wrong
 * at all: nobody disputes three days late, and everybody disputes the one.
 *
 * Two edges matter, and they are different in kind:
 *
 *  - **The day boundary**, which decides the *multiplicand*. It is exercised
 *    end to end through `assessPenaltyForRow` against the real `lib/calendar`
 *    (fed from memory, no database), because "is this zero days or one" is a
 *    question about a Cairo midnight, a grace duration and a half-open range
 *    at once, and testing the three separately proves none of them agree.
 *  - **The money boundary**, which decides the *product*. Pure arithmetic, so
 *    `calculatePenalty` is called directly and every expected figure below was
 *    worked out by hand.
 *
 * Fixture window: Monday 2 March 2026 to Tuesday 3 March 2026. Deliberately
 * mid-week — the weekend, the holidays and the DST transitions belong to
 * axes 2 and 3, and a boundary test that also crosses a Friday cannot say
 * which of the two rules it just proved.
 *
 * Business numbers come from `SETTINGS_CATALOG` (docs/TESTING.md §5). The
 * literals that remain — a profile's value, a task's value, a grace of 7 or 8
 * hours — are the *inputs under test*, not Settings read behind the suite's
 * back.
 */

const WORKER = 'worker-1'

/** Monday 2 March 2026, 17:00 Cairo. A working day, well clear of any weekend. */
const DUE = cairo('2026-03-02T17:00')
/** The next Cairo midnight, taken from the Cairo helper rather than DUE + 7h. */
const NEXT_MIDNIGHT = cairo('2026-03-03T00:00')
/** Tuesday morning — one Cairo midnight past the deadline, and nothing more. */
const TUESDAY_MORNING = cairo('2026-03-03T09:00')

/** Past every fixture, so a delivered task always measures at its `submittedAt`. */
const FAR_FUTURE = cairo('2030-01-01T00:00')

/** One millisecond either side — the finest boundary the clock actually has. */
const msBefore = (at: Date): Date => new Date(at.getTime() - 1)
const msAfter = (at: Date): Date => new Date(at.getTime() + 1)

/**
 * the organization defaults, read from the catalog rather than retyped.
 *
 * Deliberately *not* imported from `tests/helpers/penalty.ts`, which builds the
 * identical object: that helper is DB-facing (it wires `recomputeTaskPenalty`
 * onto a `PrismaClient`), and importing it here would pull the ledger service,
 * the audit log and the Prisma runtime into a project whose whole premise is
 * that it touches none of them.
 */
const SETTINGS: PenaltySettings = {
  defaultMode: SETTINGS_CATALOG['penalty.defaultMode'].default,
  defaultValue: SETTINGS_CATALOG['penalty.defaultValue'].default,
  defaultGraceHours: SETTINGS_CATALOG['penalty.defaultGraceHours'].default,
  penalizeRevisionLateness: SETTINGS_CATALOG['penalty.penalizeRevisionLateness'].default,
  workingDaysPerMonth: SETTINGS_CATALOG['calendar.workingDaysPerMonth'].default,
}

/** The real `lib/calendar`, on the organization weekend Settings ships with. */
const calendar: Calendar = createCalendar(
  inMemoryCalendarSource({
    weekendDays: SETTINGS_CATALOG['calendar.weekendDays'].default,
    workingDaysPerMonth: SETTINGS.workingDaysPerMonth,
  }),
)

interface RowOptions {
  submittedAt?: Date | null
  /** `null` means "no project override", which falls through to Settings. */
  gracePeriodHours?: number | null
  mode?: string
  value?: string
  taskValue?: string
}

/**
 * A منفّذ paid per task, on a task worth 1000, penalised a flat 100 per late
 * working day. The flat rate is chosen so that the amount is the day count in
 * hundreds — every assertion below reads as "which side of the boundary did
 * this land on", with no arithmetic in the way.
 */
function row(over: RowOptions = {}): PenaltyTaskRow {
  return {
    id: 'task-1',
    title: 'تسليم الهوية البصرية',
    status: 'SUBMITTED',
    taskValue: toMoney(over.taskValue ?? '1000.00'),
    dueDate: DUE,
    originalDueDate: DUE,
    submittedAt: over.submittedAt ?? null,
    assigneeId: WORKER,
    project: {
      id: 'project-1',
      gracePeriodHours: over.gracePeriodHours === undefined ? 0 : over.gracePeriodHours,
      penalizeRevisionLateness: null,
    },
    assignee: {
      id: WORKER,
      fullName: 'أحمد فهيم',
      deletedAt: null,
      payType: 'PER_TASK',
      monthlySalary: null,
      defaultTaskRate: toMoney('500.00'),
      penaltyProfile: {
        id: 'profile-1',
        name: 'الخصم القياسي',
        mode: over.mode ?? 'FIXED_PER_DAY',
        value: toMoney(over.value ?? '100.00'),
        graceHours: null,
        deletedAt: null,
      },
    },
    activity: [],
  }
}

const assess = (over: RowOptions = {}) =>
  assessPenaltyForRow(row(over), { calendar, settings: SETTINGS, now: FAR_FUTURE })

const input = (over: Partial<PenaltyCalculationInput>): PenaltyCalculationInput => ({
  mode: 'FIXED_ONCE',
  value: '100.00',
  lateWorkingDays: 1,
  taskValue: null,
  dailyRate: null,
  dailyRateDerivation: null,
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────
// The multiplicand: where the first late day begins
// ─────────────────────────────────────────────────────────────────────────────

describe('assessPenaltyForRow — حدّ اليوم الأول من التأخير', () => {
  it('التسليم في لحظة الموعد الفعلي بالضبط: صفر أيام ولا خصم', async () => {
    // The half-open `[dueDate + grace, measuredAt)` range is empty at its own
    // start. A closed range here would charge a منفّذ 100 for delivering on the
    // second they promised — the single most indefensible deduction the engine
    // could produce.
    const assessment = await assess({ submittedAt: DUE })

    expect(assessment.lateness.lateWorkingDays).toBe(0)
    expect(assessment.calculation.status).toBe('NOT_LATE')
    expect(assessment.target).toBe('0.00')
    expect(assessment.breakdown).toBeNull()
  })

  it('التسليم قبل الموعد بجزء من الثانية: صفر أيام', async () => {
    const assessment = await assess({ submittedAt: msBefore(DUE) })

    expect(assessment.lateness.lateWorkingDays).toBe(0)
    expect(assessment.target).toBe('0.00')
  })

  it('التسليم بعد الموعد بدقيقة: ما زال صفر أيام', async () => {
    // SPEC §5.3 counts *working days*, not elapsed time. A minute past the
    // deadline crosses no Cairo midnight, so it crosses no day boundary — and
    // an engine that charged a full day for a minute would be arithmetic
    // nobody could defend at the desk.
    const assessment = await assess({ submittedAt: advanceMinutes(DUE, 1) })

    expect(assessment.lateness.lateWorkingDays).toBe(0)
    expect(assessment.target).toBe('0.00')
  })

  it('التسليم في لحظة منتصف الليل التالية بالضبط: ما زال صفر', async () => {
    // Tuesday's own start is 00:00, and `[Mon 17:00, Tue 00:00)` excludes its
    // upper end — so Tuesday contributes no boundary and the count is still 0.
    // Half-open at *both* ends or the rule is not half-open at all.
    const assessment = await assess({ submittedAt: NEXT_MIDNIGHT })

    expect(assessment.lateness.lateWorkingDays).toBe(0)
    expect(assessment.target).toBe('0.00')
  })

  it('بعد منتصف الليل بجزء من الثانية: يوم واحد وخصم كامل', async () => {
    // One millisecond later Tuesday's start is inside the range, and the whole
    // deduction exists. 100.00 × 1 = 100.00. This millisecond is the entire
    // difference between owing nothing and owing a day.
    const assessment = await assess({ submittedAt: msAfter(NEXT_MIDNIGHT) })

    expect(assessment.lateness.lateWorkingDays).toBe(1)
    expect(assessment.calculation.status).toBe('DUE')
    expect(assessment.target).toBe('100.00')
    expect(assessment.breakdown?.amount).toBe('100.00')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The multiplicand: where grace moves that boundary to
// ─────────────────────────────────────────────────────────────────────────────

describe('assessPenaltyForRow — حدود مهلة السماح', () => {
  it('مهلة صفر قرار لا غياب: تُحترم ولا تُستبدل بافتراضي الإعدادات', async () => {
    // `??`, never `||`. A project that promised a client no slippage at all
    // must not silently inherit the organization's default grace — and the two
    // answers below are a whole day's money apart on the same submission.
    const noGrace = await assess({
      gracePeriodHours: 0,
      submittedAt: TUESDAY_MORNING,
    })
    const agencyDefault = await assess({
      gracePeriodHours: null,
      submittedAt: TUESDAY_MORNING,
    })

    expect(noGrace.lateness.graceHours).toBe(0)
    expect(noGrace.lateness.lateWorkingDays).toBe(1)
    expect(agencyDefault.lateness.graceHours).toBe(SETTINGS.defaultGraceHours)
    expect(agencyDefault.lateness.lateWorkingDays).toBe(0)
  })

  it('مهلة تنتهي في منتصف الليل بالضبط: اليوم التالي يُحتسب', async () => {
    // 17:00 + 7h lands exactly on Tuesday 00:00, and the range's lower end is
    // inclusive — so Tuesday's start is inside it and the day counts.
    const assessment = await assess({
      gracePeriodHours: 7,
      submittedAt: TUESDAY_MORNING,
    })

    expect(assessment.lateness.effectiveDueDate).toEqual(NEXT_MIDNIGHT)
    expect(assessment.lateness.lateWorkingDays).toBe(1)
    expect(assessment.target).toBe('100.00')
  })

  it('ساعة إضافية واحدة في المهلة تُسقط اليوم كاملًا', async () => {
    // 17:00 + 8h is Tuesday 01:00, one hour past Tuesday's own start — so the
    // day it began carries no boundary any more and the next one is Wednesday.
    // Grace is a duration, not a working-day count, and this is where the two
    // readings visibly disagree.
    const assessment = await assess({
      gracePeriodHours: 8,
      submittedAt: TUESDAY_MORNING,
    })

    expect(assessment.lateness.lateWorkingDays).toBe(0)
    expect(assessment.calculation.status).toBe('NOT_LATE')
    expect(assessment.target).toBe('0.00')
  })

  it('مهلة سنة كاملة: لا تأخير ولا عدد سالب', async () => {
    // 8760 hours of grace puts the effective deadline a year past a submission
    // that is a month late. The window is inverted, and the answer has to be
    // zero rather than a negative count — a negative multiplicand would turn a
    // deduction into a credit, which is the one direction this engine must
    // never be wrong in.
    const assessment = await assess({
      gracePeriodHours: 8760,
      submittedAt: cairo('2026-04-02T09:00'),
    })

    expect(assessment.lateness.lateWorkingDays).toBe(0)
    expect(assessment.target).toBe('0.00')
    expect(assessment.breakdown).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The zero cases that are *not* a calendar answer
// ─────────────────────────────────────────────────────────────────────────────

describe('assessPenaltyForRow — الصفر الذي لا يأتي من التقويم', () => {
  it('قيمة بروفايل صفر: متأخر فعلًا، وبلا خصم ولا بيان', async () => {
    // A profile configured at zero means "no deductions for this person". The
    // منفّذ is genuinely one day late and still owes nothing, and no breakdown
    // is produced — a task sheet rendering "0.00" with a formula beside it
    // would invite an argument about a deduction that does not exist.
    const assessment = await assess({
      value: '0.00',
      submittedAt: msAfter(NEXT_MIDNIGHT),
    })

    expect(assessment.lateness.lateWorkingDays).toBe(1)
    expect(assessment.calculation.status).toBe('ZERO')
    expect(assessment.target).toBe('0.00')
    expect(assessment.breakdown).toBeNull()
    expect(assessment.skipReason).toBeNull()
  })

  it('قيمة مهمة صفر ليست أساسًا: يُوقف الخصم ويُسمّى السبب', async () => {
    // Zero is not a basis, and the difference from the case above is the whole
    // point: that one is "this person is not penalised", this one is "this task
    // carries no figure to take a percentage of". Reporting them identically
    // would send an operator to edit the wrong screen.
    const assessment = await assess({
      mode: 'PCT_TASK_VALUE_PER_DAY',
      value: '5',
      taskValue: '0.00',
      submittedAt: msAfter(NEXT_MIDNIGHT),
    })

    expect(assessment.lateness.lateWorkingDays).toBe(1)
    expect(assessment.calculation.status).toBe('NO_BASIS')
    expect(assessment.skipReason).toBe('no-basis')
    expect(assessment.target).toBe('0.00')
    expect(assessment.breakdown).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The product: the smallest amounts that exist
// ─────────────────────────────────────────────────────────────────────────────

describe('calculatePenalty — حدود القيمة الصغرى', () => {
  it('أصغر خصم ممكن: قرش واحد', () => {
    // 0.01 is the smallest figure a `Decimal(12,2)` column can hold, and a
    // profile configured at it is a decision somebody made — it must survive
    // to the ledger rather than being rounded out of existence.
    const result = calculatePenalty(input({ mode: 'FIXED_ONCE', value: '0.01' }))

    expect(result.status).toBe('DUE')
    expect(result.amount).toBe('0.01')
    expect(isChargeable(result)).toBe(true)
  })

  it('أصغر أساس صالح: قيمة مهمة 0.01', () => {
    // 0.01 × 100% = 0.01. The smallest task value that is still a basis at all
    // — one piastre below it (0.00) is `NO_BASIS`, which `basis.ts` proves.
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '100',
        taskValue: toMoney('0.01'),
      }),
    )

    expect(result.status).toBe('DUE')
    expect(result.basisAmount).toBe('0.01')
    expect(result.amount).toBe('0.01')
  })

  it('نصف قرش بالضبط يُقرَّب لأعلى إلى قرش', () => {
    // 50.00 × 0.01% = 0.005, exactly the HALF_UP tipping point, and the
    // smallest one that exists. `lib/money` rounds it up because that is how a
    // human accountant rounds and how the منفّذ will re-check it.
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '0.01',
        taskValue: toMoney('50.00'),
      }),
    )

    expect(result.amount).toBe('0.01')
    expect(isChargeable(result)).toBe(true)
  })

  it('ما دون نصف قرش ليس خصمًا يُكتب في الدفتر', () => {
    // 40.00 × 0.01% = 0.004, which rounds to 0.00. The arithmetic is right; the
    // question this asserts is what the engine then *tells a caller to do*.
    // `isChargeable` is documented as "the one predicate callers should branch
    // on before writing to the ledger", and the ledger is append-only — a
    // `PENALTY` row of 0.00 could never be taken back, and SPEC §4 says an
    // entry that cannot explain itself is what this product exists to abolish.
    // A deduction of nothing cannot explain itself.
    const result = calculatePenalty(
      input({
        mode: 'PCT_TASK_VALUE_ONCE',
        value: '0.01',
        taskValue: toMoney('40.00'),
      }),
    )

    expect(result.amount).toBe('0.00')
    expect(isChargeable(result)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The product: the largest amounts that exist, and the ones past them
// ─────────────────────────────────────────────────────────────────────────────

describe('calculatePenalty — حدّ عمود المال', () => {
  it('مبلغ يساوي سقف العمود بالضبط يمرّ كما هو', () => {
    // MONEY_MAX × 100% = MONEY_MAX. The largest figure `Decimal(12,2)` holds,
    // reached exactly — nothing is lost and nothing is rounded away at the top
    // of the column's range.
    const result = calculatePenalty(
      input({ mode: 'PCT_TASK_VALUE_ONCE', value: '100', taskValue: MONEY_MAX }),
    )

    expect(result.status).toBe('DUE')
    expect(result.amount).toBe(toStorageString(MONEY_MAX))
    expect(fitsColumn(result.amount)).toBe(true)
  })

  it('لا سقف: ما يتجاوز حدّ العمود يُحسب كاملًا ويُترك للتخزين أن يرفضه', () => {
    // 9999999999.99 × 200% = 19999999999.98, which no money column can hold.
    // SPEC §5.4 says "No cap", and it means the *calculation*: clamping here
    // would be this function quietly making a policy decision that belongs to
    // the payout close, and would hide a misconfigured profile behind a
    // plausible-looking number instead of failing where somebody can see it.
    // Whether the figure can be persisted is a separate question, and
    // `fitsColumn` is where it gets asked.
    const result = calculatePenalty(
      input({ mode: 'PCT_TASK_VALUE_ONCE', value: '200', taskValue: MONEY_MAX }),
    )

    expect(result.amount).toBe('19999999999.98')
    expect(result.amount).not.toBe(toStorageString(MONEY_MAX))
    expect(fitsColumn(result.amount)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The multiplier: one day, and ten years of them
// ─────────────────────────────────────────────────────────────────────────────

describe('calculatePenalty — حدود عدد الأيام', () => {
  it('يوم واحد مقابل 3650 يومًا: الضرب خطّي بلا قصّ', () => {
    // 100.00 × 1 = 100.00, and 100.00 × 3650 = 365000.00 — a decade of working
    // days, which is past the calendar's own search horizon and still has to
    // multiply out exactly. A `_PER_DAY` mode that saturated somewhere in
    // between would understate a long-abandoned task's deduction silently.
    const perDay = (days: number) =>
      calculatePenalty(
        input({ mode: 'FIXED_PER_DAY', value: '100.00', lateWorkingDays: days }),
      ).amount

    expect(perDay(1)).toBe('100.00')
    expect(perDay(3650)).toBe('365000.00')
    expect(fitsColumn(perDay(3650))).toBe(true)
  })
})
