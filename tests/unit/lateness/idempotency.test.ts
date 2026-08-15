import { describe, expect, it } from 'vitest'

import { createCalendar, startOfCairoDay } from '@/lib/calendar'
import { SETTINGS_CATALOG } from '@/lib/settings'
import {
  escalationLevelFor,
  nextEscalationLevel,
  type EscalationLevel,
  type EscalationThresholds,
} from '@/modules/lateness/escalation'
import {
  computeLateness,
  measurementEnd,
  type LatenessInput,
  type LatenessTaskInput,
} from '@/modules/lateness/service'
import { computeElapsed } from '@/modules/task/elapsed'

import {
  inMemoryCalendarSource,
  stubCalendar,
  type InMemoryCalendarOptions,
} from '../../helpers/calendar'
import { cairo } from '../../helpers/time'

/**
 * docs/TESTING.md §4 axis 5 — idempotency, over Phase 6's pure layer.
 *
 * The axis is written around the nightly job ("run it 1×, 3×, 10× → identical
 * ledger"), and that half is pinned against a real database in
 * `tests/integration/calendar/job.test.ts`. This file pins the half underneath
 * it: the pure functions the job repeats. A job can only be idempotent if the
 * arithmetic it re-runs is, and a drift down here would stay invisible at the
 * ledger level right up until the night it produced a second deduction.
 *
 * So every case below repeats something — the same call, the same composition,
 * the same span through a warmed window — and demands back the answer it got
 * the first time. Where a case could pass by returning zero forever, it also
 * asserts the number is one somebody would actually be deducted for.
 *
 * Fixture week is March 2026: 1 March is a Sunday, so 1–5 are working days and
 * 6–7 (Friday, Saturday) are the default weekend. Wednesday the 4th is a public
 * holiday and Monday the 2nd is approved leave for the assignee, so the
 * calendar has something to be inconsistent *about*.
 */

const WORKER = 'worker-1'

const DEFAULT_GRACE = SETTINGS_CATALOG['penalty.defaultGraceHours'].default

const THRESHOLDS: EscalationThresholds = {
  pmAfterDays: SETTINGS_CATALOG['notifications.escalateToPmAfterDays'].default,
  adminAfterDays: SETTINGS_CATALOG['notifications.escalateToAdminAfterDays'].default,
}

/**
 * A threshold of 0 is a legitimate Settings value — "escalate as soon as it
 * slips" — and `escalationLevelFor` still demands one real day of lateness on
 * top of it. Deriving the day counts through `max` keeps the oscillation case
 * below meaning what it says if either default is ever lowered to zero.
 */
const PM_DAYS = Math.max(1, THRESHOLDS.pmAfterDays)
const ADMIN_DAYS = Math.max(PM_DAYS, THRESHOLDS.adminAfterDays)

const LADDER: readonly EscalationLevel[] = ['NONE', 'PM', 'ADMIN']

const CALENDAR_OPTIONS: InMemoryCalendarOptions = {
  holidays: ['2026-03-04'],
  leave: [{ userId: WORKER, start: '2026-03-02', end: '2026-03-02' }],
}

const calendar = () => createCalendar(inMemoryCalendarSource(CALENDAR_OPTIONS))

function latenessInput(overrides: Partial<LatenessTaskInput>, now: Date): LatenessInput {
  const dueDate = overrides.dueDate ?? cairo('2026-03-01T17:00')
  return {
    task: {
      id: 'task-1',
      status: 'IN_PROGRESS',
      assigneeId: WORKER,
      dueDate,
      originalDueDate: overrides.originalDueDate ?? dueDate,
      submittedAt: null,
      blockedIntervals: [],
      ...overrides,
    },
    graceHours: DEFAULT_GRACE,
    now,
  }
}

