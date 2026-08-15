import { describe, expect, it } from 'vitest'

import { createCalendar, type Calendar } from '@/lib/calendar'
import { SETTINGS_CATALOG } from '@/lib/settings'
import {
  blockedIntervalsFromActivity,
  blockedIntervalsIn,
  mergeBlockedIntervals,
  type BlockedInterval,
} from '@/modules/lateness/blocked'
import {
  computeLateness,
  effectiveStatus,
  type LatenessTaskInput,
} from '@/modules/lateness/service'

import {
  inMemoryCalendarSource,
  type InMemoryCalendarOptions,
} from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * SPEC §5.3, as amended by the operator: **a BLOCKED task does not accrue
 * lateness while it is blocked.**
 *
 * The rule is about *intervals*, not about the current status, and these cases
 * exist mostly to hold that line. Two readings would be much easier to
 * implement and both are wrong:
 *
 *  - "skip the task while `status === 'BLOCKED'`" charges a منفّذ for a week
 *    they were blocked as soon as the task is resumed, and
 *  - it forgives three weeks of real lateness the moment somebody blocks the
 *    task today.
 *
 * Fixture week is March 2026 throughout: 1 March is a Sunday, so 1–5 are
 * working days and 6–7 (Friday, Saturday) are the default weekend.
 */

const WORKER = 'worker-1'
const WEEKEND = SETTINGS_CATALOG['calendar.weekendDays'].default
const DEFAULT_GRACE = SETTINGS_CATALOG['penalty.defaultGraceHours'].default

/** Past every fixture, so a delivered task measures at its own `submittedAt`. */
const FAR_FUTURE = cairo('2030-01-01T00:00')

/** Sunday 17:00. Every case below is measured against this unless it says otherwise. */
const DUE = cairo('2026-03-01T17:00')

const calendarWith = (options: InMemoryCalendarOptions = {}): Calendar =>
  createCalendar(inMemoryCalendarSource({ weekendDays: WEEKEND, ...options }))

function task(overrides: Partial<LatenessTaskInput> = {}): LatenessTaskInput {
  const dueDate = overrides.dueDate ?? DUE
  return {
    id: 'task-1',
    status: 'IN_PROGRESS',
    assigneeId: WORKER,
    dueDate,
    originalDueDate: overrides.originalDueDate ?? dueDate,
    submittedAt: null,
    blockedIntervals: [],
    ...overrides,
  }
}

async function lateness(
  overrides: Partial<LatenessTaskInput>,
  options: { calendar?: Calendar; graceHours?: number; now?: Date } = {},
) {
  return computeLateness(options.calendar ?? calendarWith(), {
    task: task(overrides),
    graceHours: options.graceHours ?? 0,
    now: options.now ?? FAR_FUTURE,
  })
}

const blocked = (
  start: string,
  end: string | null,
  from: BlockedInterval['from'] = 'IN_PROGRESS',
) => ({
  start: cairo(start),
  end: end === null ? null : cairo(end),
  from,
})

// ─────────────────────────────────────────────────────────────────────────────
// Reading the intervals out of the activity feed
// ─────────────────────────────────────────────────────────────────────────────

