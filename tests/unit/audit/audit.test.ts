import { describe, expect, it, vi } from 'vitest'

import { recordAudit, redact } from '@/lib/audit'
import type { Db } from '@/lib/db'

import { actingAs, superAdmin } from '../../helpers/auth'

function fakeDb(): { db: Db; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async (args: unknown) => args)
  return { db: { auditLog: { create } } as unknown as Db, create }
}

describe('lib/audit — إخفاء الحقول الحساسة', () => {
  it('يستبدل تجزئة كلمة المرور بعلامة إخفاء', () => {
    expect(redact({ username: 'ahmed', passwordHash: '$2b$12$abc' })).toEqual({
      username: 'ahmed',
      passwordHash: '[redacted]',
    })
  })

  it('يخفي الحقول الحساسة داخل الكائنات المتداخلة والمصفوفات', () => {
    expect(
      redact({ users: [{ password: 'p' }, { token: 't' }], meta: { secret: 's' } }),
    ).toEqual({
      users: [{ password: '[redacted]' }, { token: '[redacted]' }],
      meta: { secret: '[redacted]' },
    })
  })

  it('يحوّل التواريخ إلى نص ISO ليبقى الفرق قابلًا للقراءة', () => {
    expect(redact({ at: new Date('2026-03-01T09:00:00.000Z') })).toEqual({
      at: '2026-03-01T09:00:00.000Z',
    })
  })

  it('يمرّر القيم البسيطة كما هي', () => {
    expect(redact(null)).toBeNull()
    expect(redact(42)).toBe(42)
    expect(redact('نص')).toBe('نص')
    expect(redact(undefined)).toBeUndefined()
  })
})

describe('lib/audit — كتابة السجل', () => {
  it('يكتب صفًا يحمل الفاعل والإجراء والكيان', async () => {
    const { db, create } = fakeDb()
    const actor = actingAs(['settings.edit'], { id: 'u1' })

    await recordAudit(db, {
      actor,
      action: 'setting.updated',
      entity: 'Setting',
      entityId: 'payout.cycleDay',
      before: { value: 28 },
      after: { value: 25 },
      reason: 'بداية دورة جديدة',
      ip: '10.0.0.1',
    })

    expect(create).toHaveBeenCalledOnce()
    const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data).toMatchObject({
      actorId: 'u1',
      action: 'setting.updated',
      entity: 'Setting',
      entityId: 'payout.cycleDay',
      before: { value: 28 },
      after: { value: 25 },
      reason: 'بداية دورة جديدة',
      ip: '10.0.0.1',
    })
  })

  it('يسمح بفاعل فارغ لإجراءات المجدول', async () => {
    const { db, create } = fakeDb()

    await recordAudit(db, {
      actor: null,
      action: 'penalty.applied',
      entity: 'LedgerEntry',
      entityId: 'entry_1',
    })

    const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data.actorId).toBeNull()
    expect(data.reason).toBeNull()
    expect(data.ip).toBeNull()
  })

  it('يخفي كلمة المرور حتى لو مرّر المتصل الكيان كاملًا', async () => {
    const { db, create } = fakeDb()

    await recordAudit(db, {
      actor: actingAs(['user.create']),
      action: 'user.created',
      entity: 'User',
      entityId: 'u2',
      after: { username: 'ahmed', passwordHash: '$2b$12$secret' },
    })

    const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data.after).toEqual({ username: 'ahmed', passwordHash: '[redacted]' })
  })

  it('يسجّل الهويتين عند العرض كمستخدم آخر', async () => {
    // SPEC Phase 1 §5 — every action while impersonating carries both identities.
    const { db, create } = fakeDb()
    const impersonating = superAdmin({ id: 'target', impersonatorId: 'root' })

    await recordAudit(db, {
      actor: impersonating,
      action: 'task.approved',
      entity: 'Task',
      entityId: 't1',
      after: { status: 'APPROVED' },
    })

    const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data.actorId).toBe('target')
    expect(data.after).toEqual({ status: 'APPROVED', __impersonator: 'root' })
  })

  it('يسجّل هوية المنتحِل حتى بدون حمولة after', async () => {
    const { db, create } = fakeDb()

    await recordAudit(db, {
      actor: superAdmin({ id: 'target', impersonatorId: 'root' }),
      action: 'user.viewed',
      entity: 'User',
      entityId: 'u9',
    })

    const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data.after).toMatchObject({ __impersonator: 'root' })
  })
})
