import { describe, expect, it } from 'vitest'

import { balanceFor } from '@/modules/ledger/service'
import { createPenaltyPort } from '@/modules/penalty/port'
import { requestRevision } from '@/modules/task/service'

import {
  createProject,
  createStatusActivity,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import {
  activePenalties,
  CYCLE_DAY,
  netPenaltyFor,
  penaltyRows,
  PENALTY_DEFAULTS,
  recompute,
  recomputeTimes,
  reversalRows,
} from '../../helpers/penalty'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * SPEC T4 and phase brief item 4:
 *
 *   > Penalty from the original delivery is frozen and stands; the revision
 *   > accrues separately against the new due date. Both are visible and
 *   > separately labelled.
 *
 * ── The two sentences that look like they disagree ────────────────────────
 *
 * SPEC §5.4 also says "exactly one **active** auto `PENALTY` entry per task".
 * Read as "one unreversed penalty", that contradicts the paragraph above. Read
 * as what it says — one entry *still subject to recalculation* — the two agree:
 * the moment a revision is requested the previous delivery's figure can never
 * change again, so it stops being active. See `modules/penalty/rounds.ts`.
 *
 * ── The worked scenario ───────────────────────────────────────────────────
 *
 *   original due    Sun 2026-03-01 17:00 → delivered Thu 03-05 10:00
 *                   grace to Mon 17:00; Tue, Wed, Thu → 3 days → 150.00
 *   revision at     Fri 2026-03-06 10:00, new deadline Sun 2026-03-15 17:00
 *   redelivered     Thu 2026-03-19 10:00
 *                   grace to Mon 03-16 17:00; Tue, Wed, Thu → 3 days → 150.00
 *
 * Flag ON  → two entries, 300.00 total.
 * Flag OFF → one entry, 150.00 total, and the original still stands.
 */

const db = testDb()

const ORIGINAL_DUE = cairo('2026-03-01T17:00')
const FIRST_DELIVERY = cairo('2026-03-05T10:00')
const REVISION_AT = cairo('2026-03-06T10:00')
const NEW_DUE = cairo('2026-03-15T17:00')
const SECOND_DELIVERY = cairo('2026-03-19T10:00')

async function deliveredLate() {
  await seedPermissionCatalog(db)
  const owner = await createUser(db)
  const worker = await createUser(db, { payType: 'PER_TASK' })
  const project = await createProject(db, { ownerId: owner.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'SUBMITTED',
    taskValue: '1000.00',
    dueDate: ORIGINAL_DUE,
    originalDueDate: ORIGINAL_DUE,
    submittedAt: FIRST_DELIVERY,
  })
  return { owner, worker, project, task }
}

/** Move the task into its second round, the way `transitionTask` would. */
async function reviseTo(taskId: string, newDue: Date, at: Date) {
  await createStatusActivity(db, {
    taskId,
    from: 'IN_REVIEW',
    to: 'REVISION_REQUESTED',
    at,
  })
  await db.task.update({
    where: { id: taskId },
    data: { status: 'REVISION_REQUESTED', dueDate: newDue },
  })
}

describe('تأخير المراجعة — الخاصية مفعّلة (الافتراضي)', () => {
  it('خصم التسليم الأصلي يتجمّد ويبقى، والمراجعة تُحتسب على حدة', async () => {
    const { worker, task } = await deliveredLate()
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')

    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    // The revision's own clock starts at zero — nothing is owed yet.
    const atRevision = await recompute(db, task.id, { now: REVISION_AT })
    expect(atRevision.outcome).toBe('none')
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')

    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: SECOND_DELIVERY },
    })
    const second = await recompute(db, task.id, { now: cairo('2026-03-20T03:00') })

    expect(second.outcome).toBe('applied')
    expect(second.amount).toBe('150.00')
    expect(await netPenaltyFor(db, task.id)).toBe('-300.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('-300.00')

    // Two entries stand, and no reversal was written: the first was never
    // recalculated, it was sealed.
    const rows = await penaltyRows(db, task.id)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => !r.reversed)).toBe(true)
    expect(await reversalRows(db, task.id)).toHaveLength(0)
  })

  it('القيدان مسمّيان: التسليم الأصلي والمراجعة رقم 1', async () => {
    const { task } = await deliveredLate()
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })
    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: SECOND_DELIVERY },
    })
    const second = await recompute(db, task.id, { now: cairo('2026-03-20T03:00') })

    const [first, revision] = await penaltyRows(db, task.id)
    expect(first?.note).toContain('خصم تأخير مهمة')
    expect(revision?.note).toContain('المراجعة رقم 1')
    expect(second.breakdown?.roundIndex).toBe(1)
  })

  /**
   * The rule that makes the whole design safe: a recalculation in round 1 must
   * never reach back and reverse round 0's entry. If it did, an ordinary extra
   * day of lateness on a revision would silently refund the original delivery.
   */
  it('إعادة حساب المراجعة لا تمسّ خصم التسليم الأصلي', async () => {
    const { task } = await deliveredLate()
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })
    const [original] = await penaltyRows(db, task.id)

    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await recompute(db, task.id, { now: cairo('2026-03-18T03:00') })
    await recompute(db, task.id, { now: cairo('2026-03-19T03:00') })
    await recompute(db, task.id, { now: cairo('2026-03-22T03:00') })

    const rows = await penaltyRows(db, task.id)
    const stillOriginal = rows.find((r) => r.id === original?.id)
    expect(stillOriginal?.reversed).toBe(false)
    expect(stillOriginal?.amount).toBe('-150.00')
    // Exactly one live entry — the revision's — beside the sealed one.
    expect(await activePenalties(db, task.id)).toHaveLength(2)
  })

  it('مراجعة ثانية تجمّد الأولى بدورها', async () => {
    const { task } = await deliveredLate()
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })

    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: SECOND_DELIVERY },
    })
    await recompute(db, task.id, { now: cairo('2026-03-20T03:00') })

    await reviseTo(task.id, cairo('2026-03-29T17:00'), cairo('2026-03-21T10:00'))
    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: cairo('2026-04-02T10:00') },
    })
    const third = await recompute(db, task.id, { now: cairo('2026-04-03T03:00') })

    expect(third.breakdown?.roundIndex).toBe(2)
    expect(await penaltyRows(db, task.id)).toHaveLength(3)
    expect(await reversalRows(db, task.id)).toHaveLength(0)
    expect(await netPenaltyFor(db, task.id)).toBe('-450.00')
  })

  it('عبر مسار الحالة الحقيقي: طلب المراجعة يعيد الحساب فورًا', async () => {
    const { task, worker } = await deliveredLate()
    const manager = await createUserWithPermissions(db, ['task.approve'])
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })
    await db.task.update({ where: { id: task.id }, data: { status: 'IN_REVIEW' } })

    await requestRevision(db, {
      actor: await actorFor(db, manager.id),
      input: {
        taskId: task.id,
        reason: 'المطلوب تعديل الألوان',
        newDueDate: NEW_DUE,
      },
      penalty: createPenaltyPort({
        settings: { ...PENALTY_DEFAULTS, cycleDay: CYCLE_DAY },
      }),
      now: REVISION_AT,
    })

    // The original stands, untouched, and the new round starts clean.
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')
    expect(await reversalRows(db, task.id)).toHaveLength(0)
    expect(await balanceFor(db, { userId: worker.id })).toBe('-150.00')
  })
})