describe('blockedIntervalsFromActivity', () => {
  const row = (from: string | null, to: string | null, at: string) => ({
    from,
    to,
    createdAt: cairo(at),
  })

  it('يقرأ فترة تعليق مغلقة مع الحالة التي عُلّقت منها', () => {
    expect(
      blockedIntervalsFromActivity([
        row('IN_PROGRESS', 'BLOCKED', '2026-03-02T10:00'),
        row('BLOCKED', 'IN_PROGRESS', '2026-03-04T10:00'),
      ]),
    ).toEqual([
      {
        start: cairo('2026-03-02T10:00'),
        end: cairo('2026-03-04T10:00'),
        from: 'IN_PROGRESS',
      },
    ])
  })

  it('يترك الفترة مفتوحة عندما تكون المهمة ما زالت معلَّقة', () => {
    const intervals = blockedIntervalsFromActivity([
      row('ASSIGNED', 'BLOCKED', '2026-03-02T10:00'),
    ])
    expect(intervals).toEqual([
      { start: cairo('2026-03-02T10:00'), end: null, from: 'ASSIGNED' },
    ])
  })

  it('يقرأ عدة فترات متتالية', () => {
    const intervals = blockedIntervalsFromActivity([
      row('IN_PROGRESS', 'BLOCKED', '2026-03-02T09:00'),
      row('BLOCKED', 'IN_PROGRESS', '2026-03-03T09:00'),
      row('IN_PROGRESS', 'BLOCKED', '2026-03-05T09:00'),
      row('BLOCKED', 'IN_PROGRESS', '2026-03-09T09:00'),
    ])
    expect(intervals).toHaveLength(2)
    expect(intervals[0]?.end).toEqual(cairo('2026-03-03T09:00'))
    expect(intervals[1]?.start).toEqual(cairo('2026-03-05T09:00'))
  })

  it('يتجاهل خروجًا من التعليق بلا دخول مسجَّل', () => {
    // A feed that does not reach back to the block cannot say when it began,
    // and excusing time from an unknown start would be inventing an excuse.
    expect(
      blockedIntervalsFromActivity([row('BLOCKED', 'IN_PROGRESS', '2026-03-04T10:00')]),
    ).toEqual([])
  })

  it('لا يعشّش دخولين متتاليين — الأول هو الذي يُحتسب', () => {
    const intervals = blockedIntervalsFromActivity([
      row('IN_PROGRESS', 'BLOCKED', '2026-03-02T09:00'),
      row('IN_PROGRESS', 'BLOCKED', '2026-03-03T09:00'),
      row('BLOCKED', 'IN_PROGRESS', '2026-03-04T09:00'),
    ])
    expect(intervals).toEqual([
      {
        start: cairo('2026-03-02T09:00'),
        end: cairo('2026-03-04T09:00'),
        from: 'IN_PROGRESS',
      },
    ])
  })

  it('يرتّب الصفوف زمنيًا قبل الاقتران', () => {
    const intervals = blockedIntervalsFromActivity([
      row('BLOCKED', 'IN_PROGRESS', '2026-03-04T09:00'),
      row('IN_PROGRESS', 'BLOCKED', '2026-03-02T09:00'),
    ])
    expect(intervals).toHaveLength(1)
    expect(intervals[0]?.start).toEqual(cairo('2026-03-02T09:00'))
  })

  it('يتجاهل تغييرات الحالة التي لا تمسّ التعليق', () => {
    expect(
      blockedIntervalsFromActivity([
        row('ASSIGNED', 'IN_PROGRESS', '2026-03-02T09:00'),
        row('IN_PROGRESS', 'SUBMITTED', '2026-03-03T09:00'),
      ]),
    ).toEqual([])
  })

  it('لا يعدّل المصفوفة الواردة', () => {
    const rows = [
      row('BLOCKED', 'IN_PROGRESS', '2026-03-04T09:00'),
      row('IN_PROGRESS', 'BLOCKED', '2026-03-02T09:00'),
    ]
    const snapshot = [...rows]
    blockedIntervalsFromActivity(rows)
    expect(rows).toEqual(snapshot)
  })
})

describe('mergeBlockedIntervals', () => {
  it('يدمج فترتين متداخلتين في واحدة', () => {
    const merged = mergeBlockedIntervals([
      blocked('2026-03-02T09:00', '2026-03-05T09:00'),
      blocked('2026-03-04T09:00', '2026-03-09T09:00'),
    ])
    expect(merged).toEqual([
      { start: cairo('2026-03-02T09:00'), end: cairo('2026-03-09T09:00') },
    ])
  })

  it('لا يدمج فترتين منفصلتين', () => {
    expect(
      mergeBlockedIntervals([
        blocked('2026-03-02T09:00', '2026-03-03T09:00'),
        blocked('2026-03-05T09:00', '2026-03-06T09:00'),
      ]),
    ).toHaveLength(2)
  })

  it('فترة مفتوحة تبتلع كل ما بعدها', () => {
    expect(
      mergeBlockedIntervals([
        blocked('2026-03-02T09:00', null),
        blocked('2026-03-05T09:00', '2026-03-06T09:00'),
      ]),
    ).toEqual([{ start: cairo('2026-03-02T09:00'), end: null }])
  })

  it('فترة داخل أخرى لا تمدّدها', () => {
    expect(
      mergeBlockedIntervals([
        blocked('2026-03-02T09:00', '2026-03-09T09:00'),
        blocked('2026-03-04T09:00', '2026-03-05T09:00'),
      ]),
    ).toEqual([{ start: cairo('2026-03-02T09:00'), end: cairo('2026-03-09T09:00') }])
  })
})

