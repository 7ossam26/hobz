import { describe, expect, it } from 'vitest'

import { auditFilterSchema } from '@/modules/audit/schema'
import {
  buildAuditWhere,
  cairoDayBoundary,
  diffAuditEntry,
} from '@/modules/audit/service'

describe('modules/audit — عرض الفرق', () => {
  it('يعرض الحقول المتغيّرة فقط', () => {
    // An audit row for "edited a user" carries a dozen unchanged fields
    // alongside the one that moved. Rendering all twelve makes the reader hunt
    // for the change, which defeats the point of keeping the log.
    const rows = diffAuditEntry({
      before: { fullName: 'أحمد', phone: '+201012345678', isWorker: true },
      after: { fullName: 'أحمد إبراهيم', phone: '+201012345678', isWorker: true },
    })

    expect(rows).toEqual([
      { field: 'fullName', kind: 'changed', before: 'أحمد', after: 'أحمد إبراهيم' },
    ])
  })

  it('يميّز الإضافة عن الإزالة عن التغيير', () => {
    const rows = diffAuditEntry({
      before: { removed: 1, changed: 'a' },
      after: { added: 2, changed: 'b' },
    })

    expect(rows).toEqual([
      { field: 'added', kind: 'added', before: undefined, after: 2 },
      { field: 'changed', kind: 'changed', before: 'a', after: 'b' },
      { field: 'removed', kind: 'removed', before: 1, after: undefined },
    ])
  })

  it('يرتّب الحقول أبجديًا فيبقى العرض مستقرًا', () => {
    const rows = diffAuditEntry({ before: {}, after: { z: 1, a: 2, m: 3 } })
    expect(rows.map((r) => r.field)).toEqual(['a', 'm', 'z'])
  })

  it('يتعامل مع الإنشاء (لا يوجد قبل) والحذف (لا يوجد بعد)', () => {
    expect(diffAuditEntry({ before: undefined, after: { username: 'ahmed' } })).toEqual([
      { field: 'username', kind: 'added', before: undefined, after: 'ahmed' },
    ])
    expect(diffAuditEntry({ before: { username: 'ahmed' }, after: undefined })).toEqual([
      { field: 'username', kind: 'removed', before: 'ahmed', after: undefined },
    ])
  })

  it('يعتبر السجل بلا حمولة بلا فرق', () => {
    expect(diffAuditEntry({ before: undefined, after: undefined })).toEqual([])
    expect(diffAuditEntry({ before: {}, after: {} })).toEqual([])
    expect(diffAuditEntry({ before: null, after: null })).toEqual([])
  })

  it('يقارن المصفوفات بالمحتوى لا بالمرجع', () => {
    // Role and permission lists are the payloads that matter most here, and
    // they arrive as fresh arrays from JSON on every read.
    expect(
      diffAuditEntry({
        before: { permissions: ['task.assign', 'task.approve'] },
        after: { permissions: ['task.assign', 'task.approve'] },
      }),
    ).toEqual([])

    const changed = diffAuditEntry({
      before: { permissions: ['task.assign'] },
      after: { permissions: ['task.assign', 'payout.approve'] },
    })
    expect(changed).toHaveLength(1)
    expect(changed[0]?.kind).toBe('changed')
  })

  it('يحسب ترتيب المصفوفة تغييرًا', () => {
    // The services sort before writing, so a difference in order here means the
    // payload genuinely differs.
    expect(
      diffAuditEntry({ before: { p: ['a', 'b'] }, after: { p: ['b', 'a'] } }),
    ).toHaveLength(1)
  })

  it('يقارن الكائنات المتداخلة بالمحتوى', () => {
    expect(
      diffAuditEntry({ before: { meta: { a: 1 } }, after: { meta: { a: 1 } } }),
    ).toEqual([])
    expect(
      diffAuditEntry({ before: { meta: { a: 1 } }, after: { meta: { a: 2 } } }),
    ).toHaveLength(1)
  })

  it('يميّز null عن undefined عن السلسلة الفارغة', () => {
    // "phone cleared" and "phone never set" are different events.
    expect(
      diffAuditEntry({ before: { phone: '+201012345678' }, after: { phone: null } }),
    ).toHaveLength(1)
    expect(diffAuditEntry({ before: { phone: null }, after: { phone: null } })).toEqual(
      [],
    )
  })
})

