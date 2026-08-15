import { describe, expect, it } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import {
  createLedgerTaskEvents,
  ledgerTaskEvents,
  reverseTaskEarning,
} from '@/modules/ledger/earnings'
import { createLedgerPort } from '@/modules/ledger/port'
import {
  appendEntry,
  cycleTotalsByType,
  getEntry,
  listEntries,
  recordBonus,
  summaryFor,
} from '@/modules/ledger/service'
import { isLedgerType } from '@/modules/ledger/sign'
import { approvePayout, closeCycle, markPayoutPaid } from '@/modules/payout/service'
import { approveTask, cancelTask } from '@/modules/task/service'

import {
  createLedgerEntry,
  createPayout,
  createPayoutCycle,
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const CYCLE_DAY = SETTINGS_CATALOG['payout.cycleDay'].default
const METHODS = SETTINGS_CATALOG['payout.paymentMethods'].default
const IN_AUGUST = cairo('2026-08-10T09:00')
const CLOSE_AT = cairo('2026-08-28T23:59')

/**
 * The read paths behind مستحقاتي.
 *
 * A statement that renders the wrong rows is not a smaller bug than a balance
 * that computes the wrong total — it is the same bug arriving through a
 * different door, and the منفّذ has no way to tell them apart. These are the
 * functions the page actually calls, exercised against real rows.
 */
async function actor() {
  await seedPermissionCatalog(db)
  const user = await createUserWithPermissions(db, ['bonus.create', 'payout.generate'])
  return actorFor(db, user.id)
}

describe('modules/ledger — قراءة كشف الحركات', () => {
  it('يُرجع الصفحة مرتّبة من الأحدث ومع مجموع ما تختاره المرشّحات', async () => {
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '900.00',
    })
    await createLedgerEntry(db, {
      createdAt: cairo('2026-08-12T09:00'),
      userId: worker.id,
      type: 'PENALTY',
      amount: '-150.00',
    })

    const page = await listEntries(db, { userId: worker.id })

    expect(page.total).toBe(2)
    expect(page.page).toBe(1)
    expect(page.items[0]?.type).toBe('PENALTY')
    expect(page.balance).toBe('750.00')
  })

  it('يصفّي بالنوع، وعندها يكون المجموع مجموع المصفّى لا الرصيد', async () => {
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '900.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-150.00',
    })

    const page = await listEntries(db, { userId: worker.id, type: 'PENALTY' })
    expect(page.total).toBe(1)
    expect(page.balance).toBe('-150.00')
  })

  it('يصفّي بالدورة وبالمهمة وبالمدى الزمني', async () => {
    const manager = await actor()
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: manager.id })
    const task = await createTask(db, { projectId: project.id, assigneeId: worker.id })
    const cycle = await createPayoutCycle(db, { status: 'CLOSED' })

    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      cycleId: cycle.id,
      taskId: task.id,
      amount: '500.00',
    })
    await createLedgerEntry(db, {
      createdAt: cairo('2026-09-10T09:00'),
      userId: worker.id,
      amount: '700.00',
    })

    expect((await listEntries(db, { cycleId: cycle.id })).total).toBe(1)
    expect((await listEntries(db, { taskId: task.id })).total).toBe(1)
    expect(
      (
        await listEntries(db, {
          userId: worker.id,
          from: cairo('2026-09-01T00:00'),
          to: cairo('2026-10-01T00:00'),
        })
      ).total,
    ).toBe(1)
  })

  it('يقسّم النتائج على صفحات ويحدّ حجم الصفحة', async () => {
    const worker = await createUser(db)
    for (let index = 0; index < 5; index += 1) {
      await createLedgerEntry(db, {
        createdAt: IN_AUGUST,
        userId: worker.id,
        amount: '10.00',
      })
    }

    const first = await listEntries(db, { userId: worker.id, page: 1, pageSize: 2 })
    const last = await listEntries(db, { userId: worker.id, page: 3, pageSize: 2 })

    expect(first.items).toHaveLength(2)
    expect(first.total).toBe(5)
    expect(last.items).toHaveLength(1)
    // Out-of-range page and size inputs are clamped rather than trusted: this
    // list is reachable from a URL a منفّذ can edit.
    const clamped = await listEntries(db, { userId: worker.id, page: 0, pageSize: 9999 })
    expect(clamped.page).toBe(1)
    expect(clamped.pageSize).toBeLessThanOrEqual(200)
  })

  it('يعلّم القيد المعكوس بالقيد الذي عكسه', async () => {
    const manager = await actor()
    const worker = await createUser(db)
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '300.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    const { reverseEntry } = await import('@/modules/ledger/service')
    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'مكررة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const page = await listEntries(db, { userId: worker.id })
    const row = page.items.find((entry) => entry.id === original.id)
    expect(row?.reversedByEntryId).toBe(reversal.id)
    // …and the reversal itself is not marked as reversed by anything.
    expect(
      page.items.find((entry) => entry.id === reversal.id)?.reversedByEntryId,
    ).toBeNull()
  })

  it('يُرجع القيد الواحد ويرفض المعرّف المجهول', async () => {
    const worker = await createUser(db)
    const row = await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      amount: '250.00',
    })

    expect((await getEntry(db, row.id)).amount).toBe('250.00')
    await expect(getEntry(db, 'nope')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يجمع حركات الدورة حسب النوع', async () => {
    const worker = await createUser(db)
    const cycle = await createPayoutCycle(db, { status: 'OPEN' })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      cycleId: cycle.id,
      type: 'EARNING',
      amount: '900.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      cycleId: cycle.id,
      type: 'PENALTY',
      amount: '-100.00',
    })

    const totals = await cycleTotalsByType(db, { userId: worker.id, cycleId: cycle.id })
    expect(totals.get('EARNING')?.toFixed(2)).toBe('900.00')
    expect(totals.get('PENALTY')?.toFixed(2)).toBe('-100.00')
    expect(totals.get('BONUS')).toBeUndefined()
  })
})

