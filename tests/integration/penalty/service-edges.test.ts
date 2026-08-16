import { describe, expect, it } from 'vitest'

import { calendarFor } from '@/lib/calendar'
import { DomainError, NotFoundError } from '@/lib/errors'
import {
  createManualPenalty,
  grantBonus,
  recomputeTaskPenalty,
  reversePenaltyOrBonus,
} from '@/modules/penalty/service'

import {
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import {
  CYCLE_DAY,
  PENALTY_DEFAULTS,
  penaltyRows,
  recompute,
} from '../../helpers/penalty'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * The edges of the money service — the paths a happy-path test never reaches
 * and a production incident always does.
 *
 * Two of them matter more than they look:
 *
 *  - **The client IP reaches the audit row.** CLAUDE.md invariant 7 says audit
 *    everything that touches money, and "who" is not fully answered by a user
 *    id when the question is whether somebody's account was used from somewhere
 *    it should not have been. Every money-moving call takes an optional `ip`
 *    and every one of them must thread it through.
 *  - **A missing row throws rather than returning a quiet nothing.** A
 *    recomputation aimed at a deleted task, or a reversal aimed at an entry
 *    that is not there, is a caller with a stale id — and answering "fine, zero"
 *    would let a scheduler grind against a task that no longer exists forever.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NOW = cairo('2026-03-05T12:00')
const CLIENT_IP = '203.0.113.9'

async function scenario() {
  await seedPermissionCatalog(db)
  const owner = await createUser(db)
  const boss = await createUserWithPermissions(db, [
    'penalty.create',
    'penalty.reverse',
    'bonus.create',
  ])
  const actor = await actorFor(db, boss.id)
  const worker = await createUser(db, { payType: 'PER_TASK' })
  const project = await createProject(db, { ownerId: owner.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'IN_PROGRESS',
    taskValue: '1000.00',
    dueDate: DUE,
    originalDueDate: DUE,
  })
  return { actor, worker, task }
}

const ipOf = async (action: string): Promise<string | null> => {
  const row = await db.auditLog.findFirst({
    where: { action },
    orderBy: { createdAt: 'desc' },
    select: { ip: true },
  })
  return row?.ip ?? null
}

describe('عنوان العميل يصل إلى صفّ التدقيق', () => {
  it('عند تطبيق خصم تلقائي', async () => {
    const { actor, task } = await scenario()

    await recomputeTaskPenalty(db, {
      taskId: task.id,
      calendar: calendarFor(db),
      settings: PENALTY_DEFAULTS,
      cycleDay: CYCLE_DAY,
      cause: 'manual',
      now: NOW,
      actor,
      ip: CLIENT_IP,
    })

    expect(await ipOf('penalty.applied')).toBe(CLIENT_IP)
  })

  it('عند إعادة الحساب — على القيد العكسي والقيد الجديد معًا', async () => {
    const { actor, task } = await scenario()
    await recompute(db, task.id, { now: NOW })

    await recomputeTaskPenalty(db, {
      taskId: task.id,
      calendar: calendarFor(db),
      settings: PENALTY_DEFAULTS,
      cycleDay: CYCLE_DAY,
      cause: 'manual',
      now: cairo('2026-03-08T12:00'),
      actor,
      ip: CLIENT_IP,
    })

    expect(await ipOf('ledger.reversed')).toBe(CLIENT_IP)
    expect(await ipOf('penalty.recalculated')).toBe(CLIENT_IP)
  })

  it('عند الخصم اليدوي والمكافأة والعكس', async () => {
    const { actor, worker } = await scenario()

    const penalty = await createManualPenalty(db, {
      userId: worker.id,
      amount: '90.00',
      reason: 'غياب دون إخطار',
      actor,
      cycleDay: CYCLE_DAY,
      at: NOW,
      ip: CLIENT_IP,
    })
    expect(await ipOf('penalty.created')).toBe(CLIENT_IP)

    await grantBonus(db, {
      userId: worker.id,
      amount: '300.00',
      reason: 'إنجاز مبكر',
      actor,
      cycleDay: CYCLE_DAY,
      at: NOW,
      ip: CLIENT_IP,
    })
    expect(await ipOf('bonus.created')).toBe(CLIENT_IP)

    await reversePenaltyOrBonus(db, {
      entryId: penalty.entryId as string,
      reason: 'سُجّل على الشخص الخطأ',
      actor,
      cycleDay: CYCLE_DAY,
      at: NOW,
      ip: CLIENT_IP,
    })
    expect(await ipOf('penalty.reversed')).toBe(CLIENT_IP)
  })
})

describe('المعرّفات القديمة ترفع خطأً بدل أن تصمت', () => {
  it('إعادة حساب مهمة محذوفة ترفع NotFound', async () => {
    const { actor, task } = await scenario()
    await db.task.update({
      where: { id: task.id },
      data: { deletedAt: cairo('2026-03-02T09:00') },
    })

    await expect(
      recomputeTaskPenalty(db, {
        taskId: task.id,
        calendar: calendarFor(db),
        settings: PENALTY_DEFAULTS,
        cycleDay: CYCLE_DAY,
        cause: 'scheduled',
        now: NOW,
        actor,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('إعادة حساب مهمة غير موجودة ترفع NotFound', async () => {
    await expect(
      recomputeTaskPenalty(db, {
        taskId: 'no-such-task',
        calendar: calendarFor(db),
        settings: PENALTY_DEFAULTS,
        cycleDay: CYCLE_DAY,
        cause: 'scheduled',
        now: NOW,
        actor: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('عكس قيد غير موجود يرفع NotFound', async () => {
    const { actor } = await scenario()

    await expect(
      reversePenaltyOrBonus(db, {
        entryId: 'no-such-entry',
        reason: 'محاولة على معرّف قديم',
        actor,
        cycleDay: CYCLE_DAY,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('السبب إلزامي قبل أي كتابة', () => {
  it('خصم يدوي بسبب فارغ يفشل ولا يكتب شيئًا', async () => {
    const { actor, worker } = await scenario()

    await expect(
      createManualPenalty(db, {
        userId: worker.id,
        amount: '90.00',
        reason: '   ',
        actor,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('مكافأة بسبب فارغ تفشل ولا تكتب شيئًا', async () => {
    const { actor, worker } = await scenario()

    await expect(
      grantBonus(db, {
        userId: worker.id,
        amount: '300.00',
        reason: '\n\t ',
        actor,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('سبب العكس الفارغ يفشل قبل قراءة القيد', async () => {
    const { actor } = await scenario()

    // A `NotFoundError` here would mean the reason check runs second; it does
    // not, so a caller with both problems is told about the one they can fix.
    await expect(
      reversePenaltyOrBonus(db, {
        entryId: 'no-such-entry',
        reason: '  ',
        actor,
        cycleDay: CYCLE_DAY,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('لحظة الكتابة الافتراضية هي الآن', () => {
  it('خصم يدوي بلا `at` يُختم بوقت التنفيذ', async () => {
    const { actor, worker } = await scenario()
    const before = new Date()

    const outcome = await createManualPenalty(db, {
      userId: worker.id,
      amount: '45.00',
      reason: 'غياب',
      actor,
      cycleDay: CYCLE_DAY,
    })

    const row = await db.ledgerEntry.findUnique({
      where: { id: outcome.entryId as string },
      select: { createdAt: true },
    })
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  it('مكافأة بلا `at` تُختم بوقت التنفيذ', async () => {
    const { actor, worker } = await scenario()
    const before = new Date()

    const bonus = await grantBonus(db, {
      userId: worker.id,
      amount: '120.00',
      reason: 'إنجاز',
      actor,
      cycleDay: CYCLE_DAY,
    })

    const row = await db.ledgerEntry.findUnique({
      where: { id: bonus.entryId },
      select: { createdAt: true },
    })
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })
})

describe('أكثر من قيد فعّال — الخدمة تُصلح الثابتة بدل أن تفترضها', () => {
  it('تعكس كل القيود الزائدة وتترك واحدًا صحيحًا', async () => {
    const { task, worker } = await scenario()
    await recompute(db, task.id, { now: NOW })

    // A second active entry cannot arise through the service — the per-task
    // lock and the round filter see to that — but a historical bug or a
    // hand-run statement could leave one. `findActiveAutoPenalties` uses
    // `findMany` precisely so the next run makes the invariant true again,
    // rather than picking one and leaving a second deduction on somebody's
    // statement forever.
    const cycle = await db.payoutCycle.findFirst({ where: { status: 'OPEN' } })
    await db.ledgerEntry.create({
      data: {
        userId: worker.id,
        taskId: task.id,
        type: 'PENALTY',
        amount: '-999.00',
        note: 'قيد يتيم من عطب قديم',
        isAutoGenerated: true,
        cycleId: cycle?.id ?? null,
        createdAt: NOW,
      },
    })

    const outcome = await recompute(db, task.id, { now: cairo('2026-03-08T12:00') })

    expect(outcome.outcome).toBe('recalculated')
    const rows = await penaltyRows(db, task.id)
    expect(rows.filter((r) => !r.reversed)).toHaveLength(1)
    expect(rows.filter((r) => !r.reversed)[0]?.amount).toBe('-200.00')
  })
})