describe('modules/audit — حدود اليوم بتوقيت القاهرة', () => {
  it('يبدأ اليوم عند منتصف الليل بتوقيت القاهرة لا بتوقيت UTC', () => {
    // Winter: Cairo is UTC+2, so local midnight is 22:00 the previous day UTC.
    expect(cairoDayBoundary('2026-01-15', 'start').toISOString()).toBe(
      '2026-01-14T22:00:00.000Z',
    )
  })

  it('ينهي اليوم عند آخر لحظة منه بتوقيت القاهرة', () => {
    expect(cairoDayBoundary('2026-01-15', 'end').toISOString()).toBe(
      '2026-01-15T21:59:59.999Z',
    )
  })

  it('يحترم التوقيت الصيفي المصري', () => {
    // Egypt reintroduced DST in 2023: last Friday of April to last Thursday of
    // October, UTC+3. A hardcoded +02:00 offset would put this hour out.
    expect(cairoDayBoundary('2026-07-15', 'start').toISOString()).toBe(
      '2026-07-14T21:00:00.000Z',
    )
  })

  it('يغطّي اليوم كاملًا دون فجوة ولا تداخل', () => {
    const end = cairoDayBoundary('2026-03-01', 'end')
    const nextStart = cairoDayBoundary('2026-03-02', 'start')
    expect(nextStart.getTime() - end.getTime()).toBe(1)
  })

  it('يتعامل مع نهايات الشهور وفبراير', () => {
    expect(cairoDayBoundary('2026-02-28', 'end').toISOString()).toBe(
      '2026-02-28T21:59:59.999Z',
    )
    expect(cairoDayBoundary('2026-12-31', 'end').toISOString()).toBe(
      '2026-12-31T21:59:59.999Z',
    )
  })

  it('يرفض تاريخًا غير صالح', () => {
    expect(() => cairoDayBoundary('not-a-date', 'start')).toThrow(RangeError)
  })
})

describe('modules/audit — مرشّحات السجل', () => {
  it('يبني شرطًا فارغًا عند غياب كل المرشّحات', () => {
    expect(buildAuditWhere(auditFilterSchema.parse({}))).toEqual({})
  })

  it('يضمّن نطاق التاريخ طرفيه', () => {
    // Inclusive on both ends: a user filtering "the 3rd to the 5th" means all
    // three days, and an exclusive upper bound would silently drop the last.
    const where = buildAuditWhere(
      auditFilterSchema.parse({ from: '2026-03-01', to: '2026-03-05' }),
    ) as { createdAt: { gte: Date; lte: Date } }

    expect(where.createdAt.gte.toISOString()).toBe('2026-02-28T22:00:00.000Z')
    expect(where.createdAt.lte.toISOString()).toBe('2026-03-05T21:59:59.999Z')
  })

  it('يقبل طرفًا واحدًا من النطاق', () => {
    const from = buildAuditWhere(auditFilterSchema.parse({ from: '2026-03-01' })) as {
      createdAt: Record<string, Date>
    }
    expect(from.createdAt).toHaveProperty('gte')
    expect(from.createdAt).not.toHaveProperty('lte')
  })

  it('يجمع كل المرشّحات', () => {
    expect(
      buildAuditWhere(
        auditFilterSchema.parse({
          actorId: 'u1',
          entity: 'User',
          entityId: 'u2',
          action: 'user.updated',
        }),
      ),
    ).toEqual({
      actorId: 'u1',
      entity: 'User',
      entityId: 'u2',
      action: 'user.updated',
    })
  })

  it('يرفض نطاقًا مقلوبًا', () => {
    expect(
      auditFilterSchema.safeParse({ from: '2026-03-05', to: '2026-03-01' }).success,
    ).toBe(false)
    // Same day either end is a legitimate single-day filter.
    expect(
      auditFilterSchema.safeParse({ from: '2026-03-05', to: '2026-03-05' }).success,
    ).toBe(true)
  })

  it('يحدّ حجم الصفحة', () => {
    expect(auditFilterSchema.parse({}).pageSize).toBe(50)
    expect(auditFilterSchema.safeParse({ pageSize: 101 }).success).toBe(false)
  })
})