describe('modules/ledger — ملخّص مستحقاتي', () => {
  it('يجمع الرصيد وحركات الدورة المفتوحة وما لم يُصرف بعد', async () => {
    const manager = await actor()
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'EARNING',
      amount: '2000.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'PENALTY',
      amount: '-150.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: worker.id,
      type: 'ADJUSTMENT',
      amount: '-50.00',
    })

    const summary = await summaryFor(db, { userId: worker.id })

    expect(summary.balance).toBe('1800.00')
    expect(summary.currentCycle).not.toBeNull()
    expect(summary.currentCycle?.gross).toBe('2000.00')
    // Magnitudes for the columns a statement prints next to a word…
    expect(summary.currentCycle?.penalties).toBe('150.00')
    // …but the adjustment keeps its sign, because its direction is its content.
    expect(summary.currentCycle?.adjustments).toBe('-50.00')
    expect(summary.outstandingPayouts).toBe('0.00')

    // A closed cycle with a drafted payout is money owed but not yet handed over.
    await closeCycle(db, { actor: manager, now: CLOSE_AT, cycleDay: CYCLE_DAY })
    expect((await summaryFor(db, { userId: worker.id })).outstandingPayouts).toBe(
      '1800.00',
    )
  })

  it('يُرجع دورة حالية فارغة القيم لا null حين لا حركة فيها', async () => {
    const worker = await createUser(db)
    await createPayoutCycle(db, { status: 'OPEN' })

    const summary = await summaryFor(db, { userId: worker.id })
    expect(summary.currentCycle?.gross).toBe('0.00')
    expect(summary.currentCycle?.advances).toBe('0.00')
    expect(summary.balance).toBe('0.00')
  })

  it('لا يحسب مستحقًا مصروفًا ضمن غير المصروف', async () => {
    const worker = await createUser(db)
    const cycle = await createPayoutCycle(db, { status: 'CLOSED' })
    await createPayout(db, {
      userId: worker.id,
      cycleId: cycle.id,
      status: 'PAID',
      net: '900.00',
      paidAmount: '900.00',
    })

    expect((await summaryFor(db, { userId: worker.id })).outstandingPayouts).toBe('0.00')
  })
})

