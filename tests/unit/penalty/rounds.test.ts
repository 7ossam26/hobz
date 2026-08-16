import { describe, expect, it } from 'vitest'

import {
  currentRoundStart,
  isInCurrentRound,
  revisionCount,
  revisionRoundsFromActivity,
  roundIndexAt,
  type RevisionActivityRow,
} from '@/modules/penalty/rounds'

import { cairo } from '../../helpers/time'

/**
 * SPEC T4 / phase brief item 4, the half that decides which ledger rows the
 * engine may touch:
 *
 *   > Penalty from the original delivery is frozen and stands; the revision
 *   > accrues separately against the new due date. Both are visible and
 *   > separately labelled.
 *
 * ── Why this is read off the activity feed and not off a column ───────────
 *
 * SPEC §2 is explicit that there is "no round counting" as a product feature,
 * and SPEC §4 gives `LedgerEntry` no metadata column — so "which delivery does
 * this penalty belong to" cannot be stamped on the row and must be derived.
 * `TaskActivity` already records every `STATUS_CHANGED` with its `from` and
 * `to`, and SPEC §5.1 and §5.3 have both already made that feed load-bearing
 * (`BLOCKED → previous`, and the blocked intervals lateness subtracts). This is
 * the third reader of the same fact, not a new mechanism.
 *
 * A round boundary is the instant a revision was requested. An entry written at
 * or after the latest boundary belongs to the live round and may be
 * recalculated; everything before it is frozen, for good.
 *
 * **The boundary is inclusive (`>=`) and that is required, not a tie-break.**
 * `transitionTask` writes the `REVISION_REQUESTED` activity row and then calls
 * the penalty recomputation with the *same* `now`. If the new round started
 * strictly after the boundary, that recomputation would still be operating on
 * the previous round and would reverse the penalty SPEC T4 says must stand.
 */

const row = (to: string, at: string): RevisionActivityRow => ({
  type: 'STATUS_CHANGED',
  from: 'IN_REVIEW',
  to,
  createdAt: cairo(at),
})

const FIRST_REVISION = cairo('2026-04-10T11:00')
const SECOND_REVISION = cairo('2026-04-20T11:00')

const FEED: readonly RevisionActivityRow[] = [
  row('SUBMITTED', '2026-04-05T09:00'),
  row('IN_REVIEW', '2026-04-06T09:00'),
  row('REVISION_REQUESTED', '2026-04-10T11:00'),
  row('IN_PROGRESS', '2026-04-11T09:00'),
  row('SUBMITTED', '2026-04-18T09:00'),
  row('REVISION_REQUESTED', '2026-04-20T11:00'),
]

describe('revisionRoundsFromActivity', () => {
  it('مهمة بلا مراجعات: جولة واحدة، بلا حدود', () => {
    const rounds = revisionRoundsFromActivity([
      row('SUBMITTED', '2026-04-05T09:00'),
      row('APPROVED', '2026-04-06T09:00'),
    ])

    expect(revisionCount(rounds)).toBe(0)
    expect(currentRoundStart(rounds)).toBeNull()
  })

  it('يعدّ طلبات المراجعة فقط، لا كل تغييرات الحالة', () => {
    const rounds = revisionRoundsFromActivity(FEED)

    expect(revisionCount(rounds)).toBe(2)
    expect(rounds.boundaries).toEqual([FIRST_REVISION, SECOND_REVISION])
  })

  it('آخر حد هو بداية الجولة الحالية', () => {
    expect(currentRoundStart(revisionRoundsFromActivity(FEED))).toEqual(SECOND_REVISION)
  })

  it('يرتّب الحدود زمنيًا مهما وصل الصف مبعثرًا', () => {
    const rounds = revisionRoundsFromActivity([
      row('REVISION_REQUESTED', '2026-04-20T11:00'),
      row('REVISION_REQUESTED', '2026-04-10T11:00'),
    ])

    expect(rounds.boundaries).toEqual([FIRST_REVISION, SECOND_REVISION])
  })

  it('يتجاهل صفوف الأنشطة الأخرى تمامًا', () => {
    const rounds = revisionRoundsFromActivity([
      {
        type: 'DUE_DATE_CHANGED',
        from: null,
        to: 'REVISION_REQUESTED',
        createdAt: FIRST_REVISION,
      },
      { type: 'COMMENTED', from: null, to: null, createdAt: FIRST_REVISION },
    ])

    expect(revisionCount(rounds)).toBe(0)
  })

  it('صفّ فارغ: جولة أصلية بلا حدود', () => {
    expect(revisionRoundsFromActivity([]).boundaries).toEqual([])
  })
})

describe('roundIndexAt — تسمية كل قيد بجولته', () => {
  const rounds = revisionRoundsFromActivity(FEED)

  it('ما قبل أول مراجعة هو التسليم الأصلي (0)', () => {
    expect(roundIndexAt(cairo('2026-04-07T03:00'), rounds)).toBe(0)
  })

  it('بين المراجعتين هو المراجعة الأولى (1)', () => {
    expect(roundIndexAt(cairo('2026-04-15T03:00'), rounds)).toBe(1)
  })

  it('بعد الثانية هو المراجعة الثانية (2)', () => {
    expect(roundIndexAt(cairo('2026-04-25T03:00'), rounds)).toBe(2)
  })

  it('عند لحظة الحد بالضبط: الجولة الجديدة، لا القديمة', () => {
    expect(roundIndexAt(FIRST_REVISION, rounds)).toBe(1)
    expect(roundIndexAt(SECOND_REVISION, rounds)).toBe(2)
  })
})

describe('isInCurrentRound — أي قيد يجوز إعادة حسابه', () => {
  const rounds = revisionRoundsFromActivity(FEED)

  it('قيد التسليم الأصلي مجمَّد ولا يُمس', () => {
    expect(isInCurrentRound(cairo('2026-04-07T03:00'), rounds)).toBe(false)
  })

  it('قيد المراجعة الأولى مجمَّد أيضًا بعد بدء الثانية', () => {
    expect(isInCurrentRound(cairo('2026-04-15T03:00'), rounds)).toBe(false)
  })

  it('قيد الجولة الحالية قابل لإعادة الحساب', () => {
    expect(isInCurrentRound(cairo('2026-04-25T03:00'), rounds)).toBe(true)
  })

  it('القيد المكتوب في نفس لحظة طلب المراجعة يخصّ الجولة الجديدة', () => {
    expect(isInCurrentRound(SECOND_REVISION, rounds)).toBe(true)
  })

  it('بلا مراجعات: كل قيد يخصّ الجولة الحالية', () => {
    const none = revisionRoundsFromActivity([])

    expect(isInCurrentRound(cairo('2020-01-01T00:00'), none)).toBe(true)
  })
})