describe('computeLateness — التكرار لا يغيّر النتيجة', () => {
  it('عشر عمليات حساب متتالية بنفس المدخلات تعطي نتيجة متطابقة', async () => {
    const shared = calendar()
    const input = latenessInput({}, cairo('2026-03-10T12:00'))

    const first = await computeLateness(shared, input)
    for (let run = 0; run < 10; run += 1) {
      expect(await computeLateness(shared, input)).toEqual(first)
    }

    // Not a repeated zero: the figure being held steady is one the penalty
    // engine would multiply into money.
    expect(first.lateWorkingDays).toBeGreaterThan(0)
  })

  it('الحساب لا يمسّ كائن المدخلات', async () => {
    const input = latenessInput(
      { status: 'SUBMITTED', submittedAt: cairo('2026-03-05T10:00') },
      cairo('2026-03-09T12:00'),
    )
    const before = structuredClone(input)

    await computeLateness(calendar(), input)
    await computeLateness(calendar(), input)

    // Handing the caller's own `submittedAt` back as `measuredAt` is fine.
    // *Rewriting* it would make the second run read the first run's leftovers,
    // and the job re-reads the same rows every night.
    expect(input).toEqual(before)
  })

  it('لا تنجرف نتيجة مهمة مسلَّمة مهما تقدّمت الساعة بعدها', async () => {
    const shared = calendar()
    const delivered: Partial<LatenessTaskInput> = {
      status: 'SUBMITTED',
      submittedAt: cairo('2026-03-05T10:00'),
    }

    const atSubmission = await computeLateness(
      shared,
      latenessInput(delivered, cairo('2026-03-05T10:01')),
    )

    // A day, a month and a year of review later. SPEC §5.3: time sitting in
    // review never counts against the worker, so tonight's run and next
    // March's run must agree to the field.
    for (const now of [
      cairo('2026-03-06T10:01'),
      cairo('2026-04-05T10:01'),
      cairo('2027-03-05T10:01'),
    ]) {
      expect(await computeLateness(shared, latenessInput(delivered, now))).toEqual(
        atSubmission,
      )
    }

    expect(atSubmission.frozen).toBe(true)
    expect(atSubmission.lateWorkingDays).toBeGreaterThan(0)
  })

  it('measurementEnd لا يحتفظ بذاكرة عن المهمة — كل لحظة تُقاس بذاتها', () => {
    const { task } = latenessInput({}, cairo('2026-03-03T09:00'))
    const early = cairo('2026-03-03T09:00')
    const later = cairo('2026-03-09T09:00')

    expect(measurementEnd(task, early)).toEqual(early)
    expect(measurementEnd(task, later)).toEqual(later)
    // Asked again after the later reading: anything memoised on the task id
    // would hand back the later instant and manufacture days of lateness for
    // a manual recalculation that runs after the nightly one.
    expect(measurementEnd(task, early)).toEqual(early)
  })
})

