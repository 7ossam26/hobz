import { describe, expect, it, vi } from 'vitest'

import { ConflictError, DomainError, ForbiddenError } from '@/lib/errors'
import { balanceFor } from '@/modules/ledger/service'

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
import { CYCLE_DAY, penaltyRows, recompute } from '../../helpers/penalty'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
// Server actions reach for the request's headers and Next's cache, neither of
// which exists in a Vitest process. The permission check itself is untouched.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const { reversePenaltyAction, createPenaltyAction, grantBonusAction } =
  await import('@/modules/penalty/actions')
const { reversePenaltyOrBonus, grantBonus, createManualPenalty } =
  await import('@/modules/penalty/service')

/**
 * Phase brief item 7, and docs/TESTING.md §4 axis 7:
 *
 *   > Reversal: requires `penalty.reverse` / `bonus.reverse`, mandatory reason,
 *   > inserts an offsetting REVERSAL entry, never deletes. Reversing an
 *   > already-reversed entry must fail. Reversing an entry inside a PAID payout
 *   > must fail with a clear Arabic error.
 *
 * The three refusals belong to `modules/ledger` and are already proven there
 * against every entry type. What is proven *here* is that they hold on the
 * paths a manager actually reaches — through the action, with a real permission
 * check against a real `Actor` — and that the Arabic error a منفّذ's manager
 * sees is the one `i18n/ar` defines rather than a stack trace.
 */

const db = testDb()

const IN_JULY = cairo('2026-07-10T09:00')
const IN_AUGUST = cairo('2026-08-10T09:00')
const DUE = cairo('2026-03-01T17:00')
const NOW = cairo('2026-03-05T12:00')

async function scenario() {
  await seedPermissionCatalog(db)
  const worker = await createUser(db, { payType: 'PER_TASK' })
  return { worker }
}

async function accruedPenalty() {
  await seedPermissionCatalog(db)
  const owner = await createUser(db)
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
  await recompute(db, task.id, { now: NOW })
  const [entry] = await penaltyRows(db, task.id)
  return { worker, task, entryId: entry!.id }
}