describe('تأخير المراجعة — الخاصية موقوفة', () => {
  const OFF = { penalizeRevisionLateness: false }

  it('لا يُحتسب خصم على المراجعة، وخصم التسليم الأصلي يبقى', async () => {
    const { task } = await deliveredLate()
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00'), settings: OFF })

    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: SECOND_DELIVERY },
    })
    const second = await recompute(db, task.id, {
      now: cairo('2026-03-20T03:00'),
      settings: OFF,
    })

    expect(second.outcome).toBe('none')
    expect(await penaltyRows(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')
  })

  it('الإيقاف لا يُلغي بأثر رجعي ما تراكم قبله', async () => {
    const { task } = await deliveredLate()
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })
    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: SECOND_DELIVERY },
    })
    await recompute(db, task.id, { now: cairo('2026-03-20T03:00') })
    expect(await netPenaltyFor(db, task.id)).toBe('-300.00')

    // Switching the flag off now clears the *live* round, because that is the
    // one the engine still owns. The sealed original is not revisited — it was
    // correct under the rules in force when it was computed.
    const after = await recompute(db, task.id, {
      now: cairo('2026-03-21T03:00'),
      settings: OFF,
    })

    expect(after.outcome).toBe('cleared')
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')
  })

  it('تجاوز المشروع يشغّلها رغم إيقافها عامًا', async () => {
    const { task, project } = await deliveredLate()
    await db.project.update({
      where: { id: project.id },
      data: { penalizeRevisionLateness: true },
    })
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00'), settings: OFF })

    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: SECOND_DELIVERY },
    })
    const second = await recompute(db, task.id, {
      now: cairo('2026-03-20T03:00'),
      settings: OFF,
    })

    expect(second.outcome).toBe('applied')
    expect(await netPenaltyFor(db, task.id)).toBe('-300.00')
  })

  it('تجاوز المشروع يوقفها رغم تشغيلها عامًا', async () => {
    const { task, project } = await deliveredLate()
    await db.project.update({
      where: { id: project.id },
      data: { penalizeRevisionLateness: false },
    })
    await recompute(db, task.id, { now: cairo('2026-03-06T03:00') })

    await reviseTo(task.id, NEW_DUE, REVISION_AT)
    await db.task.update({
      where: { id: task.id },
      data: { status: 'SUBMITTED', submittedAt: SECOND_DELIVERY },
    })
    await recomputeTimes(db, task.id, 3, { now: cairo('2026-03-20T03:00') })

    expect(await penaltyRows(db, task.id)).toHaveLength(1)
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')
  })
})
