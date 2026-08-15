import { describe, expect, it } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import {
  createClient,
  deleteClient,
  getClient,
  listClients,
  updateClient,
} from '@/modules/client/service'

import {
  createClient as createClientRow,
  createProject,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

describe('modules/client — عميل خفيف الوزن، بلا أي أثر مالي', () => {
  it('ينشئ عميلًا ويسجّل تدقيقًا كاملًا', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['client.manage'])
    const actor = await actorFor(db, admin.id)

    const client = await createClient(db, {
      actor,
      input: { name: 'شركة النخبة', phone: '01012345678', notes: 'عميل مميز' },
    })

    expect(client.name).toBe('شركة النخبة')
    // Normalised to E.164 at the schema boundary — the service trusts its input.
    expect(client.phone).toBe('01012345678')
    expect(client.projectCount).toBe(0)

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'client.created', entityId: client.id },
    })
    expect(audit.actorId).toBe(admin.id)
    expect(audit.after).toMatchObject({ name: 'شركة النخبة' })
  })

  it('يحدّث بيانات العميل ويسجّل الفرق قبل وبعد', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['client.manage'])
    const actor = await actorFor(db, admin.id)
    const client = await createClientRow(db, { name: 'اسم قديم', phone: null })

    await updateClient(db, {
      actor,
      input: { id: client.id, name: 'اسم جديد', phone: null, notes: null },
    })

    const updated = await getClient(db, client.id)
    expect(updated.name).toBe('اسم جديد')

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'client.updated', entityId: client.id },
    })
    expect(audit.before).toMatchObject({ name: 'اسم قديم' })
    expect(audit.after).toMatchObject({ name: 'اسم جديد' })
  })

  it('يحذف العميل حذفًا ناعمًا ويُخفيه عن القائمة دون أن يمسّ المشاريع المرتبطة به', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, [
      'client.manage',
      'project.view.all',
    ])
    const actor = await actorFor(db, admin.id)
    const client = await createClientRow(db, { name: 'عميل سيُحذف' })
    const project = await createProject(db, {
      ownerId: admin.id,
      clientId: client.id,
      code: 'PRJ-CLI-1',
    })

    await deleteClient(db, { actor, id: client.id })

    const page = await listClients(db, { page: 1, pageSize: 25 })
    expect(page.items.map((c) => c.id)).not.toContain(client.id)
    await expect(getClient(db, client.id)).rejects.toBeInstanceOf(NotFoundError)

    // Soft-delete only, and the project keeps its (now orphaned) reference —
    // CLAUDE.md invariant 8 and SPEC §2 "soft-delete everywhere", not a cascade.
    const row = await db.client.findUniqueOrThrow({ where: { id: client.id } })
    expect(row.deletedAt).not.toBeNull()
    const stillLinked = await db.project.findUniqueOrThrow({ where: { id: project.id } })
    expect(stillLinked.clientId).toBe(client.id)
  })

  it('يبحث بالاسم جزئيًا ودون حساسية لحالة الأحرف', async () => {
    await seedPermissionCatalog(db)
    await createClientRow(db, { name: 'Acme Studio' })
    await createClientRow(db, { name: 'شركة أخرى' })

    const page = await listClients(db, { search: 'acme', page: 1, pageSize: 25 })
    expect(page.items.map((c) => c.name)).toEqual(['Acme Studio'])
  })

  it('يرفض تحديث أو قراءة عميل غير موجود', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['client.manage'])
    const actor = await actorFor(db, admin.id)

    await expect(getClient(db, 'nope')).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      updateClient(db, {
        actor,
        input: { id: 'nope', name: 'x', phone: null, notes: null },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يحسب عدد المشاريع غير المحذوفة المرتبطة بالعميل فقط', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const client = await createClientRow(db, { name: 'عميل بمشاريع' })
    await createProject(db, { ownerId: owner.id, clientId: client.id, code: 'PRJ-CNT-1' })
    await createProject(db, {
      ownerId: owner.id,
      clientId: client.id,
      code: 'PRJ-CNT-2',
      deletedAt: new Date('2026-01-01'),
    })

    const detail = await getClient(db, client.id)
    expect(detail.projectCount).toBe(1)
  })
})