describe('blockedIntervalsIn', () => {
  const window = [cairo('2026-03-02T00:00'), cairo('2026-03-06T00:00')] as const

  it('يقصّ الفترة على حدود نافذة القياس', () => {
    expect(
      blockedIntervalsIn([blocked('2026-02-20T09:00', '2026-03-04T09:00')], ...window),
    ).toEqual([{ start: window[0], end: cairo('2026-03-04T09:00') }])
  })

  it('الفترة المفتوحة تنتهي عند لحظة القياس ولا تتجاوزها', () => {
    expect(blockedIntervalsIn([blocked('2026-03-03T09:00', null)], ...window)).toEqual([
      { start: cairo('2026-03-03T09:00'), end: window[1] },
    ])
  })

  it('يسقط الفترات الواقعة خارج النافذة كليًا', () => {
    expect(
      blockedIntervalsIn([blocked('2026-01-02T09:00', '2026-01-05T09:00')], ...window),
    ).toEqual([])
  })

  it('نافذة معكوسة أو صفرية تعطي قائمة فارغة', () => {
    const interval = [blocked('2026-03-03T09:00', '2026-03-04T09:00')]
    expect(blockedIntervalsIn(interval, window[1], window[0])).toEqual([])
    expect(blockedIntervalsIn(interval, window[0], window[0])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The rule itself
// ─────────────────────────────────────────────────────────────────────────────

describe('التعليق قبل الموعد واستمراره بعده', () => {
  it('فترة التعليق لا تضيف يوم تأخير واحدًا', async () => {
    // Blocked on the Sunday morning, before the 17:00 deadline, and still
    // blocked a fortnight later. Every working day past the deadline is inside
    // the block, so there is nothing to charge.
    const result = await lateness(
      {
        status: 'BLOCKED',
        blockedIntervals: [blocked('2026-03-01T09:00', null)],
      },
      { now: cairo('2026-03-13T12:00') },
    )

    expect(result.lateWorkingDays).toBe(0)
    expect(result.blockedWorkingDays).toBe(9)
  })

  it('نفس المهمة بلا تعليق تكون متأخرة تسعة أيام عمل', async () => {
    // The control. Without it the case above could be passing because the
    // window is empty rather than because the block was excused.
    const result = await lateness({}, { now: cairo('2026-03-13T12:00') })
    expect(result.lateWorkingDays).toBe(9)
    expect(result.blockedWorkingDays).toBe(0)
  })
})

describe('التعليق بعد أن أصبحت المهمة متأخرة', () => {
  it('يوقف التراكم عند لحظة التعليق ولا يمحو ما قبله', async () => {
    // Late from Monday, blocked on Thursday morning, measured a week later.
    // Mon–Thu stand and the following week is excused. Forgiving the whole
    // thing is the naive reading this case exists to rule out: the control
    // above answers 9 for the same window.
    const result = await lateness(
      {
        status: 'BLOCKED',
        blockedIntervals: [blocked('2026-03-05T09:00', null)],
      },
      { now: cairo('2026-03-13T12:00') },
    )

    expect(result.lateWorkingDays).toBe(4)
    expect(result.blockedWorkingDays).toBe(5)
  })

  it('التعليق في منتصف يوم عمل لا يعفي ذلك اليوم', async () => {
    // A day counts when its own *start* falls in the window (SPEC §5.3), so a
    // block that begins at 09:00 on Thursday cannot un-count the Thursday that
    // had already begun — the منفّذ had that morning. Excusing it would need
    // the block to have started before midnight.
    const midMorning = await lateness(
      {
        status: 'BLOCKED',
        blockedIntervals: [blocked('2026-03-05T09:00', null)],
      },
      { now: cairo('2026-03-09T12:00') },
    )
    const fromMidnight = await lateness(
      {
        status: 'BLOCKED',
        blockedIntervals: [blocked('2026-03-05T00:00', null)],
      },
      { now: cairo('2026-03-09T12:00') },
    )

    expect(midMorning.lateWorkingDays).toBe(4)
    expect(midMorning.blockedWorkingDays).toBe(2)
    expect(fromMidnight.lateWorkingDays).toBe(3)
    expect(fromMidnight.blockedWorkingDays).toBe(3)
  })
})

describe('الاستئناف بعد التعليق', () => {
  it('يعود التأخير للتراكم بعد رفع التعليق', async () => {
    // Blocked Monday → Thursday, resumed, measured the following Monday.
    // Mon/Tue/Wed excused; Thu, Sun and Mon charged.
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-03-02T00:00', '2026-03-05T00:00')],
      },
      { now: cairo('2026-03-09T12:00') },
    )

    expect(result.lateWorkingDays).toBe(3)
    expect(result.blockedWorkingDays).toBe(3)
  })

  it('الحالة الحالية غير معلَّقة ومع ذلك تُخصم الفترة السابقة', async () => {
    // The whole point of intervals: `status` says IN_PROGRESS, and the block
    // still counts. A "skip while currently blocked" rule answers 5 here.
    const resumed = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-03-02T00:00', '2026-03-05T00:00')],
      },
      { now: cairo('2026-03-06T12:00') },
    )
    const neverBlocked = await lateness({}, { now: cairo('2026-03-06T12:00') })

    expect(resumed.lateWorkingDays).toBe(1)
    expect(neverBlocked.lateWorkingDays).toBe(4)
  })
})

describe('عدة فترات تعليق', () => {
  it('تُخصم كل فترة على حدة', async () => {
    // Blocked Mon–Tue and again Thu–Sun, measured on the second Monday.
    // Working days past the deadline: Mon 2, Tue 3, Wed 4, Thu 5, Sun 8, Mon 9.
    // Excused: Mon 2, Tue 3 (first block) and Thu 5, Sun 8 (second).
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [
          blocked('2026-03-02T00:00', '2026-03-04T00:00'),
          blocked('2026-03-05T00:00', '2026-03-09T00:00'),
        ],
      },
      { now: cairo('2026-03-09T12:00') },
    )

    expect(result.lateWorkingDays).toBe(2)
    expect(result.blockedWorkingDays).toBe(4)
  })

  it('فترتان متداخلتان لا تُخصمان مرتين', async () => {
    // The state machine cannot produce this, a repaired feed can. Subtracting
    // the same day twice would forgive a day the منفّذ was never excused.
    const overlapping = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [
          blocked('2026-03-02T00:00', '2026-03-05T00:00'),
          blocked('2026-03-03T00:00', '2026-03-04T00:00'),
        ],
      },
      { now: cairo('2026-03-09T12:00') },
    )

    expect(overlapping.blockedWorkingDays).toBe(3)
    expect(overlapping.lateWorkingDays).toBe(3)
  })

  it('لا يُنتج تأخيرًا سالبًا مهما كثرت الفترات', async () => {
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [
          blocked('2026-02-01T00:00', '2026-03-20T00:00'),
          blocked('2026-02-10T00:00', '2026-03-25T00:00'),
        ],
      },
      { now: cairo('2026-03-09T12:00') },
    )

    expect(result.lateWorkingDays).toBe(0)
  })
})

