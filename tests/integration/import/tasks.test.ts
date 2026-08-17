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

const db = testDb()

async function importerActor() {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, ['import.run'])
  return actorFor(db, admin.id)
}

const DESIGN_LABEL = 'تصميم' // `tasks.categories` default (lib/settings/catalog.ts → i18n/ar.ts `defaults.taskCategories`)

describe('modules/import — استيراد المهام (إنشاء فقط)', () => {
  it('ينشئ مهمة ويسندها مباشرة عند تحديد منفّذ نشط، ويملأ قيمتها تلقائيًا من سعره الافتراضي', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'task.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-TASKIMP-1' })
    const assignee = await createUser(db, {
      username: 'task.assignee',
      defaultTaskRate: '350.00',
    })

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title: 'تصميم شعار جديد',
        description: '',
        categoryLabel: DESIGN_LABEL,
        priority: '',
        assigneeUsername: assignee.username,
        dueDate: '2026-09-15',
        estimatedHours: '8',
        taskValue: '',
      },
    ])

    const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
    expect(preview).toMatchObject({ toCreate: 1, invalid: 0 })

    await db.$transaction((tx) => confirmImport(tx, { entity: 'tasks', buffer, actor }))

    const task = await db.task.findFirstOrThrow({ where: { title: 'تصميم شعار جديد' } })
    expect(task.projectId).toBe(project.id)
    expect(task.assigneeId).toBe(assignee.id)
    expect(task.status).toBe('ASSIGNED')
    expect(task.taskValue.toFixed(2)).toBe('350.00')
    expect(task.categoryId).toBe('design')
  })

  it('يحافظ على النص العربي لعنوان المهمة ووصفها دون تشويه', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'roundtrip.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-TASKRT-1' })
    const title = 'إعداد الهوية البصرية الكاملة للعميل الجديد'
    const description = 'يشمل: الشعار، الألوان، الخط، ونماذج تطبيقية على القرطاسية'

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title,
        description,
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
      },
    ])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'tasks', buffer, actor }))

    const task = await db.task.findFirstOrThrow({ where: { title } })
    expect(task.title).toBe(title)
    expect(task.description).toBe(description)
  })

  it('يرفض صفًّا بكود مشروع غير موجود', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: 'PRJ-NO-SUCH-CODE',
        title: 'مهمة بلا مشروع',
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
      },
    ])

    const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]).toMatchObject({ field: 'projectCode' })
    expect(preview.rows[0]?.errors[0]?.message).toContain(
      ar.import.errors.unresolvedProject,
    )
  })

  it('يرفض إسناد المهمة لمستخدم معطّل الحساب', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'inactive.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-INACTIVE-1' })
    const inactive = await createUser(db, {
      username: 'inactive.assignee',
      isActive: false,
    })

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title: 'مهمة لمستخدم معطّل',
        categoryLabel: DESIGN_LABEL,
        assigneeUsername: inactive.username,
        dueDate: '2026-09-15',
      },
    ])

    const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]?.message).toContain(
      ar.import.errors.inactiveAssignee,
    )
  })

  it('يرفض تصنيفًا غير معروف ضمن قائمة الإعدادات', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'badcat.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-BADCAT-1' })

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title: 'تصنيف غير موجود',
        categoryLabel: 'تصنيف مختلق تمامًا',
        dueDate: '2026-09-15',
      },
    ])

    const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]?.message).toContain(ar.import.errors.invalidOption)
  })

  it('يستورد الصالح ويتجاهل غير الصالح من ملف مختلط، دون أي أثر جزئي', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'mixed.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MIXED-1' })

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title: 'مهمة صالحة',
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
      },
      {
        projectCode: 'PRJ-NOPE',
        title: 'مهمة غير صالحة',
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
      },
    ])

    const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
    expect(preview).toMatchObject({ totalRows: 2, toCreate: 1, invalid: 1 })

    const result = await db.$transaction((tx) =>
      confirmImport(tx, { entity: 'tasks', buffer, actor }),
    )
    expect(result).toEqual({ entity: 'tasks', created: 1, updated: 0, skipped: 1 })

    const count = await db.task.count()
    expect(count).toBe(1)
  })
})
