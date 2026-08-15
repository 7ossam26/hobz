import { describe, expect, it, vi } from 'vitest'

import { recordAudit } from '@/lib/audit'
import { getSetting } from '@/lib/settings'
import { auditFilterSchema } from '@/modules/audit/schema'
import { auditFacets, listAuditEntries } from '@/modules/audit/service'
import { listRoles } from '@/modules/role/service'
import { listUsersSchema } from '@/modules/user/schema'
import { getUser, listUsers } from '@/modules/user/service'

import { createRole, createUser, seedPermissionCatalog } from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { setSessionActor } from '../../helpers/session-mock'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))

const { getOwnProfile } = await import('@/modules/user/queries')

const db = testDb()

/**
 * docs/TESTING.md §4 axis 12, against a genuinely empty database.
 *
 * This is the state the product is actually in on its first morning: the seed
 * has run, nobody has done anything, and every list is empty. A query that
 * returns `undefined` instead of `[]` here crashes a page that a real operator
 * is looking at while deciding whether the tool works.
 */

describe('قاعدة بيانات فارغة — القوائم', () => {
  it('يعيد قائمة مستخدمين فارغة لا قيمة غير معرّفة', async () => {
    const page = await listUsers(db, listUsersSchema.parse({}))

    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
    expect(page.page).toBe(1)
    expect(page.pageSize).toBe(25)
  })

  it('يعيد قائمة أدوار فارغة', async () => {
    expect(await listRoles(db)).toEqual([])
  })

  it('يعيد سجل تدقيق فارغًا', async () => {
    const page = await listAuditEntries(db, auditFilterSchema.parse({}))
    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
  })

  it('يعيد مرشّحات فارغة لا معطوبة', async () => {
    // The filter dropdowns are built from the log itself. On day one there is
    // nothing to build them from, and the page still has to render.
    const facets = await auditFacets(db)
    expect(facets).toEqual({ actors: [], entities: [], actions: [] })
  })
})

describe('قاعدة بيانات فارغة — الترقيم خارج النطاق', () => {
  it('يعيد صفحة فارغة بإجمالي صحيح بعد آخر صفحة', async () => {
    // Someone bookmarked page 40 of a list that has since shrunk to two rows.
    // The total must stay honest so the pager can send them back.
    await createUser(db, { username: 'one' })
    await createUser(db, { username: 'two' })

    const page = await listUsers(db, listUsersSchema.parse({ page: 999, pageSize: 25 }))
    expect(page.items).toEqual([])
    expect(page.total).toBe(2)
    expect(page.page).toBe(999)
  })

  it('يعيد صفحة تدقيق فارغة خارج النطاق', async () => {
    const page = await listAuditEntries(
      db,
      auditFilterSchema.parse({ page: 50, pageSize: 50 }),
    )
    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
  })

  it('يعيد لا شيء لبحث لا يطابق أحدًا', async () => {
    await createUser(db, { username: 'ahmed', fullName: 'أحمد' })

    const page = await listUsers(
      db,
      listUsersSchema.parse({ search: 'لا-أحد-بهذا-الاسم' }),
    )
    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
  })
})

describe('المستخدم الجديد تمامًا', () => {
  it('يبني فاعلًا بلا أي صلاحية', async () => {
    const brandNew = await createUser(db, { username: 'day.one' })
    const actor = await actorFor(db, brandNew.id)

    expect(actor.permissions.size).toBe(0)
    expect(actor.isSuperAdmin).toBe(false)
    expect(actor.impersonatorId).toBeUndefined()
  })

  it('يقرأ ملفه الشخصي رغم أنه لا يملك أي صلاحية', async () => {
    // The one read that must work for an account with nothing granted — the
    // header shows their name from it.
    const brandNew = await createUser(db, { username: 'day.one', phone: null })
    setSessionActor(await actorFor(db, brandNew.id))

    const profile = await getOwnProfile()
    expect(profile.username).toBe('day.one')
    expect(profile.roles).toEqual([])
    expect(profile.phone).toBeNull()
  })

  it('يعرض بيانات مستخدم بلا هاتف ولا راتب ولا أدوار', async () => {
    const bare = await createUser(db, {
      username: 'bare',
      phone: null,
      monthlySalary: null,
      defaultTaskRate: null,
      isWorker: false,
    })

    const detail = await getUser(db, bare.id)
    // Explicitly null, never the string "null" and never undefined — both of
    // which would reach the table cell verbatim.
    expect(detail.phone).toBeNull()
    expect(detail.monthlySalary).toBeNull()
    expect(detail.defaultTaskRate).toBeNull()
    expect(detail.roles).toEqual([])
  })

  it('يحوّل المال إلى نص بخانتين عشريتين حين يوجد', async () => {
    // The complement: a present Decimal must not arrive as a JS number.
    const paid = await createUser(db, { defaultTaskRate: '500', monthlySalary: '11000' })

    const detail = await getUser(db, paid.id)
    expect(detail.defaultTaskRate).toBe('500.00')
    expect(detail.monthlySalary).toBe('11000.00')
    expect(typeof detail.defaultTaskRate).toBe('string')
  })
})

describe('الدور الفارغ', () => {
  it('يعرض دورًا بلا صلاحيات ولا أعضاء', async () => {
    await seedPermissionCatalog(db)
    const empty = await createRole(db, { nameEn: 'PARKED', permissions: [] })

    const summary = (await listRoles(db)).find((r) => r.id === empty.id)
    expect(summary?.permissionCount).toBe(0)
    expect(summary?.memberCount).toBe(0)
  })
})

describe('سجل تدقيق بلا منفِّذ ولا سبب ولا عنوان', () => {
  it('يقرأ صف النظام كاملًا دون أي حقل مفقود', async () => {
    // What the 03:00 penalty job writes: no actor, no reason, no IP, and in
    // some cases no payload either.
    await recordAudit(db, {
      actor: null,
      action: 'penalty.applied',
      entity: 'LedgerEntry',
      entityId: 'l_1',
    })

    const page = await listAuditEntries(db, auditFilterSchema.parse({}))
    const entry = page.items[0]

    expect(entry?.actor).toBeNull()
    expect(entry?.impersonator).toBeNull()
    expect(entry?.reason).toBeNull()
    expect(entry?.ip).toBeNull()
    expect(entry?.before).toBeNull()
    expect(entry?.after).toBeNull()
  })

  it('لا يدرج النظام ضمن قائمة المنفِّذين', async () => {
    // The actor filter is a list of people. A null actor has no name to show.
    await recordAudit(db, {
      actor: null,
      action: 'penalty.applied',
      entity: 'LedgerEntry',
      entityId: 'l_1',
    })

    expect((await auditFacets(db)).actors).toEqual([])
    expect((await auditFacets(db)).actions).toEqual(['penalty.applied'])
  })
})

describe('الإعدادات على جدول فارغ', () => {
  it('يعيد القيم الافتراضية من الكتالوج قبل تشغيل البذرة', async () => {
    // The reset truncates `settings` before every test, so this is the
    // pre-seed state. A missing row is normal; falling back is correct.
    expect(await getSetting('security.minPasswordLength')).toBe(10)
    expect(await getSetting('security.maxLoginAttempts')).toBe(5)
    expect(await getSetting('penalty.defaultGraceHours')).toBe(24)
  })
})