describe('التعليق فوق العطلات والإجازات', () => {
  it('عطلة نهاية الأسبوع داخل فترة التعليق لا تُخصم مرتين', async () => {
    // Blocked Thursday → Monday, across the Friday/Saturday weekend. The
    // weekend is worth zero on both sides of the subtraction, so only the
    // Thursday and the Sunday are excused.
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-03-05T00:00', '2026-03-09T00:00')],
      },
      { now: cairo('2026-03-09T12:00') },
    )

    expect(result.blockedWorkingDays).toBe(2)
    expect(result.lateWorkingDays).toBe(4)
  })

  it('عطلة رسمية داخل فترة التعليق لا تُخصم مرتين', async () => {
    const calendar = calendarWith({ holidays: ['2026-03-03'] })
    const spanned = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-03-02T00:00', '2026-03-05T00:00')],
      },
      { calendar, now: cairo('2026-03-09T12:00') },
    )

    // Tuesday is a holiday, so the block excuses only Monday and Wednesday.
    expect(spanned.blockedWorkingDays).toBe(2)
    expect(spanned.lateWorkingDays).toBe(3)
  })

  it('إجازة معتمدة داخل فترة التعليق لا تُخصم مرتين', async () => {
    const calendar = calendarWith({
      leave: [{ userId: WORKER, start: '2026-03-03', end: '2026-03-04' }],
    })
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-03-02T00:00', '2026-03-05T00:00')],
      },
      { calendar, now: cairo('2026-03-09T12:00') },
    )

    // Tue and Wed are already leave; the block adds only the Monday.
    expect(result.blockedWorkingDays).toBe(1)
    expect(result.lateWorkingDays).toBe(3)
  })

  it('تعليق يغطي عطلة نهاية أسبوع فقط لا يغيّر شيئًا', async () => {
    const withBlock = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-03-06T00:00', '2026-03-08T00:00')],
      },
      { now: cairo('2026-03-09T12:00') },
    )
    const withoutBlock = await lateness({}, { now: cairo('2026-03-09T12:00') })

    expect(withBlock.blockedWorkingDays).toBe(0)
    expect(withBlock.lateWorkingDays).toBe(withoutBlock.lateWorkingDays)
  })
})

