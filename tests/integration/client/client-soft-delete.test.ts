import { describe, expect, it } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import {
  createClient,
  deleteClient,
  getClient,
  listClientOptions,
  listClients,
} from '@/modules/client/service'

import {
  createClient as createClientRow,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * docs/TESTING.md §4 axis 11 — soft-delete: "deleted rows invisible
 * everywhere, but ledger/audit history intact" — CLAUDE.md invariant 8.
 *
 * `tests/integration/client/client.test.ts` already proves the basic shape
 * (deleted client vanishes from the list, `getClient` throws, the project's
 * `clientId` survives). This file goes narrower: the deleted row must vanish
 * even when it is the *only* thing a filter could possibly match — a search
 * excluding everything looks identical, from the caller's side, to a search
 * that simply found nothing, which is exactly the bug a lazy `WHERE` clause
 * produces — and it proves the audit trail outlives the row entirely.
 */

describe('الحذف الناعم — العميل: يختفي من كل قراءة وتبقى سجلات التدقيق', () => {
  it('يستثني العميل المحذوف من نتائج البحث حتى لو كان المطابقة الوحيدة للاسم', async () => {
    const uniqueName = 'شركة الفينيق المحذوفة الوحيدة'
    await createClientRow(db, { name: uniqueName, deletedAt: new Date('2026-01-01') })

    const page = await listClients(db, {
      search: 'الفينيق',
      page: 1,
      pageSize: 25,
    })

    expect(page.total).toBe(0)
    expect(page.items).toEqual([])
  })

  it('يرمي NotFoundError عند قراءة عميل محذوف مباشرة بالمعرف', async () => {
    const gone = await createClientRow(db, {
      name: 'عميل سيُقرأ بعد حذفه',
      deletedAt: new Date('2026-01-01'),
    })

    await expect(getClient(db, gone.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يستثني العميل المحذوف من قائمة اختيار العميل في نموذج المشروع', async () => {
    const live = await createClientRow(db, { name: 'عميل حي للاختيار' })
    await createClientRow(db, {
      name: 'عميل محذوف للاختيار',
      deletedAt: new Date('2026-01-01'),
    })

    const options = await listClientOptions(db)

    expect(options.map((o) => o.id)).toContain(live.id)
    expect(options.map((o) => o.name)).not.toContain('عميل محذوف للاختيار')
  })

  it('يحتفظ بسجلّي إنشاء العميل وحذفه في سجل التدقيق بعد الحذف', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['client.manage'])
    const actor = await actorFor(db, admin.id)

    const client = await createClient(db, {
      actor,
      input: { name: 'عميل للتدقيق', phone: null, notes: null },
    })

    await deleteClient(db, { actor, id: client.id })

    // The row itself is now invisible everywhere...
    await expect(getClient(db, client.id)).rejects.toBeInstanceOf(NotFoundError)

    // ...but both audit rows it generated are fully intact and readable,
    // exactly as CLAUDE.md invariants 7 and 8 require together.
    const created = await db.auditLog.findFirstOrThrow({
      where: { action: 'client.created', entityId: client.id },
    })
    expect(created.actorId).toBe(admin.id)
    expect(created.after).toMatchObject({ name: 'عميل للتدقيق' })

    const deleted = await db.auditLog.findFirstOrThrow({
      where: { action: 'client.deleted', entityId: client.id },
    })
    expect(deleted.actorId).toBe(admin.id)
    expect(deleted.before).toMatchObject({ deletedAt: null })
    expect(deleted.after).toMatchObject({})

    const allForClient = await db.auditLog.findMany({ where: { entityId: client.id } })
    expect(allForClient.map((a) => a.action).sort()).toEqual(
      ['client.created', 'client.deleted'].sort(),
    )
  })
})
