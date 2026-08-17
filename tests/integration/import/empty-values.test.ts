import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { confirmImport, previewImport } from '@/modules/import/service'

import {
  createProject,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { buildImportFixture } from '../../helpers/import-fixture'
import { testDb } from '../../setup/reset'

/**
 * docs/TESTING.md §4 axis 12 — empty/null, for `modules/import`.
 *
 * Every field this suite touches is *optional in the template* but has a real
 * schema-level default (`createTaskSchema`, `createUserSchema`,
 * `createProjectSchema`, `createClientSchema`) — the point is confirming a
 * blank cell reaches that default (or `null`, whichever the field's own
 * schema defines) rather than silently becoming `''` or being skipped.
 */

const db = testDb()

async function importerActor() {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, ['import.run'])
  return actorFor(db, admin.id)
}

const DESIGN_LABEL = 'تصميم' // `tasks.categories` default (lib/settings/catalog.ts → i18n/ar.ts `defaults.taskCategories`)

describe('modules/import — القيم الفارغة والافتراضية (محور ١٢)', () => {
  it('ينشئ مهمة في حالة "قائمة الانتظار" بلا منفّذ حين يُترك عمود المنفّذ فارغًا، بقيمة صفر', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'noassignee.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-NOASSIGN-1' })

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title: 'مهمة بلا منفّذ',
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
      },
    ])

    const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 1, invalid: 0 })

    await db.$transaction((tx) => confirmImport(tx, { entity: 'tasks', buffer, actor }))

    const task = await db.task.findFirstOrThrow({ where: { title: 'مهمة بلا منفّذ' } })
    expect(task.status).toBe('BACKLOG')
    expect(task.assigneeId).toBeNull()
    expect(task.taskValue.toFixed(2)).toBe('0.00')
  })

  it('يحافظ على قيمة مهمة مكتوبة يدويًا بلا منفّذ، ولا يُصفّرها رغم غياب سعر تلقائي', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'noassignval.owner' })
    const project = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-NOASSIGNVAL-1',
    })

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title: 'مهمة بقيمة صريحة بلا منفّذ',
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
        taskValue: '275.50',
      },
    ])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'tasks', buffer, actor }))

    const task = await db.task.findFirstOrThrow({
      where: { title: 'مهمة بقيمة صريحة بلا منفّذ' },
    })
    expect(task.status).toBe('BACKLOG')
    expect(task.assigneeId).toBeNull()
    expect(task.taskValue.toFixed(2)).toBe('275.50')
  })

  it('ينشئ مشروعًا بلا عميل حين يُترك عمود اسم العميل فارغًا، دون أي خطأ', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'noclient.owner' })

    const buffer = await buildImportFixture('projects', [
      {
        name: 'مشروع بلا عميل',
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 1, invalid: 0 })

    await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'projects', buffer, actor }),
    )

    const row = await db.project.findFirstOrThrow({ where: { name: 'مشروع بلا عميل' } })
    expect(row.clientId).toBeNull()
  })

  it('ينشئ مستخدمًا جديدًا بالقيم الافتراضية الحقيقية حين تُترك كل الأعمدة الاختيارية فارغة', async () => {
    const actor = await importerActor()

    const buffer = await buildImportFixture('users', [
      {
        username: 'blank.optional',
        fullName: 'مستخدم بأعمدة اختيارية فارغة',
        password: 'Passw0rd123',
      },
    ])

    const preview = await previewImport(db, { entity: 'users', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 1, invalid: 0 })

    await db.$transaction((tx) => confirmImport(tx, { entity: 'users', buffer, actor }))

    const row = await db.user.findUniqueOrThrow({ where: { username: 'blank.optional' } })
    expect(row.phone).toBeNull()
    expect(row.isWorker).toBe(false)
    expect(row.payType).toBe('PER_TASK')
    expect(row.monthlySalary).toBeNull()
    expect(row.defaultTaskRate).toBeNull()
    expect(row.weeklyCapacityHours).toBe(40)
  })

  it('يُصفّر الحقول الاختيارية لمستخدم موجود عند تحديثه عبر الاستيراد بأعمدة فارغة، ولا يُبقي القيم القديمة', async () => {
    const actor = await importerActor()
    const existing = await createUser(db, {
      username: 'reset.optional',
      fullName: 'قبل التصفير',
      phone: '+201001234567',
      isWorker: true,
      payType: 'SALARY',
      monthlySalary: '9000.00',
      defaultTaskRate: '300.00',
      weeklyCapacityHours: 20,
    })

    const buffer = await buildImportFixture('users', [
      { username: 'reset.optional', fullName: 'بعد التصفير' },
    ])

    const preview = await previewImport(db, { entity: 'users', buffer, actor })
    expect(preview).toMatchObject({ toUpdate: 1, invalid: 0 })

    await db.$transaction((tx) => confirmImport(tx, { entity: 'users', buffer, actor }))

    const row = await db.user.findUniqueOrThrow({ where: { id: existing.id } })
    expect(row.fullName).toBe('بعد التصفير')
    expect(row.phone).toBeNull()
    expect(row.isWorker).toBe(false)
    expect(row.payType).toBe('PER_TASK')
    expect(row.monthlySalary).toBeNull()
    expect(row.defaultTaskRate).toBeNull()
    expect(row.weeklyCapacityHours).toBe(40)
  })

  it('يُخزَّن حقل أولوية المهمة بالقيمة الافتراضية "متوسطة" حين يُترك فارغًا', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'blankpriority.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-BLANKPRI-1' })

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title: 'مهمة بلا أولوية محددة',
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
      },
    ])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'tasks', buffer, actor }))

    const task = await db.task.findFirstOrThrow({
      where: { title: 'مهمة بلا أولوية محددة' },
    })
    expect(task.priority).toBe('MEDIUM')
  })

  it('يُخزَّن حقل حالة المشروع بالقيمة الافتراضية "مسودة" حين يُترك فارغًا', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'blankstatus.owner' })

    const buffer = await buildImportFixture('projects', [
      {
        name: 'مشروع بلا حالة محددة',
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
    ])

    await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'projects', buffer, actor }),
    )

    const row = await db.project.findFirstOrThrow({
      where: { name: 'مشروع بلا حالة محددة' },
    })
    expect(row.status).toBe('DRAFT')
  })

  it('يقبل ملفًا بصفّ بيانات واحد فقط وينجح الاستيراد بشكل طبيعي — الحد الأدنى غير الفارغ', async () => {
    const actor = await importerActor()

    const buffer = await buildImportFixture('clients', [
      { name: 'عميل الصف الوحيد', phone: '', notes: '' },
    ])

    const preview = await previewImport(db, { entity: 'clients', buffer, actor })
    expect(preview).toMatchObject({ totalRows: 1, toCreate: 1, invalid: 0 })

    const result = await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'clients', buffer, actor }),
    )
    expect(result).toEqual({ entity: 'clients', created: 1, updated: 0, skipped: 0 })

    const count = await db.client.count()
    expect(count).toBe(1)
  })

  it('يُخزَّن هاتف وملاحظات العميل كـ null وليس نصًّا فارغًا حين يُتركان فارغين', async () => {
    const actor = await importerActor()

    const buffer = await buildImportFixture('clients', [
      { name: 'عميل بلا هاتف وملاحظات', phone: '', notes: '' },
    ])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'clients', buffer, actor }))

    const row = await db.client.findFirstOrThrow({
      where: { name: 'عميل بلا هاتف وملاحظات' },
    })
    expect(row.phone).toBeNull()
    expect(row.notes).toBeNull()
  })
})