describe('modules/ledger — المكافأة', () => {
  it('تُسجَّل موجبة بسبب مكتوب وتُسمّي نفسها في التدقيق', async () => {
    const manager = await actor()
    const worker = await createUser(db)

    const entry = await recordBonus(db, {
      userId: worker.id,
      amount: '750.00',
      reason: 'إنجاز حملة العيد قبل الموعد',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(entry.type).toBe('BONUS')
    expect(entry.amount).toBe('750.00')
    expect(entry.note).toBe('إنجاز حملة العيد قبل الموعد')
    expect(await db.auditLog.count({ where: { action: 'bonus.created' } })).toBe(1)
  })

  it('ترفض سببًا فارغًا', async () => {
    const manager = await actor()
    const worker = await createUser(db)

    await expect(
      recordBonus(db, {
        userId: worker.id,
        amount: '750.00',
        reason: '   ',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: IN_AUGUST,
      }),
    ).rejects.toThrow()
    expect(await db.ledgerEntry.count()).toBe(0)
  })
})

describe('modules/ledger — منفذ الحدث ومنفذ التسوية', () => {
  it('الحافلة الإنتاجية تقرأ يوم الدورة من الإعدادات بنفسها', async () => {
    // `ledgerTaskEvents` is the adapter the task actions wire in; it must work
    // without anybody handing it a setting.
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['task.approve'])
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: manager.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
      taskValue: '640.00',
    })

    await approveTask(db, {
      actor: await actorFor(db, manager.id),
      now: IN_AUGUST,
      events: ledgerTaskEvents,
      input: { taskId: task.id, qualityRating: 4 },
    })

    expect(
      (
        await db.ledgerEntry.findFirstOrThrow({ where: { taskId: task.id } })
      ).amount.toFixed(2),
    ).toBe('640.00')
  })

  it('منفذ التسوية يكتب قيدًا للمنفّذ السابق بنصّ القرار', async () => {
    // SPEC M4's "pay the previous assignee?" — the port Phase 4 left dark.
    const manager = await actor()
    const previous = await createUser(db)
    const project = await createProject(db, { ownerId: manager.id })
    const task = await createTask(db, { projectId: project.id, assigneeId: previous.id })

    await createLedgerPort({ cycleDay: CYCLE_DAY }).recordAdjustment(db, {
      userId: previous.id,
      taskId: task.id,
      amount: '300.00',
      note: 'مستحق جزئي عن العمل المنجز',
      createdById: manager.id,
      at: IN_AUGUST,
    })

    const entry = await db.ledgerEntry.findFirstOrThrow({
      where: { userId: previous.id },
    })
    expect(entry.type).toBe('ADJUSTMENT')
    expect(entry.amount.toFixed(2)).toBe('300.00')
    expect(entry.taskId).toBe(task.id)
    expect(entry.note).toBe('مستحق جزئي عن العمل المنجز')
  })

  it('لا يعكس استحقاق مهمة بعد صرف دورتها، ويسجّل تعذّر العكس', async () => {
    // The cancellation must still succeed — trapping a task in a status nobody
    // wants over a money question a REVERSAL cannot answer would be worse — but
    // the refusal has to be somebody's decision rather than nobody's.
    const manager = await actor()
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: manager.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_REVIEW',
      taskValue: '500.00',
    })
    const events = createLedgerTaskEvents({ cycleDay: CYCLE_DAY })

    await approveTask(db, {
      actor: manager,
      now: IN_AUGUST,
      events,
      input: { taskId: task.id, qualityRating: 5 },
    })
    const closed = await closeCycle(db, {
      actor: manager,
      now: CLOSE_AT,
      cycleDay: CYCLE_DAY,
    })
    const payout = await db.payout.findFirstOrThrow({
      where: { cycleId: closed.cycleId! },
    })
    await approvePayout(db, { payoutId: payout.id, actor: manager, now: CLOSE_AT })
    await markPayoutPaid(db, {
      payoutId: payout.id,
      amount: '500.00',
      method: METHODS[0]!,
      paymentMethods: METHODS,
      actor: manager,
      cycleDay: CYCLE_DAY,
      now: cairo('2026-08-29T10:00'),
    })

    await expect(
      cancelTask(db, {
        actor: manager,
        now: cairo('2026-08-30T10:00'),
        events,
        input: { taskId: task.id, reason: 'العميل ألغى بعد الصرف' },
      }),
    ).resolves.toBeDefined()

    expect(await db.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(0)
    expect(await db.auditLog.count({ where: { action: 'ledger.reversalBlocked' } })).toBe(
      1,
    )
  })

  it('عكس استحقاق مهمة بلا استحقاق أو معكوس مسبقًا لا يفعل شيئًا', async () => {
    const manager = await actor()
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: manager.id })
    const task = await createTask(db, { projectId: project.id, assigneeId: worker.id })

    // No EARNING at all.
    expect(
      await reverseTaskEarning(db, {
        taskId: task.id,
        cancelledAt: IN_AUGUST,
        cancelledById: manager.id,
        reason: 'إلغاء',
        cycleDay: CYCLE_DAY,
      }),
    ).toBeNull()

    // One EARNING, reversed once, then asked again.
    await appendEntry(db, {
      userId: worker.id,
      type: 'EARNING',
      amount: '400.00',
      taskId: task.id,
      note: 'استحقاق',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })
    const first = await reverseTaskEarning(db, {
      taskId: task.id,
      cancelledAt: IN_AUGUST,
      cancelledById: null,
      reason: 'إلغاء',
      cycleDay: CYCLE_DAY,
    })
    expect(first).not.toBeNull()
    expect(
      await reverseTaskEarning(db, {
        taskId: task.id,
        cancelledAt: IN_AUGUST,
        cancelledById: null,
        reason: 'إلغاء',
        cycleDay: CYCLE_DAY,
      }),
    ).toBeNull()
  })
})

describe('modules/ledger/sign — التعرّف على النوع', () => {
  it('يميّز أنواع القيود المعروفة عن غيرها', () => {
    // The guard a future importer or a raw query result has to pass before it
    // can be treated as a ledger type at all.
    expect(isLedgerType('EARNING')).toBe(true)
    expect(isLedgerType('REVERSAL')).toBe(true)
    expect(isLedgerType('REFUND')).toBe(false)
    expect(isLedgerType('')).toBe(false)
    expect(isLedgerType('toString')).toBe(false)
  })
})
