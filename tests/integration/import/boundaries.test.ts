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

/**
 * docs/TESTING.md §4 axis 1 (Boundaries) for the import pipeline — the
 * schema-boundary and count-boundary cases that need a real database
 * (Settings-backed enum resolution, foreign-key resolution, existing rows to
 * collide with). File-size/row-count/row-numbering/template-version
 * boundaries live in `tests/unit/import/parse-boundaries.test.ts`, which need
 * no database at all.
 */

const db = testDb()

async function importerActor() {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, ['import.run'])
  return actorFor(db, admin.id)
}

const DESIGN_LABEL = 'تصميم' // `tasks.categories` default (same fixture tasks.test.ts uses)

describe('modules/import — حدود القيم داخل الصف الواحد', () => {
  describe('ساعات الطاقة الأسبوعية للمستخدم (weeklyCapacityHours)', () => {
    it('يقبل الحدَّين الأدنى ١ والأقصى ١٦٨ لساعات الطاقة الأسبوعية', async () => {
      const actor = await importerActor()
      const buffer = await buildImportFixture('users', [
        {
          username: 'cap.min',
          fullName: 'عند الحد الأدنى',
          password: 'Passw0rd123',
          isWorker: ar.common.no,
          weeklyCapacityHours: '1',
        },
        {
          username: 'cap.max',
          fullName: 'عند الحد الأقصى',
          password: 'Passw0rd123',
          isWorker: ar.common.no,
          weeklyCapacityHours: '168',
        },
      ])

      const preview = await previewImport(db, { entity: 'users', buffer, actor })
      expect(preview).toMatchObject({ toCreate: 2, invalid: 0 })
    })

    it('يرفض ٠ و١٦٩ باعتبارهما خارج مدى ساعات الطاقة الأسبوعية المسموح', async () => {
      const actor = await importerActor()
      const buffer = await buildImportFixture('users', [
        {
          username: 'cap.under',
          fullName: 'أقل من الحد',
          password: 'Passw0rd123',
          isWorker: ar.common.no,
          weeklyCapacityHours: '0',
        },
        {
          username: 'cap.over',
          fullName: 'أكثر من الحد',
          password: 'Passw0rd123',
          isWorker: ar.common.no,
          weeklyCapacityHours: '169',
        },
      ])

      const preview = await previewImport(db, { entity: 'users', buffer, actor })
      expect(preview).toMatchObject({ toCreate: 0, invalid: 2 })
      expect(preview.rows[0]?.errors[0]).toMatchObject({ field: 'weeklyCapacityHours' })
      expect(preview.rows[0]?.errors[0]?.message).toContain(ar.validation.capacityRange)
      expect(preview.rows[1]?.errors[0]).toMatchObject({ field: 'weeklyCapacityHours' })
      expect(preview.rows[1]?.errors[0]?.message).toContain(ar.validation.capacityRange)
    })
  })

  describe('الساعات المقدَّرة للمهمة (estimatedHours)', () => {
    it('يقبل ٠ والحد الأقصى ٩٩٩٩ لساعات المهمة المقدَّرة', async () => {
      const actor = await importerActor()
      const owner = await createUser(db, { username: 'est.owner.valid' })
      const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-EST-OK' })

      const buffer = await buildImportFixture('tasks', [
        {
          projectCode: project.code,
          title: 'مهمة بصفر ساعات',
          categoryLabel: DESIGN_LABEL,
          dueDate: '2026-09-15',
          estimatedHours: '0',
        },
        {
          projectCode: project.code,
          title: 'مهمة عند الحد الأقصى للساعات',
          categoryLabel: DESIGN_LABEL,
          dueDate: '2026-09-15',
          estimatedHours: '9999',
        },
      ])

      const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
      expect(preview).toMatchObject({ toCreate: 2, invalid: 0 })
    })

    it('يرفض قيمة تتجاوز الحد الأقصى، وقيمة بثلاث خانات عشرية لساعات المهمة', async () => {
      const actor = await importerActor()
      const owner = await createUser(db, { username: 'est.owner.invalid' })
      const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-EST-BAD' })

      const buffer = await buildImportFixture('tasks', [
        {
          projectCode: project.code,
          title: 'مهمة تتجاوز الحد الأقصى للساعات',
          categoryLabel: DESIGN_LABEL,
          dueDate: '2026-09-15',
          estimatedHours: '10000',
        },
        {
          projectCode: project.code,
          title: 'مهمة بثلاث خانات عشرية في الساعات',
          categoryLabel: DESIGN_LABEL,
          dueDate: '2026-09-15',
          estimatedHours: '5.123',
        },
      ])

      const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
      expect(preview).toMatchObject({ toCreate: 0, invalid: 2 })
      expect(preview.rows[0]?.errors.some((e) => e.field === 'estimatedHours')).toBe(true)
      expect(
        preview.rows[1]?.errors.some(
          (e) =>
            e.field === 'estimatedHours' &&
            e.message.includes(ar.validation.amountFormat),
        ),
      ).toBe(true)
    })
  })

  describe('صيغة المبلغ المالي (defaultTaskRate — عمود من نوع money)', () => {
    it('يقبل مبلغًا بخانتين عشريتين بالضبط ويرفض المبلغ نفسه بثلاث خانات', async () => {
      const actor = await importerActor()
      const buffer = await buildImportFixture('users', [
        {
          username: 'rate.two.dp',
          fullName: 'سعر بخانتين عشريتين',
          password: 'Passw0rd123',
          isWorker: ar.common.yes,
          payType: ar.enums.payType.PER_TASK,
          defaultTaskRate: '100.12',
        },
        {
          username: 'rate.three.dp',
          fullName: 'سعر بثلاث خانات عشرية',
          password: 'Passw0rd123',
          isWorker: ar.common.yes,
          payType: ar.enums.payType.PER_TASK,
          defaultTaskRate: '100.123',
        },
      ])

      const preview = await previewImport(db, { entity: 'users', buffer, actor })
      expect(preview).toMatchObject({ toCreate: 1, invalid: 1 })
      expect(preview.rows[0]?.action).toBe('create')
      expect(preview.rows[1]?.errors[0]).toMatchObject({ field: 'defaultTaskRate' })
      expect(preview.rows[1]?.errors[0]?.message).toContain(ar.validation.amountFormat)
    })
  })

  describe('طول كود المشروع (Project.code، الحد الأقصى ٤٠ حرفًا)', () => {
    it('يقبل كودًا طوله ٤٠ حرفًا بالضبط ويرفض كودًا طوله ٤١ حرفًا', async () => {
      const actor = await importerActor()
      const owner = await createUser(db, { username: 'code.length.owner' })
      const code40 = 'A'.repeat(40)
      const code41 = 'B'.repeat(41)

      const buffer = await buildImportFixture('projects', [
        {
          code: code40,
          name: 'مشروع بكود عند الحد الأقصى للطول',
          ownerUsername: owner.username,
          engagementType: ar.enums.engagementType.HOURLY,
          startDate: '2026-01-01',
          dueDate: '2026-02-01',
        },
        {
          code: code41,
          name: 'مشروع بكود أطول من الحد المسموح',
          ownerUsername: owner.username,
          engagementType: ar.enums.engagementType.HOURLY,
          startDate: '2026-01-01',
          dueDate: '2026-02-01',
        },
      ])

      const preview = await previewImport(db, { entity: 'projects', buffer, actor })
      expect(preview).toMatchObject({ toCreate: 1, invalid: 1 })
      expect(preview.rows[0]?.action).toBe('create')
      expect(preview.rows[1]?.errors.some((e) => e.field === 'code')).toBe(true)

      await db.$transaction((tx) =>
        confirmImport(tx, { entity: 'projects', buffer, actor }),
      )
      const created = await db.project.findFirstOrThrow({ where: { code: code40 } })
      expect(created.code).toHaveLength(40)
    })
  })

  describe('اسم مستخدم مكرر أكثر من مرتين داخل نفس الملف', () => {
    // The exactly-2-duplicates case (second row flagged, first creates) is
    // already covered by tests/integration/import/users.test.ts. This proves
    // the same rule scales past the first repeat: with the SAME username on
    // three rows, both the second AND the third must be flagged, and the
    // first must still create — nothing about `seen.add()` should let a
    // third occurrence slip through as "not seen yet".
    it('يرفض الصفين الثاني والثالث معًا حين يتكرر اسم المستخدم ثلاث مرات، وينشئ الصف الأول فقط', async () => {
      const actor = await importerActor()
      const buffer = await buildImportFixture('users', [
        {
          username: 'triple.dup',
          fullName: 'الصف الأول',
          password: 'Passw0rd123',
          isWorker: ar.common.no,
        },
        {
          username: 'triple.dup',
          fullName: 'الصف الثاني',
          password: 'Passw0rd123',
          isWorker: ar.common.no,
        },
        {
          username: 'triple.dup',
          fullName: 'الصف الثالث',
          password: 'Passw0rd123',
          isWorker: ar.common.no,
        },
      ])

      const preview = await previewImport(db, { entity: 'users', buffer, actor })
      expect(preview).toMatchObject({ toCreate: 1, invalid: 2 })
      expect(preview.rows[0]?.action).toBe('create')
      expect(preview.rows[1]?.errors[0]?.message).toContain(
        ar.import.errors.duplicateInFile,
      )
      expect(preview.rows[2]?.errors[0]?.message).toContain(
        ar.import.errors.duplicateInFile,
      )

      const result = await db.$transaction((tx) =>
        confirmImport(tx, { entity: 'users', buffer, actor }),
      )
      expect(result).toEqual({ entity: 'users', created: 1, updated: 0, skipped: 2 })

      const rows = await db.user.findMany({ where: { username: 'triple.dup' } })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.fullName).toBe('الصف الأول')
    })
  })

  describe('تطابق اسم العميل مع أكثر من صفَّين', () => {
    // `resolve.ts`'s `findClientByName` caps its query at `take: 2` purely to
    // distinguish "one match" from "more than one" cheaply. This proves that
    // cap does not silently misreport three real matches as merely "two" —
    // it must still resolve as 'ambiguous', the same outcome as two matches.
    it('يُصنَّف حلّ اسم العميل بأنه غامض أيضًا حين يطابقه ثلاثة عملاء لا اثنان فقط', async () => {
      const actor = await importerActor()
      const owner = await createUser(db, { username: 'ambiguous.triple.owner' })
      await createClient(db, { name: 'اسم مكرر ثلاثًا' })
      await createClient(db, { name: 'اسم مكرر ثلاثًا' })
      await createClient(db, { name: 'اسم مكرر ثلاثًا' })

      const buffer = await buildImportFixture('projects', [
        {
          name: 'مشروع بعميل غامض ثلاثيًا',
          clientName: 'اسم مكرر ثلاثًا',
          ownerUsername: owner.username,
          engagementType: ar.enums.engagementType.HOURLY,
          startDate: '2026-01-01',
          dueDate: '2026-02-01',
        },
      ])

      const preview = await previewImport(db, { entity: 'projects', buffer, actor })
      expect(preview.invalid).toBe(1)
      expect(preview.rows[0]?.errors[0]?.message).toContain(
        ar.import.errors.ambiguousClient,
      )
    })
  })
})
