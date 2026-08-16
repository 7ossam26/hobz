import { describe, expect, it } from 'vitest'

import { decideExtension } from '@/modules/extension/service'
import { balanceFor } from '@/modules/ledger/service'
import { createPenaltyPort } from '@/modules/penalty/port'

import {
  createExtensionRequest,
  createProject,
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
 * Phase brief: "If lateness drops to zero (extension approved), the existing
 * penalty is reversed to zero." And SPEC §5.3: an approved extension "moves
 * `dueDate`, keeps `originalDueDate`, and voids/recomputes any penalty accrued
 * past the new date."
 *
 * ── Why this runs through `decideExtension` and not just the engine ───────
 *
 * Phase 6 built `PenaltyPort` as a **command** — "this deduction is now wrong,
 * and that instruction has to arrive" — pointed it at `noopPenaltyPort`, and
 * wrote an `extension.penaltyRecomputeRequested` audit row before every call so
 * that nothing was lost while the port was dark. The value of that promise is
 * exactly whether the real port drops into the same call site unchanged. So the
 * tests below approve a real extension and assert on the ledger, rather than
 * calling the engine directly and hoping the wire is connected.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NOW = cairo('2026-03-05T12:00')

async function scenario() {
  await seedPermissionCatalog(db)
  const owner = await createUser(db)
  const worker = await createUser(db, { payType: 'PER_TASK' })
  const manager = await createUserWithPermissions(db, ['task.extend'])
  const project = await createProject(db, { ownerId: owner.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'IN_PROGRESS',
    taskValue: '1000.00',
    dueDate: DUE,
    originalDueDate: DUE,
  })
  return { worker, task, actor: await actorFor(db, manager.id) }
}

const penaltyPort = createPenaltyPort({
  settings: { ...PENALTY_DEFAULTS, cycleDay: CYCLE_DAY },
})

async function approveExtensionTo(
  taskId: string,
  actor: Awaited<ReturnType<typeof actorFor>>,
  newDueDate: Date,
  at: Date,
) {
  const request = await createExtensionRequest(db, {
    taskId,
    requestedById: actor.id,
    oldDueDate: DUE,
    newDueDate,
  })
  return decideExtension(db, {
    actor,
    input: { id: request.id, decision: 'APPROVED', decisionNote: null },
    penalty: penaltyPort,
    now: at,
  })
}

describe('اعتماد تمديد بعد تراكم الخصم', () => {
  it('يعكس الخصم إلى صفر بالضبط', async () => {
    const { worker, task, actor } = await scenario()
    await recompute(db, task.id, { now: NOW })
    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')

    await approveExtensionTo(task.id, actor, cairo('2026-03-20T17:00'), NOW)

    // Exactly zero — not "close to zero", and not a smaller penalty.
    expect(await netPenaltyFor(db, task.id)).toBe('0.00')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
    expect(await activePenalties(db, task.id)).toHaveLength(0)
  })

  it('يعكس ولا يحذف: القيد الأصلي باقٍ ومعه قيد عكسي مفسَّر', async () => {
    const { task, actor } = await scenario()
    await recompute(db, task.id, { now: NOW })
    const [original] = await penaltyRows(db, task.id)

    await approveExtensionTo(task.id, actor, cairo('2026-03-20T17:00'), NOW)

    const rows = await penaltyRows(db, task.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(original?.id)
    expect(rows[0]?.amount).toBe('-150.00')
    expect(rows[0]?.reversed).toBe(true)

    const [reversal] = await reversalRows(db, task.id)
    expect(reversal?.amount).toBe('150.00')
    // The منفّذ reads *why* the money came back, not an unexplained credit.
    expect(reversal?.note).toContain('اعتماد تمديد نقل موعد التسليم')
  })

  it('تمديد جزئي يُنقص الخصم بدل إلغائه', async () => {
    const { task, actor } = await scenario()
    await recompute(db, task.id, { now: NOW })

    // The deadline moves to Tuesday 17:00: grace runs to Wednesday, leaving
    // Thursday alone. Three days become one.
    await approveExtensionTo(task.id, actor, cairo('2026-03-03T17:00'), NOW)

    expect(await netPenaltyFor(db, task.id)).toBe('-50.00')
    const active = await activePenalties(db, task.id)
    expect(active).toHaveLength(1)
    expect(active[0]?.amount).toBe('-50.00')
  })

  it('التمديد قبل تجاوز الموعد يعني ألّا يتراكم خصم إطلاقًا', async () => {
    const { task, actor } = await scenario()

    await approveExtensionTo(
      task.id,
      actor,
      cairo('2026-03-20T17:00'),
      cairo('2026-03-01T09:00'),
    )
    await recomputeTimes(db, task.id, 3, { now: NOW })

    expect(await penaltyRows(db, task.id)).toHaveLength(0)
    expect(await reversalRows(db, task.id)).toHaveLength(0)
  })

  it('التمديد المرفوض لا يمسّ الخصم', async () => {
    const { task, actor } = await scenario()
    await recompute(db, task.id, { now: NOW })

    const request = await createExtensionRequest(db, {
      taskId: task.id,
      requestedById: actor.id,
      oldDueDate: DUE,
      newDueDate: cairo('2026-03-20T17:00'),
    })
    await decideExtension(db, {
      actor,
      input: { id: request.id, decision: 'REJECTED', decisionNote: null },
      penalty: penaltyPort,
      now: NOW,
    })

    expect(await netPenaltyFor(db, task.id)).toBe('-150.00')
    expect(await reversalRows(db, task.id)).toHaveLength(0)
  })

  it('الموعد الأصلي يبقى مسجَّلًا في التفصيل بعد التمديد', async () => {
    const { task, actor } = await scenario()
    await recompute(db, task.id, { now: NOW })
    await approveExtensionTo(task.id, actor, cairo('2026-03-03T17:00'), NOW)

    const outcome = await recompute(db, task.id, { now: NOW })

    expect(outcome.breakdown?.originalDueDate).toEqual(DUE)
    expect(outcome.breakdown?.dueDate).toEqual(cairo('2026-03-03T17:00'))
  })

  it('تشغيل الوظيفة بعد التمديد لا يعيد الخصم', async () => {
    const { task, actor } = await scenario()
    await recompute(db, task.id, { now: NOW })
    await approveExtensionTo(task.id, actor, cairo('2026-03-20T17:00'), NOW)

    await recomputeTimes(db, task.id, 5, { now: cairo('2026-03-06T03:00') })

    expect(await netPenaltyFor(db, task.id)).toBe('0.00')
    expect(await penaltyRows(db, task.id)).toHaveLength(1)
  })
})
