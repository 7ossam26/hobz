import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { confirmImport, previewImport } from '@/modules/import/service'

import {
  createUser,
  createUserWithPermissions,
  createRole,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { buildImportFixture } from '../../helpers/import-fixture'
import { testDb } from '../../setup/reset'

const db = testDb()

async function importerActor() {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, ['import.run', 'user.view'])
  return actorFor(db, admin.id)
}

describe('modules/import — استيراد المستخدمين', () => {
  it('يُنشئ صفًا جديدًا ويُحدِّث صفًا لمستخدم موجود في نفس الملف', async () => {
    const actor = await importerActor()
    const existing = await createUser(db, {
      username: 'existing.user',
      fullName: 'اسم قديم',
      isWorker: true,
      payType: 'PER_TASK',
      defaultTaskRate: '200.00',
    })

    const buffer = await buildImportFixture('users', [
      {
        username: 'new.hire',
        fullName: 'موظف جديد',
        password: 'Passw0rd123',
        isWorker: ar.common.yes,
        payType: ar.enums.payType.PER_TASK,
        defaultTaskRate: '400.00',
      },
      {
        username: 'existing.user',
        fullName: 'اسم محدَّث',
        isWorker: ar.common.yes,
        payType: ar.enums.payType.PER_TASK,
        defaultTaskRate: '250.00',
      },
    ])

    const preview = await previewImport(db, { entity: 'users', buffer, actor })
    expect(preview).toMatchObject({ totalRows: 2, toCreate: 1, toUpdate: 1, invalid: 0 })
    expect(preview.rows.map((r) => r.action)).toEqual(['create', 'update'])

    const result = await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'users', buffer, actor }),
    )
    expect(result).toEqual({ entity: 'users', created: 1, updated: 1, skipped: 0 })

    const created = await db.user.findUniqueOrThrow({ where: { username: 'new.hire' } })
    expect(created.fullName).toBe('موظف جديد')
    expect(created.mustChangePassword).toBe(true)

    const updated = await db.user.findUniqueOrThrow({ where: { id: existing.id } })
    expect(updated.fullName).toBe('اسم محدَّث')
    expect(updated.defaultTaskRate?.toFixed(2)).toBe('250.00')

    const createdAudit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.created', entityId: created.id },
    })
    expect(createdAudit.actorId).toBe(actor.id)
    const updatedAudit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.updated', entityId: existing.id },
    })
    expect(updatedAudit).toBeTruthy()

    const summaryAudit = await db.auditLog.findFirstOrThrow({
      where: { action: 'import.completed' },
    })
    expect(summaryAudit.after).toMatchObject({
      entity: 'users',
      created: 1,
      updated: 1,
      skipped: 0,
    })
  })

  it('يحافظ على النص العربي للاسم الكامل دون أي تشويه عند الحفظ الفعلي', async () => {
    const actor = await importerActor()
    const arabicName = 'محمد عبد الرحمن السيد — قسم التسويق الرقمي'

    const buffer = await buildImportFixture('users', [
      {
        username: 'arabic.roundtrip',
        fullName: arabicName,
        password: 'Passw0rd123',
        isWorker: ar.common.no,
      },
    ])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'users', buffer, actor }))

    const row = await db.user.findUniqueOrThrow({
      where: { username: 'arabic.roundtrip' },
    })
    expect(row.fullName).toBe(arabicName)
  })

  it('يرفض صفًّا ثانيًا باسم مستخدم مكرر داخل نفس الملف', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('users', [
      {
        username: 'dup.user',
        fullName: 'الأول',
        password: 'Passw0rd123',
        isWorker: ar.common.no,
      },
      {
        username: 'dup.user',
        fullName: 'الثاني',
        password: 'Passw0rd123',
        isWorker: ar.common.no,
      },
    ])

    const preview = await previewImport(db, { entity: 'users', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 1, toUpdate: 0, invalid: 1 })
    expect(preview.rows[1]?.errors).toEqual([
      expect.objectContaining({ field: 'username' }),
    ])
    expect(preview.rows[1]?.errors[0]?.message).toContain(
      ar.import.errors.duplicateInFile,
    )
  })

  it('يرفض كلمة مرور أقصر من سياسة الأمان الحالية مع رسالة عربية توضّح الحد', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('users', [
      { username: 'weak.pw', fullName: 'ضعيف', password: 'a1', isWorker: ar.common.no },
    ])

    const preview = await previewImport(db, { entity: 'users', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]?.message).toContain(
      ar.validation.passwordTooShort.replace('{min}', '10'),
    )
  })

  it('يرفض حقل الاسم الكامل الفارغ باعتباره حقلًا مطلوبًا', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('users', [
      {
        username: 'no.name',
        fullName: '',
        password: 'Passw0rd123',
        isWorker: ar.common.no,
      },
    ])

    const preview = await previewImport(db, { entity: 'users', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors.some((e) => e.field === 'fullName')).toBe(true)
  })

  it('يرفض منفّذًا براتب شهري بلا قيمة راتب — نفس رسالة نموذج الإنشاء اليدوي', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('users', [
      {
        username: 'salaried.nosalary',
        fullName: 'بلا راتب',
        password: 'Passw0rd123',
        isWorker: ar.common.yes,
        payType: ar.enums.payType.SALARY,
      },
    ])

    const preview = await previewImport(db, { entity: 'users', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]?.message).toContain(
      ar.validation.salaryRequiredForPayType,
    )
  })

  it('لا يمس كلمة مرور مستخدم موجود عند تحديثه عبر الاستيراد، حتى لو تُرك العمود فارغًا', async () => {
    const actor = await importerActor()
    const existing = await createUser(db, { username: 'untouched.pw', fullName: 'قديم' })
    const before = await db.user.findUniqueOrThrow({ where: { id: existing.id } })

    const buffer = await buildImportFixture('users', [
      { username: 'untouched.pw', fullName: 'جديد', isWorker: ar.common.no },
    ])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'users', buffer, actor }))

    const after = await db.user.findUniqueOrThrow({ where: { id: existing.id } })
    expect(after.passwordHash).toBe(before.passwordHash)
    expect(after.fullName).toBe('جديد')
  })

  it('يحافظ على أدوار المستخدم الموجود لأن القالب لا يحتوي عمود أدوار', async () => {
    const actor = await importerActor()
    const role = await createRole(db, { nameEn: 'kept_role' })
    const existing = await createUser(db, {
      username: 'kept.roles',
      fullName: 'قبل',
      roleIds: [role.id],
    })
    const buffer = await buildImportFixture('users', [
      { username: 'KEPT.ROLES', fullName: 'بعد', isWorker: ar.common.no },
    ])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'users', buffer, actor }))

    const memberships = await db.userRole.findMany({ where: { userId: existing.id } })
    expect(memberships.map((membership) => membership.roleId)).toEqual([role.id])
  })
})