describe('nextEscalationLevel — نقطة ثبات السلّم', () => {
  it('تطبيق واحد يبلغ نقطة الثبات لكل تركيبة من المستوى الحالي والمحسوب', () => {
    // The job emits a notification exactly when the level *changes*, so the
    // whole "ten runs, one notification" guarantee rests on the second
    // application of the same computed level being a no-op. All nine pairs.
    for (const current of LADDER) {
      for (const computed of LADDER) {
        const once = nextEscalationLevel(current, computed)

        let settled = once
        for (let run = 0; run < 10; run += 1) {
          settled = nextEscalationLevel(settled, computed)
        }

        expect({ current, computed, settled }).toEqual({
          current,
          computed,
          settled: once,
        })
      }
    }
  })

  it('يستقر عند الإدارة بعد بلوغها ولا يعود إلى مدير المشروع', () => {
    let level = nextEscalationLevel('PM', 'ADMIN')
    for (let run = 0; run < 10; run += 1) level = nextEscalationLevel(level, 'PM')

    expect(level).toBe('ADMIN')
  })

  it('العودة إلى لا شيء تبقى لا شيء مهما تكرّرت الإعادة', () => {
    // An approved extension drops the count to zero. The flag drops with it —
    // once — and nine further nightly runs must not resurrect it.
    let level = nextEscalationLevel('ADMIN', 'NONE')
    for (let run = 0; run < 10; run += 1) level = nextEscalationLevel(level, 'NONE')

    expect(level).toBe('NONE')
  })

  it('تذبذب العدّ بين الحدّين يستقر عند الإدارة ولا يتراجع خطوة واحدة', () => {
    // A recount that lands one day lower — a holiday added to Settings after
    // the fact — must not un-notify anybody. Four sweeps of an oscillating
    // count is what a fortnight of nightly runs looks like on a task whose
    // working-day figure keeps moving under it.
    const oscillating = [PM_DAYS, ADMIN_DAYS, PM_DAYS, ADMIN_DAYS, PM_DAYS]
    const seen: EscalationLevel[] = []
    let level: EscalationLevel = 'NONE'

    for (let sweep = 0; sweep < 4; sweep += 1) {
      for (const days of oscillating) {
        level = nextEscalationLevel(level, escalationLevelFor(days, THRESHOLDS))
        seen.push(level)
      }
    }

    const ranks = seen.map((step) => LADDER.indexOf(step))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(level).toBe('ADMIN')
  })
})

describe('escalationLevelFor — دالة خالصة في وسيطيها', () => {
  it('نفس المدخلات تعطي نفس المستوى مهما تكرّر الاستدعاء أو اختلف ترتيبه', () => {
    const days = [-1, 0, 1, PM_DAYS, ADMIN_DAYS, ADMIN_DAYS + 30]
    const otherThresholds: EscalationThresholds = { pmAfterDays: 1, adminAfterDays: 1 }

    const forward = days.map((count) => escalationLevelFor(count, THRESHOLDS))

    // Same values, walked backwards, with a *different* thresholds object
    // evaluated between every pair: anything memoised on less than both
    // arguments would answer this sweep out of the previous one's state.
    const reversed = [...days]
      .reverse()
      .map((count) => {
        escalationLevelFor(count, otherThresholds)
        return escalationLevelFor(count, THRESHOLDS)
      })
      .reverse()

    const again = days.map((count) => escalationLevelFor(count, THRESHOLDS))

    expect(reversed).toEqual(forward)
    expect(again).toEqual(forward)
    // Non-vacuous: the sweep really does span the whole ladder.
    expect(new Set(forward)).toEqual(new Set<EscalationLevel>(['NONE', 'PM', 'ADMIN']))
  })
})

describe('computeElapsed — التكرار على نفس المدى', () => {
  const span = {
    assignedAt: cairo('2026-03-01T09:00'),
    submittedAt: cairo('2026-03-05T14:00'),
    assigneeId: WORKER,
  }

  it('عشر عمليات حساب على نفس المدى تعطي نفس الزمنين ولا تمسّ المدخلات', async () => {
    const shared = calendar()
    const before = structuredClone(span)

    const first = await computeElapsed(shared, span)
    for (let run = 0; run < 10; run += 1) {
      expect(await computeElapsed(shared, span)).toEqual(first)
    }

    expect(first.working).toBeGreaterThan(0)
    expect(span).toEqual(before)
  })

  it('تقويم تكبر إجابته في كل استدعاء يُقصّ عند الزمن الخام في كل مرة', async () => {
    // `recomputeElapsed` overwrites a denormalised column, so an answer that
    // grew on each pass would rewrite it on each pass and quietly inflate the
    // estimate-accuracy score (SPEC §5.6). An unstable reading is precisely
    // the case where "clamped" and "trusted" diverge on the second run, so the
    // drift is modelled rather than assumed away.
    let reported = 0
    const drifting = stubCalendar({
      workingMinutesBetween: async () => {
        reported += 10_000
        return reported
      },
    })

    const first = await computeElapsed(drifting, span)
    for (let run = 0; run < 3; run += 1) {
      const again = await computeElapsed(drifting, span)
      expect(again).toEqual(first)
      expect(again.working).toBe(again.raw)
    }

    expect(reported).toBeGreaterThan(first.raw)
  })
})

