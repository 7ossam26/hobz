import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { confirmImport, previewImport } from '@/modules/import/service'

import {
  createClient,
  createProject,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { buildImportFixture } from '../../helpers/import-fixture'
import { testDb } from '../../setup/reset'

const db = testDb()

async function importerActor() {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, ['import.run'])
  return actorFor(db, admin.id)
}

describe('modules/import — استيراد المشاريع (تحديث بمطابقة الكود)', () => {
  it('ينشئ مشروعًا جديدًا مع حلّ العميل والمالك بالاسم واسم المستخدم', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'project.owner' })
    const client = await createClient(db, { name: 'عميل الاستيراد' })

    const buffer = await buildImportFixture('projects', [
      {
        code: '',
        name: 'مشروع مستورد',
        clientName: client.name,
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.FIXED_PRICE,
        status: '',
        startDate: '2026-09-01',
        dueDate: '2026-10-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 1, toUpdate: 0, invalid: 0 })

    await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'projects', buffer, actor }),
    )

    const row = await db.project.findFirstOrThrow({ where: { name: 'مشروع مستورد' } })
    expect(row.clientId).toBe(client.id)
    expect(row.ownerId).toBe(owner.id)
    expect(row.status).toBe('DRAFT')
    expect(row.code).toMatch(/^PRJ-/)
  })

  it('يحدّث مشروعًا موجودًا حين يطابق الكود مشروعًا حاليًا، ولا ينشئ ثانيًا', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'update.owner' })
    const existing = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-UPDME-1',
      name: 'اسم قديم',
    })

    const buffer = await buildImportFixture('projects', [
      {
        code: existing.code,
        name: 'اسم جديد بعد التحديث',
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.RETAINER,
        startDate: '2026-01-01',
        dueDate: '2026-12-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 0, toUpdate: 1 })

    const result = await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'projects', buffer, actor }),
    )
    expect(result).toEqual({ entity: 'projects', created: 0, updated: 1, skipped: 0 })

    const totalProjects = await db.project.count()
    expect(totalProjects).toBe(1)
    const row = await db.project.findUniqueOrThrow({ where: { id: existing.id } })
    expect(row.name).toBe('اسم جديد بعد التحديث')
    expect(row.engagementType).toBe('RETAINER')
  })

  it('يرفض صفًّا باسم مستخدم مالك غير موجود', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('projects', [
      {
        name: 'مشروع بلا مالك',
        ownerUsername: 'no.such.user',
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]).toMatchObject({ field: 'ownerUsername' })
    expect(preview.rows[0]?.errors[0]?.message).toContain(ar.import.errors.unresolvedUser)
  })

  it('يرفض صفًّا باسم عميل غير موجود، ويميّز ذلك عن اسم عميل مكرر', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'clientcase.owner' })
    await createClient(db, { name: 'اسم مكرر' })
    await createClient(db, { name: 'اسم مكرر' })

    const buffer = await buildImportFixture('projects', [
      {
        name: 'عميل غير موجود',
        clientName: 'عميل لا وجود له إطلاقًا',
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
      {
        name: 'عميل غامض',
        clientName: 'اسم مكرر',
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview.invalid).toBe(2)
    expect(preview.rows[0]?.errors[0]?.message).toContain(
      ar.import.errors.unresolvedClient,
    )
    expect(preview.rows[1]?.errors[0]?.message).toContain(
      ar.import.errors.ambiguousClient,
    )
  })

  it('يرفض كودًا مشروعًا مكررًا داخل الملف نفسه', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'dupcode.owner' })

    const buffer = await buildImportFixture('projects', [
      {
        code: 'PRJ-DUP-1',
        name: 'الأول',
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
      {
        code: 'PRJ-DUP-1',
        name: 'الثاني',
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 1, invalid: 1 })
    expect(preview.rows[1]?.errors[0]?.message).toContain(
      ar.import.errors.duplicateInFile,
    )
  })

  it('يرفض قيمة نوع تعاقد غير موجودة ضمن الخيارات المتاحة', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'badtype.owner' })

    const buffer = await buildImportFixture('projects', [
      {
        name: 'نوع تعاقد خاطئ',
        ownerUsername: owner.username,
        engagementType: 'نوع غير موجود إطلاقًا',
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]?.message).toContain(ar.import.errors.invalidOption)
  })

  it('يرفض تاريخ تسليم قبل تاريخ البدء — نفس قاعدة نموذج الإنشاء اليدوي', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'baddates.owner' })

    const buffer = await buildImportFixture('projects', [
      {
        name: 'تواريخ مقلوبة',
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-06-01',
        dueDate: '2026-01-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]?.message).toContain(ar.validation.dateRangeInvalid)
  })
})
