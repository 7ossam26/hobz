import { describe, expect, it } from 'vitest'

import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import { appendEntry, recordAdjustment, reverseEntry } from '@/modules/ledger/service'
import { ensureOpenCycle } from '@/modules/payout/cycle'

import {
  createLedgerEntry,
  createPayout,
  createPayoutCycle,
  createUser,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const CYCLE_DAY = SETTINGS_CATALOG['payout.cycleDay'].default
const NOW = cairo('2026-08-15T10:00')

/**
 * CLAUDE.md invariant 1, and the half of it that had only ever been a promise:
 *
 *   > Enforce it at the database level (a trigger or rule rejecting
 *   > UPDATE/DELETE) as well as in code.
 *
 * Every test in this file goes *around* the service on purpose. A guard that
 * only holds when the service is asked politely is not a guard — the failure it
 * exists to prevent is a raw query in a future phase, a migration written in a
 * hurry, or somebody with a psql prompt.
 */

async function entry(overrides: Parameters<typeof createLedgerEntry>[1]) {
  return createLedgerEntry(db, overrides)
}

describe('ledger — القيد لا يُعدَّل ولا يُحذف (على مستوى قاعدة البيانات)', () => {
  it('يرفض UPDATE على أي عمود', async () => {
    const user = await createUser(db)
    const row = await entry({ userId: user.id, amount: '500.00' })

    await expect(
      db.ledgerEntry.update({ where: { id: row.id }, data: { amount: '5000.00' } }),
    ).rejects.toThrow(/append-only/i)

    // And the row is untouched, not merely un-returned.
    const after = await db.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } })
    expect(after.amount.toFixed(2)).toBe('500.00')
  })

  it('يرفض UPDATE حتى على حقل لا علاقة له بالمال', async () => {
    // The rule is "this table is immutable", not "the amount is immutable".
    const user = await createUser(db)
    const row = await entry({ userId: user.id })

    await expect(
      db.ledgerEntry.update({ where: { id: row.id }, data: { note: 'تعديل' } }),
    ).rejects.toThrow(/append-only/i)
  })

  it('يرفض DELETE', async () => {
    const user = await createUser(db)
    const row = await entry({ userId: user.id })

    await expect(db.ledgerEntry.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/i,
    )
    expect(await db.ledgerEntry.count({ where: { id: row.id } })).toBe(1)
  })

  it('يرفض UPDATE و DELETE الجماعيين', async () => {
    const user = await createUser(db)
    await entry({ userId: user.id })
    await entry({ userId: user.id })

    await expect(
      db.ledgerEntry.updateMany({ where: { userId: user.id }, data: { amount: '1.00' } }),
    ).rejects.toThrow(/append-only/i)
    await expect(
      db.ledgerEntry.deleteMany({ where: { userId: user.id } }),
    ).rejects.toThrow(/append-only/i)

    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(2)
  })

  it('يرفض SQL خامًا يتجاوز Prisma تمامًا', async () => {
    const user = await createUser(db)
    const row = await entry({ userId: user.id })

    await expect(
      db.$executeRawUnsafe(`UPDATE ledger_entries SET amount = 1 WHERE id = $1`, row.id),
    ).rejects.toThrow(/append-only/i)
    await expect(
      db.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE id = $1`, row.id),
    ).rejects.toThrow(/append-only/i)
  })

  it('يذكر في رسالته أن التصحيح يكون بقيد عكسي', async () => {
    // The person who trips this is a developer who needs to be told where to go
    // next, not merely told "no".
    const user = await createUser(db)
    const row = await entry({ userId: user.id })

    await expect(
      db.ledgerEntry.update({ where: { id: row.id }, data: { amount: '1.00' } }),
    ).rejects.toThrow(/REVERSAL/i)
  })

  it('لا يمنع حذف المستخدم من الفشل بوضوح بدل تعديل القيد', async () => {
    // The FK is RESTRICT, not SET NULL: SET NULL would issue an UPDATE against
    // this table and surface as a confusing trigger error instead of the honest
    // foreign-key error that it is. Users are soft-deleted anyway.
    const user = await createUser(db)
    await entry({ userId: user.id })

    await expect(db.user.delete({ where: { id: user.id } })).rejects.toThrow()
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(1)
  })
})

describe('ledger — ما يرفضه مسار الكتابة الوحيد', () => {
  async function scenario() {
    await seedPermissionCatalog(db)
    const manager = await createUser(db)
    const worker = await createUser(db)
    return { manager: await actorFor(db, manager.id), worker }
  }

  it('يرفض قيدًا بلا بيان — القيد الذي لا يشرح نفسه', async () => {
    const { manager, worker } = await scenario()

    await expect(
      appendEntry(db, {
        userId: worker.id,
        type: 'EARNING',
        amount: '100.00',
        note: '   ',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('يرفض تسوية بلا سبب', async () => {
    const { manager, worker } = await scenario()

    await expect(
      recordAdjustment(db, {
        userId: worker.id,
        amount: '-100.00',
        reason: '  ',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('يعمل بلا لحظة ولا عنوان IP مُمرَّرين', async () => {
    // The optional arguments really are optional: a job writing without an IP
    // and without an injected clock must still produce a complete entry.
    const { manager, worker } = await scenario()

    const entry = await appendEntry(db, {
      userId: worker.id,
      type: 'EARNING',
      amount: '100.00',
      note: 'استحقاق',
      actor: manager,
      cycleDay: CYCLE_DAY,
    })

    expect(entry.amount).toBe('100.00')
    expect(entry.cycleId).not.toBeNull()
    expect(await db.auditLog.count({ where: { entity: 'LedgerEntry' } })).toBe(1)
  })

  it('أول دورة تبدأ من أقدم قيد لا من لحظة فتحها', async () => {
    // Otherwise the first cycle would begin *after* money it is about to pay
    // out had already moved.
    const { worker } = await scenario()
    const oldest = cairo('2026-08-01T09:00')
    await createLedgerEntry(db, {
      createdAt: oldest,
      userId: worker.id,
      cycleId: null,
      amount: '100.00',
    })

    const cycle = await ensureOpenCycle(db, { now: NOW, cycleDay: CYCLE_DAY })
    expect(cycle.created).toBe(true)
    expect(cycle.periodStart).toEqual(oldest)

    // Asked again, it is the same cycle and it was not created twice.
    expect((await ensureOpenCycle(db, { now: NOW, cycleDay: CYCLE_DAY })).created).toBe(
      false,
    )
  })

  it('أول دورة على نظام فارغ تبدأ من الآن', async () => {
    const cycle = await ensureOpenCycle(db, { now: NOW, cycleDay: CYCLE_DAY })
    expect(cycle.periodStart).toEqual(NOW)
  })

  it('لا تبدأ أول دورة في المستقبل لمجرد وجود قيد مؤجَّل', async () => {
    // The reach-backwards rule reaches *back* only. An entry stamped later than
    // the moment the cycle opens must not push the period's start into the
    // future, which would leave the days in between belonging to no cycle.
    const { worker } = await scenario()
    await createLedgerEntry(db, {
      createdAt: cairo('2026-09-01T09:00'),
      userId: worker.id,
      cycleId: null,
      amount: '100.00',
    })

    const cycle = await ensureOpenCycle(db, { now: NOW, cycleDay: CYCLE_DAY })
    expect(cycle.periodStart).toEqual(NOW)
  })
})

describe('ledger — التصحيح يكون بقيد عكسي', () => {
  async function scenario() {
    await seedPermissionCatalog(db)
    const manager = await createUser(db)
    const worker = await createUser(db)
    return { manager: await actorFor(db, manager.id), worker }
  }

  it('يكتب قيدًا معاكسًا بنفس المقدار وإشارة معكوسة', async () => {
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم تأخير',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'الخصم احتُسب على مهمة ممددة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    expect(reversal.type).toBe('REVERSAL')
    expect(reversal.amount).toBe('250.00')
    expect(reversal.reversesEntryId).toBe(original.id)

    // Two rows, and the original is still exactly as written.
    const rows = await db.ledgerEntry.findMany({ where: { userId: worker.id } })
    expect(rows).toHaveLength(2)
    const kept = rows.find((r) => r.id === original.id)
    expect(kept?.amount.toFixed(2)).toBe('-250.00')
  })

  it('يرفض عكس القيد مرتين — على مستوى قاعدة البيانات', async () => {
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    await reverseEntry(db, {
      entryId: original.id,
      reason: 'مكافأة مكررة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    await expect(
      reverseEntry(db, {
        entryId: original.id,
        reason: 'مرة أخرى',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    // The unique index is the real guarantee: two concurrent reversals cannot
    // both win even if both passed the service's own check.
    await expect(
      db.ledgerEntry.create({
        data: {
          userId: worker.id,
          type: 'REVERSAL',
          amount: '-400.00',
          note: 'التفاف',
          reversesEntryId: original.id,
        },
      }),
    ).rejects.toThrow()
  })

  it('يرفض عكس قيد عكسي', async () => {
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })
    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'خطأ',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    await expect(
      reverseEntry(db, {
        entryId: reversal.id,
        reason: 'إعادة المكافأة',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض العكس بعد صرف مستحقات الدورة', async () => {
    // docs/TESTING.md §4 axis 7. Money that has left the agency cannot be
    // un-charged by rewriting the period it came from; the instrument for that
    // is an ADJUSTMENT in the open cycle, which shows up as its own movement.
    const { manager, worker } = await scenario()
    const cycle = await createPayoutCycle(db, { status: 'CLOSED' })
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم',
      actor: manager,
      cycleId: cycle.id,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })
    await createPayout(db, {
      userId: worker.id,
      cycleId: cycle.id,
      status: 'PAID',
      net: '750.00',
      paidAmount: '750.00',
    })

    await expect(
      reverseEntry(db, {
        entryId: original.id,
        reason: 'الخصم كان خاطئًا',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يسمح بالعكس بعد إغلاق الدورة ما دامت لم تُصرف', async () => {
    // Phase 8 recomputes a penalty across a cycle boundary (SPEC §5.4:
    // "Recalculation = insert REVERSAL + insert new PENALTY"). Blocking that
    // would leave a stale deduction standing.
    const { manager, worker } = await scenario()
    const cycle = await createPayoutCycle(db, { status: 'CLOSED' })
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-250.00',
      note: 'خصم',
      actor: manager,
      cycleId: cycle.id,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })
    await createPayout(db, { userId: worker.id, cycleId: cycle.id, status: 'DRAFT' })

    const reversal = await reverseEntry(db, {
      entryId: original.id,
      reason: 'تمديد معتمد',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })
    expect(reversal.amount).toBe('250.00')
  })

  it('يرفض عكس قيد صرف', async () => {
    // A PAYOUT is not a standalone movement: it is the ledger's half of a
    // Payout row whose `paidAmount` is a running total. Reversing it would
    // credit the balance back while the payout kept saying the money had gone,
    // breaking the invariant that `SUM(PAYOUT)` equals `−paidAmount`.
    const { manager, worker } = await scenario()
    const cycle = await createPayoutCycle(db, { status: 'CLOSED' })
    const disbursement = await appendEntry(db, {
      userId: worker.id,
      type: 'PAYOUT',
      amount: '-750.00',
      note: 'صرف مستحقات',
      actor: manager,
      cycleId: cycle.id,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    await expect(
      reverseEntry(db, {
        entryId: disbursement.id,
        reason: 'استرداد',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(await db.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(0)
  })

  it('يرفض عكس قيد غير موجود', async () => {
    const { manager } = await scenario()
    await expect(
      reverseEntry(db, {
        entryId: 'nope',
        reason: 'سبب',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يشترط سببًا مكتوبًا للعكس', async () => {
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    await expect(
      reverseEntry(db, {
        entryId: original.id,
        reason: '   ',
        actor: manager,
        cycleDay: CYCLE_DAY,
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يكتب سطر تدقيق للقيد وللعكس معًا', async () => {
    const { manager, worker } = await scenario()
    const original = await appendEntry(db, {
      userId: worker.id,
      type: 'BONUS',
      amount: '400.00',
      note: 'مكافأة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })
    await reverseEntry(db, {
      entryId: original.id,
      reason: 'مكافأة مكررة',
      actor: manager,
      cycleDay: CYCLE_DAY,
      at: NOW,
    })

    const rows = await db.auditLog.findMany({
      where: { entity: 'LedgerEntry' },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows.map((r) => r.action)).toEqual(['ledger.entryCreated', 'ledger.reversed'])
    expect(rows[1]?.reason).toBe('مكافأة مكررة')
  })
})