describe('createCalendar — النافذة المخزَّنة لا تغيّر إجابة', () => {
  const from = cairo('2026-03-01T09:00')
  const to = cairo('2026-03-05T09:00')
  const wideFrom = cairo('2026-01-01T00:00')
  const wideTo = cairo('2026-06-01T00:00')

  it('مدى ثم مدى أوسع ثم المدى الأول — يعود عدد أيام العمل الأول كما هو', async () => {
    const shared = calendar()

    const first = await shared.workingDaysBetween(from, to, WORKER)
    const repeated = await shared.workingDaysBetween(from, to, WORKER)
    await shared.workingDaysBetween(wideFrom, wideTo, WORKER)
    const afterWide = await shared.workingDaysBetween(from, to, WORKER)

    expect(repeated).toBe(first)
    expect(afterWide).toBe(first)
    expect(first).toBeGreaterThan(0)
  })

  it('نفس التسلسل على دقائق العمل يعيد العدد الأول كما هو', async () => {
    const shared = calendar()

    const first = await shared.workingMinutesBetween(from, to, WORKER)
    const repeated = await shared.workingMinutesBetween(from, to, WORKER)
    await shared.workingMinutesBetween(wideFrom, wideTo, WORKER)
    const afterWide = await shared.workingMinutesBetween(from, to, WORKER)

    expect(repeated).toBe(first)
    expect(afterWide).toBe(first)
    expect(first).toBeGreaterThan(0)
  })

  it('تناوب المنفّذين على نفس اليوم لا يخلط إجازة أحدهما بالآخر', async () => {
    const shared = calendar()
    const onLeave = cairo('2026-03-02T12:00') // Monday — approved leave for WORKER

    expect(await shared.isWorkingDay(onLeave, WORKER)).toBe(false)
    expect(await shared.isWorkingDay(onLeave, 'someone-else')).toBe(true)
    // The second worker's window must not have been left behind for the first.
    expect(await shared.isWorkingDay(onLeave, WORKER)).toBe(false)
  })

  it('نافذة واحدة تخدم المدى كله وتوفّر الاستعلامات دون أن تغيّر الإجابة', async () => {
    // The window cache exists to turn a span into a handful of queries instead
    // of one per day. The counters prove it is doing that; the sum proves the
    // saving is free — five one-day windows and one five-day window must
    // answer the same, or the cache is buying speed with correctness.
    const chunks: ReadonlyArray<readonly [string, string]> = [
      ['2026-03-01', '2026-03-02'],
      ['2026-03-02', '2026-03-03'],
      ['2026-03-03', '2026-03-04'],
      ['2026-03-04', '2026-03-05'],
      ['2026-03-05', '2026-03-06'],
    ]

    const wideSource = inMemoryCalendarSource(CALENDAR_OPTIONS)
    const whole = await createCalendar(wideSource).workingMinutesBetween(
      startOfCairoDay('2026-03-01'),
      startOfCairoDay('2026-03-06'),
      WORKER,
    )

    const narrowSource = inMemoryCalendarSource(CALENDAR_OPTIONS)
    const perDay = createCalendar(narrowSource)
    let chunked = 0
    for (const [start, end] of chunks) {
      chunked += await perDay.workingMinutesBetween(
        startOfCairoDay(start),
        startOfCairoDay(end),
        WORKER,
      )
    }

    expect(whole).toBeGreaterThan(0)
    expect(chunked).toBe(whole)
    expect(wideSource.holidayCalls).toBe(1)
    expect(wideSource.leaveCalls).toBe(1)
    expect(narrowSource.holidayCalls).toBe(chunks.length)
    expect(narrowSource.leaveCalls).toBe(chunks.length)
  })
})