describe('التسليم أثناء التعليق أو بعده', () => {
  it('التسليم بعد رفع التعليق يجمّد العدّ ويحتفظ بالخصم', async () => {
    const result = await lateness({
      status: 'SUBMITTED',
      submittedAt: cairo('2026-03-09T10:00'),
      blockedIntervals: [blocked('2026-03-02T00:00', '2026-03-05T00:00')],
    })

    expect(result.frozen).toBe(true)
    expect(result.measuredAt).toEqual(cairo('2026-03-09T10:00'))
    expect(result.blockedWorkingDays).toBe(3)
    expect(result.lateWorkingDays).toBe(3)
  })

  it('التسليم أثناء التعليق يجمّد العدّ عند لحظة التسليم', async () => {
    // A منفّذ may deliver while the task is formally blocked — the block was
    // somebody else's problem. The clock stops at the delivery, and the
    // blocked days before it are still excused.
    const result = await lateness(
      {
        status: 'BLOCKED',
        submittedAt: cairo('2026-03-05T10:00'),
        blockedIntervals: [blocked('2026-03-02T00:00', null, 'SUBMITTED')],
      },
      { now: cairo('2026-03-20T12:00') },
    )

    expect(result.frozen).toBe(true)
    expect(result.measuredAt).toEqual(cairo('2026-03-05T10:00'))
    expect(result.lateWorkingDays).toBe(0)
  })

  it('مهمة عُلّقت وهي مسلَّمة تبقى مجمّدة — وقت المراجعة ليس على المنفّذ', async () => {
    // Blocked *out of* SUBMITTED. Reading `status` literally would restart the
    // worker's clock the moment a reviewer blocked the task, which is exactly
    // what "time in review never counts" forbids (SPEC §5.3).
    const result = await lateness(
      {
        status: 'BLOCKED',
        submittedAt: cairo('2026-03-02T10:00'),
        blockedIntervals: [blocked('2026-03-04T09:00', null, 'IN_REVIEW')],
      },
      { now: cairo('2026-04-30T12:00') },
    )

    expect(result.frozen).toBe(true)
    expect(result.measuredAt).toEqual(cairo('2026-03-02T10:00'))
    expect(result.lateWorkingDays).toBe(1)
  })
})

