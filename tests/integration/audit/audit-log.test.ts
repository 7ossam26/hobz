import { describe, expect, it } from 'vitest'

import { recordAudit } from '@/lib/audit'
import { getPasswordPolicy } from '@/lib/auth/policy'
import { auditFilterSchema } from '@/modules/audit/schema'
import { auditFacets, getAuditEntry, listAuditEntries } from '@/modules/audit/service'
import { createUser as createUserService, updateUser } from '@/modules/user/service'

import {
  createRole,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

const filter = (raw: Record<string, unknown> = {}) => auditFilterSchema.parse(raw)

describe('lib/audit — السجل غير قابل للتعديل', () => {
  it('لا يوفّر أي مسار للتعديل أو الحذف في الوحدة', async () => {
    // CLAUDE.md invariant 7. A `deleteAuditLog` in modules/audit would be the
    // bug, not the missing feature — so the module's public surface is the
    // assertion.
    const service = await import('@/modules/audit/service')
    const names = Object.keys(service)

    expect(names.some((n) => /update|delete|remove|purge/i.test(n))).toBe(false)
  })

  it('يكتب صفًا لكل تغيير ولا يعيد كتابة الصف السابق', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.edit', 'user.create'])
    const actor = await actorFor(db, admin.id)
    const role = await createRole(db, { nameEn: 'BASE_ROLE' })

    const created = await createUserService(db, {
      actor,
      policy: await getPasswordPolicy(),
      input: {
        username: 'new.person',
        password: 'a-sufficiently-long-password',
        fullName: 'شخص جديد',
        phone: '+201012345678',
        isWorker: true,
        payType: 'PER_TASK',
        monthlySalary: null,
        defaultTaskRate: '400.00',
        weeklyCapacityHours: 40,
        penaltyProfileId: null,
        roles: [role.id],
      },
    })

    await updateUser(db, {
      actor,
      input: {
        id: created.id,
        fullName: 'شخص معدَّل',
        phone: '+201112345678',
        isWorker: true,
        payType: 'PER_TASK',
        monthlySalary: null,
        defaultTaskRate: '400.00',
        weeklyCapacityHours: 40,
        penaltyProfileId: null,
        roles: [role.id],
      },
    })

    const rows = await db.auditLog.findMany({
      where: { entityId: created.id },
      orderBy: { createdAt: 'asc' },
    })

    expect(rows.map((r) => r.action)).toEqual(['user.created', 'user.updated'])
    // The creation row still says what it said. Corrections append.
    expect(rows[0]?.after).toMatchObject({ fullName: 'شخص جديد' })
    expect(rows[1]?.before).toMatchObject({ fullName: 'شخص جديد' })
    expect(rows[1]?.after).toMatchObject({ fullName: 'شخص معدَّل' })
  })

  it('يخفي تجزئة كلمة المرور حتى لو مرّر المتصل الكيان كاملًا', async () => {
    const user = await createUser(db)
    await recordAudit(db, {
      actor: { id: user.id },
      action: 'user.updated',
      entity: 'User',
      entityId: user.id,
      after: { username: 'ahmed', passwordHash: '$2b$12$secret', nested: { token: 't' } },
    })

    const row = await db.auditLog.findFirstOrThrow()
    expect(row.after).toEqual({
      username: 'ahmed',
      passwordHash: '[redacted]',
      nested: { token: '[redacted]' },
    })
  })
})

