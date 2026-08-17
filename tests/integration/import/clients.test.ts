import { describe, expect, it } from 'vitest'

import { confirmImport, previewImport } from '@/modules/import/service'

import { createUserWithPermissions, seedPermissionCatalog } from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { buildImportFixture } from '../../helpers/import-fixture'
import { testDb } from '../../setup/reset'

const db = testDb()

async function importerActor() {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, ['import.run'])
  return actorFor(db, admin.id)
}

describe('modules/import — استيراد العملاء (إنشاء فقط، لا مفتاح فريد للتحديث)', () => {
  it('ينشئ كل صف صالح كعميل جديد، حتى لو تكرر الاسم', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('clients', [
      { name: 'شركة النخبة', phone: '01012345678', notes: 'عميل مميز' },
      { name: 'شركة النخبة', phone: '', notes: '' },
    ])

    const preview = await previewImport(db, { entity: 'clients', buffer, actor })
    expect(preview).toMatchObject({ totalRows: 2, toCreate: 2, toUpdate: 0, invalid: 0 })

    const result = await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'clients', buffer, actor }),
    )
    expect(result).toEqual({ entity: 'clients', created: 2, updated: 0, skipped: 0 })

    const rows = await db.client.findMany({ where: { name: 'شركة النخبة' } })
    expect(rows).toHaveLength(2)
  })

  it('يحافظ على النص العربي لاسم وملاحظات العميل دون تشويه', async () => {
    const actor = await importerActor()
    const name = 'مؤسسة الفجر الجديد للدعاية والإعلان'
    const notes = 'التواصل عبر واتساب فقط، ويُفضَّل بعد الساعة الرابعة عصرًا'
    const buffer = await buildImportFixture('clients', [{ name, phone: '', notes }])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'clients', buffer, actor }))

    const row = await db.client.findFirstOrThrow({ where: { name } })
    expect(row.name).toBe(name)
    expect(row.notes).toBe(notes)
  })

  it('يرفض صفًا بلا اسم عميل', async () => {
    const actor = await importerActor()
    // `phone` non-blank keeps the row from being treated as an empty
    // trailing line (`parse.ts` drops fully-blank rows outright) — this row
    // is deliberately *present*, just invalid.
    const buffer = await buildImportFixture('clients', [
      { name: '', phone: '01012345678', notes: '' },
    ])

    const preview = await previewImport(db, { entity: 'clients', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 0, invalid: 1 })
    expect(preview.rows[0]?.errors[0]?.field).toBe('name')
  })

  it('يقبل ملفًا مختلطًا: صفوف صالحة وصف واحد غير صالح، ويستورد الصالح فقط', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('clients', [
      { name: 'عميل صالح ١', phone: '', notes: '' },
      { name: '', phone: '', notes: 'صف بلا اسم' },
      { name: 'عميل صالح ٢', phone: '', notes: '' },
    ])

    const preview = await previewImport(db, { entity: 'clients', buffer, actor })
    expect(preview).toMatchObject({ totalRows: 3, toCreate: 2, invalid: 1 })

    const result = await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'clients', buffer, actor }),
    )
    expect(result).toEqual({ entity: 'clients', created: 2, updated: 0, skipped: 1 })

    const count = await db.client.count()
    expect(count).toBe(2)
  })
})