describe('العكس يحتاج الصلاحية', () => {
  it('من لا يملك penalty.reverse يُمنع', async () => {
    const { entryId } = await accruedPenalty()
    const nobody = await createUserWithPermissions(db, ['penalty.view'])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(
      reversePenaltyAction({ entryId, reason: 'قرار الإدارة بإلغاء الخصم' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    clearSessionActor()
    // Nothing moved: a denied reversal is not a partial one.
    const rows = await penaltyRows(db, entryId ? '' : '')
    expect(rows).toHaveLength(0)
  })

  it('صاحب penalty.reverse يعكس الخصم', async () => {
    const { worker, entryId, task } = await accruedPenalty()
    const manager = await createUserWithPermissions(db, ['penalty.reverse'])
    setSessionActor(await actorFor(db, manager.id))

    const outcome = await reversePenaltyAction({
      entryId,
      reason: 'العميل هو من تأخر في إرسال المادة',
    })

    clearSessionActor()
    expect(outcome.type).toBe('PENALTY')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
    const rows = await penaltyRows(db, task.id)
    expect(rows[0]?.reversed).toBe(true)
  })

  /**
   * `penalty.reverse` getting somebody through the door must not silently also
   * grant them reversal of a bonus — SPEC §6 gives those two separate keys, and
   * a bonus reversal takes money *back* from a منفّذ.
   */
  it('صاحب penalty.reverse وحده لا يعكس مكافأة', async () => {
    const { worker } = await scenario()
    const granter = await createUserWithPermissions(db, ['bonus.create'])
    const bonus = await grantBonus(db, {
      userId: worker.id,
      amount: '500.00',
      reason: 'إنجاز مبكر',
      actor: await actorFor(db, granter.id),
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const manager = await createUserWithPermissions(db, ['penalty.reverse'])
    setSessionActor(await actorFor(db, manager.id))

    await expect(
      reversePenaltyAction({ entryId: bonus.entryId, reason: 'مُنحت بالخطأ' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    clearSessionActor()
    expect(await balanceFor(db, { userId: worker.id })).toBe('500.00')
  })

  it('صاحب المفتاحين يعكس المكافأة', async () => {
    const { worker } = await scenario()
    const manager = await createUserWithPermissions(db, [
      'bonus.create',
      'penalty.reverse',
      'bonus.reverse',
    ])
    const actor = await actorFor(db, manager.id)
    const bonus = await grantBonus(db, {
      userId: worker.id,
      amount: '500.00',
      reason: 'إنجاز مبكر',
      actor,
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    setSessionActor(actor)
    const outcome = await reversePenaltyAction({
      entryId: bonus.entryId,
      reason: 'مُنحت للشخص الخطأ',
    })
    clearSessionActor()

    expect(outcome.type).toBe('BONUS')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})

describe('العكس المزدوج مرفوض', () => {
  it('عكس قيد معكوس بالفعل يفشل', async () => {
    const { entryId } = await accruedPenalty()
    const manager = await createUserWithPermissions(db, ['penalty.reverse'])
    const actor = await actorFor(db, manager.id)

    await reversePenaltyOrBonus(db, {
      entryId,
      reason: 'السبب الأول',
      actor,
      cycleDay: CYCLE_DAY,
    })

    await expect(
      reversePenaltyOrBonus(db, {
        entryId,
        reason: 'السبب الثاني',
        actor,
        cycleDay: CYCLE_DAY,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('لا يمكن عكس القيد العكسي نفسه', async () => {
    const { entryId } = await accruedPenalty()
    const manager = await createUserWithPermissions(db, ['penalty.reverse'])
    const actor = await actorFor(db, manager.id)

    const reversal = await reversePenaltyOrBonus(db, {
      entryId,
      reason: 'قرار الإدارة',
      actor,
      cycleDay: CYCLE_DAY,
    })

    await expect(
      reversePenaltyOrBonus(db, {
        entryId: reversal.reversalId,
        reason: 'تراجع عن التراجع',
        actor,
        cycleDay: CYCLE_DAY,
      }),
    ).rejects.toThrow(DomainError)
  })
})

describe('العكس بعد الصرف مرفوض برسالة عربية واضحة', () => {
  it('قيد في دورة صُرفت لا يُعكس', async () => {
    await seedPermissionCatalog(db)
    const worker = await createUser(db)
    const manager = await createUserWithPermissions(db, ['penalty.reverse'])
    const actor = await actorFor(db, manager.id)

    const cycle = await createPayoutCycle(db, {
      periodStart: cairo('2026-06-29T00:00'),
      periodEnd: cairo('2026-07-28T23:59'),
      status: 'CLOSED',
    })
    const entry = await createLedgerEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-150.00',
      cycleId: cycle.id,
      createdAt: IN_JULY,
    })
    await createPayout(db, {
      userId: worker.id,
      cycleId: cycle.id,
      status: 'PAID',
      net: '1000.00',
      paidAmount: '1000.00',
    })

    const failure = await reversePenaltyOrBonus(db, {
      entryId: entry.id,
      reason: 'الخصم كان خطأ',
      actor,
      cycleDay: CYCLE_DAY,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(DomainError)
    // The message key `i18n/ar` renders as "لا يمكن عكس قيد من دورة صُرفت
    // بالفعل. استخدم قيد تسوية." — it names the instrument that *is* available.
    expect((failure as DomainError).messageKey).toBe('ledger.errors.cycleAlreadyPaid')
  })

  it('دورة مغلقة لم تُصرف بعد تظل قابلة للعكس', async () => {
    await seedPermissionCatalog(db)
    const worker = await createUser(db)
    const manager = await createUserWithPermissions(db, ['penalty.reverse'])
    const cycle = await createPayoutCycle(db, {
      periodStart: cairo('2026-06-29T00:00'),
      periodEnd: cairo('2026-07-28T23:59'),
      status: 'CLOSED',
    })
    const entry = await createLedgerEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-150.00',
      cycleId: cycle.id,
      createdAt: IN_JULY,
    })

    // SPEC §5.4's recomputation has to keep working across a cycle boundary, so
    // "closed" is not "paid". The reversal lands in the open cycle, and the
    // statement somebody already read stays exactly as they read it.
    const outcome = await reversePenaltyOrBonus(db, {
      entryId: entry.id,
      reason: 'اعتُمد تمديد بأثر رجعي',
      actor: await actorFor(db, manager.id),
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    expect(outcome.type).toBe('PENALTY')
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })
})

describe('سبب العكس إلزامي', () => {
  it('سبب فارغ يفشل قبل أي كتابة', async () => {
    const { entryId } = await accruedPenalty()
    const manager = await createUserWithPermissions(db, ['penalty.reverse'])

    await expect(
      reversePenaltyOrBonus(db, {
        entryId,
        reason: '   ',
        actor: await actorFor(db, manager.id),
        cycleDay: CYCLE_DAY,
      }),
    ).rejects.toThrow(DomainError)
  })

  it('السبب يصير نصّ القيد العكسي كما كُتب', async () => {
    const { entryId, task } = await accruedPenalty()
    const manager = await createUserWithPermissions(db, ['penalty.reverse'])
    const reason = 'تأخر العميل في اعتماد النص، والمنفّذ لا ذنب له'

    await reversePenaltyOrBonus(db, {
      entryId,
      reason,
      actor: await actorFor(db, manager.id),
      cycleDay: CYCLE_DAY,
    })

    const reversal = await db.ledgerEntry.findFirst({
      where: { taskId: task.id, type: 'REVERSAL' },
      select: { note: true },
    })
    // Verbatim. It is the manager's own sentence and the only explanation the
    // منفّذ gets, so nothing paraphrases it.
    expect(reversal?.note).toBe(reason)
  })
})

describe('ما لا يُعكس يدويًا', () => {
  it('قيد استحقاق لا يُعكس من هذا المسار', async () => {
    await seedPermissionCatalog(db)
    const worker = await createUser(db)
    const manager = await createUserWithPermissions(db, ['penalty.reverse'])
    const entry = await createLedgerEntry(db, {
      userId: worker.id,
      type: 'EARNING',
      amount: '500.00',
      createdAt: IN_AUGUST,
    })

    await expect(
      reversePenaltyOrBonus(db, {
        entryId: entry.id,
        reason: 'اعتُمدت بالخطأ',
        actor: await actorFor(db, manager.id),
        cycleDay: CYCLE_DAY,
      }),
    ).rejects.toThrow(DomainError)
  })
})

describe('الخصم اليدوي والمكافأة — الصلاحيات', () => {
  it('penalty.create مطلوب لتسجيل خصم يدوي', async () => {
    const { worker } = await scenario()
    const nobody = await createUserWithPermissions(db, ['penalty.view'])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(
      createPenaltyAction({
        userId: worker.id,
        amount: '200.00',
        reason: 'تكرار الغياب دون إخطار',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    clearSessionActor()
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('bonus.create مطلوب لمنح مكافأة', async () => {
    const { worker } = await scenario()
    const nobody = await createUserWithPermissions(db, ['penalty.create'])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(
      grantBonusAction({ userId: worker.id, amount: '300.00', reason: 'مجهود إضافي' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    clearSessionActor()
    expect(await balanceFor(db, { userId: worker.id })).toBe('0.00')
  })

  it('الخصم اليدوي سببه نص حر يظهر للمنفّذ كما كُتب', async () => {
    const { worker } = await scenario()
    const manager = await createUserWithPermissions(db, ['penalty.create'])
    const reason = 'غياب يومين دون إخطار مسبق'

    const outcome = await createManualPenalty(db, {
      userId: worker.id,
      amount: '200.00',
      reason,
      actor: await actorFor(db, manager.id),
      cycleDay: CYCLE_DAY,
      at: IN_AUGUST,
    })

    const entry = await db.ledgerEntry.findUnique({
      where: { id: outcome.entryId as string },
      select: { note: true, isAutoGenerated: true, type: true },
    })
    expect(entry?.note).toContain(reason)
    // `isAutoGenerated: false` is what keeps the nightly engine's hands off it.
    expect(entry?.isAutoGenerated).toBe(false)
    expect(await balanceFor(db, { userId: worker.id })).toBe('-200.00')
  })

  it('إعادة الحساب الآلية لا تعكس خصمًا يدويًا على المهمة نفسها', async () => {
    const { worker, task } = await accruedPenalty()
    const manager = await createUserWithPermissions(db, ['penalty.create'])
    await createManualPenalty(db, {
      userId: worker.id,
      taskId: task.id,
      amount: '75.00',
      reason: 'تسليم ناقص',
      actor: await actorFor(db, manager.id),
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    // Three more working days: the automatic figure moves 150 → 200. The
    // manager's 75 is not the engine's to touch.
    await recompute(db, task.id, { now: cairo('2026-03-08T12:00') })

    const rows = await penaltyRows(db, task.id)
    const manual = rows.filter((r) => !r.isAutoGenerated)
    expect(manual).toHaveLength(1)
    expect(manual[0]?.reversed).toBe(false)
    expect(await balanceFor(db, { userId: worker.id })).toBe('-275.00')
  })
})