describe('modules/audit — المرشّحات', () => {
  async function fixture() {
    await seedPermissionCatalog(db)
    const alice = await createUser(db, { username: 'alice', fullName: 'عالية' })
    const bob = await createUser(db, { username: 'bob', fullName: 'باسم' })

    await db.auditLog.createMany({
      data: [
        {
          actorId: alice.id,
          action: 'user.created',
          entity: 'User',
          entityId: 'u_1',
          createdAt: new Date('2026-03-01T10:00:00Z'),
        },
        {
          actorId: alice.id,
          action: 'role.created',
          entity: 'Role',
          entityId: 'r_1',
          createdAt: new Date('2026-03-03T10:00:00Z'),
        },
        {
          actorId: bob.id,
          action: 'user.updated',
          entity: 'User',
          entityId: 'u_1',
          createdAt: new Date('2026-03-05T10:00:00Z'),
        },
        {
          actorId: null,
          action: 'penalty.applied',
          entity: 'LedgerEntry',
          entityId: 'l_1',
          createdAt: new Date('2026-03-07T10:00:00Z'),
        },
      ],
    })

    return { alice, bob }
  }

  it('يرشّح بالمنفِّذ', async () => {
    const { alice } = await fixture()
    const page = await listAuditEntries(db, filter({ actorId: alice.id }))

    expect(page.total).toBe(2)
    expect(page.items.every((i) => i.actor?.id === alice.id)).toBe(true)
  })

  it('يرشّح بنوع العنصر وبمعرّفه', async () => {
    await fixture()
    expect((await listAuditEntries(db, filter({ entity: 'User' }))).total).toBe(2)
    expect(
      (await listAuditEntries(db, filter({ entity: 'User', entityId: 'u_1' }))).total,
    ).toBe(2)
    expect((await listAuditEntries(db, filter({ entityId: 'r_1' }))).total).toBe(1)
  })

  it('يرشّح بالإجراء', async () => {
    await fixture()
    expect((await listAuditEntries(db, filter({ action: 'user.created' }))).total).toBe(1)
  })

  it('يرشّح بنطاق تاريخ شامل للطرفين', async () => {
    // The 3rd to the 5th means all three days. An exclusive upper bound would
    // silently drop the last, which in an investigation is the worst kind of
    // wrong answer.
    await fixture()
    const page = await listAuditEntries(
      db,
      filter({ from: '2026-03-03', to: '2026-03-05' }),
    )

    expect(page.total).toBe(2)
    expect(page.items.map((i) => i.action).sort()).toEqual([
      'role.created',
      'user.updated',
    ])
  })

  it('يحترم توقيت القاهرة في حدود اليوم', async () => {
    // 2026-03-01T22:30Z is already 2026-03-02 in Cairo (UTC+2). Filtering on
    // the 1st must NOT return it.
    await seedPermissionCatalog(db)
    const user = await createUser(db)
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: 'user.created',
        entity: 'User',
        entityId: 'x',
        createdAt: new Date('2026-03-01T22:30:00Z'),
      },
    })

    expect(
      (await listAuditEntries(db, filter({ from: '2026-03-01', to: '2026-03-01' })))
        .total,
    ).toBe(0)
    expect(
      (await listAuditEntries(db, filter({ from: '2026-03-02', to: '2026-03-02' })))
        .total,
    ).toBe(1)
  })

  it('يعرض الأحدث أولًا', async () => {
    await fixture()
    const page = await listAuditEntries(db, filter())
    const dates = page.items.map((i) => i.createdAt.getTime())
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
  })

  it('يقسّم النتائج إلى صفحات', async () => {
    await fixture()
    const first = await listAuditEntries(db, filter({ page: 1, pageSize: 2 }))
    const second = await listAuditEntries(db, filter({ page: 2, pageSize: 2 }))

    expect(first.items).toHaveLength(2)
    expect(second.items).toHaveLength(2)
    expect(first.total).toBe(4)
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(4)
  })

  it('يعرض إجراءات النظام بلا منفِّذ', async () => {
    await fixture()
    const page = await listAuditEntries(db, filter({ action: 'penalty.applied' }))
    expect(page.items[0]?.actor).toBeNull()
  })

  it('يبني قوائم المرشّحات من السجل الفعلي', async () => {
    const { alice, bob } = await fixture()
    const facets = await auditFacets(db)

    expect(facets.entities.sort()).toEqual(['LedgerEntry', 'Role', 'User'])
    expect(facets.actions).toContain('user.created')
    expect(facets.actors.map((a) => a.id).sort()).toEqual([alice.id, bob.id].sort())
  })

  it('يقرأ سجلًا واحدًا بمعرّفه', async () => {
    await fixture()
    const any = await db.auditLog.findFirstOrThrow()
    expect((await getAuditEntry(db, any.id)).id).toBe(any.id)
  })

  it('يرمي خطأ عدم الوجود لمعرّف غير موجود', async () => {
    await expect(getAuditEntry(db, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