describe('effectiveStatus', () => {
  it('يعيد الحالة نفسها لمهمة غير معلَّقة', () => {
    expect(effectiveStatus(task({ status: 'IN_PROGRESS' }))).toBe('IN_PROGRESS')
  })

  it('يعيد الحالة التي عُلّقت منها المهمة', () => {
    expect(
      effectiveStatus(
        task({
          status: 'BLOCKED',
          blockedIntervals: [blocked('2026-03-04T09:00', null, 'IN_REVIEW')],
        }),
      ),
    ).toBe('IN_REVIEW')
  })

  it('يعود إلى BLOCKED عندما لا يذكر السجل الحالة السابقة', () => {
    expect(
      effectiveStatus(
        task({
          status: 'BLOCKED',
          blockedIntervals: [blocked('2026-03-04T09:00', null, null)],
        }),
      ),
    ).toBe('BLOCKED')
  })

  it('يتجاهل الفترات المغلقة ويقرأ المفتوحة وحدها', () => {
    expect(
      effectiveStatus(
        task({
          status: 'BLOCKED',
          blockedIntervals: [
            blocked('2026-03-02T09:00', '2026-03-03T09:00', 'ASSIGNED'),
            blocked('2026-03-04T09:00', null, 'IN_PROGRESS'),
          ],
        }),
      ),
    ).toBe('IN_PROGRESS')
  })
})

describe('التعليق مع بقية قواعد التأخير', () => {
  it('المهلة تُطبَّق قبل الخصم، لا بعده', async () => {
    // Grace moves where counting starts; the block then excuses from inside
    // that window. Applying them the other way round would excuse a day twice.
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-03-04T00:00', '2026-03-06T00:00')],
      },
      { graceHours: DEFAULT_GRACE, now: cairo('2026-03-09T12:00') },
    )

    // Effective deadline Monday 17:00 → Tue, Wed, Thu, Sun, Mon are countable;
    // Wed and Thu are blocked.
    expect(result.effectiveDueDate).toEqual(cairo('2026-03-02T17:00'))
    expect(result.blockedWorkingDays).toBe(2)
    expect(result.lateWorkingDays).toBe(3)
  })

  it('تعليق يسبق الموعد الفعلي كليًا لا يُخصم منه شيء', async () => {
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-02-20T00:00', '2026-02-25T00:00')],
      },
      { now: cairo('2026-03-04T12:00') },
    )

    expect(result.blockedWorkingDays).toBe(0)
    expect(result.lateWorkingDays).toBe(3)
  })

  it('مهمة ملغاة تبقى صفرًا ولا تُبلّغ عن أيام معلَّقة', async () => {
    const result = await lateness(
      {
        status: 'CANCELLED',
        blockedIntervals: [blocked('2026-03-02T00:00', null)],
      },
      { now: cairo('2026-03-20T12:00') },
    )

    expect(result).toMatchObject({ lateWorkingDays: 0, blockedWorkingDays: 0 })
  })

  it('التمديد والتعليق يعملان معًا', async () => {
    // The deadline moved to Wednesday and the task was blocked Thursday →
    // Sunday. Only the Monday is left to charge.
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        dueDate: cairo('2026-03-04T17:00'),
        originalDueDate: DUE,
        blockedIntervals: [blocked('2026-03-05T00:00', '2026-03-09T00:00')],
      },
      { now: cairo('2026-03-09T12:00') },
    )

    expect(result.extended).toBe(true)
    expect(result.blockedWorkingDays).toBe(2)
    expect(result.lateWorkingDays).toBe(1)
  })

  it('الخصم يتبع منفّذ المهمة لا غيره', async () => {
    // The blocked stretch is measured on the assignee's own calendar, so their
    // approved leave inside it is already zero and cannot be excused twice —
    // while another worker's leave changes nothing.
    const calendar = calendarWith({
      leave: [{ userId: 'someone-else', start: '2026-03-03', end: '2026-03-04' }],
    })
    const result = await lateness(
      {
        status: 'IN_PROGRESS',
        blockedIntervals: [blocked('2026-03-02T00:00', '2026-03-05T00:00')],
      },
      { calendar, now: cairo('2026-03-09T12:00') },
    )

    expect(result.blockedWorkingDays).toBe(3)
  })

  it('ثابت عند تكرار الحساب', async () => {
    const overrides = {
      status: 'BLOCKED' as const,
      blockedIntervals: [blocked('2026-03-03T00:00', null)],
    }
    const now = cairo('2026-03-13T12:00')
    const first = await lateness(overrides, { now })

    for (let run = 0; run < 5; run += 1) {
      expect(await lateness(overrides, { now })).toEqual(first)
    }
  })
})
