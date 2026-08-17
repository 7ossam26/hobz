import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'

import { ar } from '@/i18n/ar'
import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'
import { readWorkbook } from '@/lib/xlsx'
import { importColumns } from '@/modules/import/columns'
import { IMPORT_ENTITIES } from '@/modules/import/schema'
import { buildImportTemplateWorkbook } from '@/modules/import/template'

import {
  createProject,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))

const { getImportTemplate } = await import('@/modules/import/queries')

const db = testDb()

describe('modules/import/template — القالب نفسه', () => {
  it.each(IMPORT_ENTITIES)(
    'يبني ورقة بيانات وورقة تعليمات وورقة معلومات القالب لكيان %s',
    async (entity) => {
      const buffer = await buildImportTemplateWorkbook(entity)
      const workbook = readWorkbook(buffer)

      expect(workbook.SheetNames).toEqual([
        ar.import.entities[entity],
        ar.import.instructions.sheetName,
        ar.import.meta.sheetName,
      ])

      const columns = await importColumns(entity)
      const dataSheet = workbook.Sheets[ar.import.entities[entity]]
      // Header row + exactly one sample row.
      const aoa = Object.keys(dataSheet ?? {}).filter((key) => /^[A-Z]+2$/.test(key))
      expect(aoa.length).toBe(columns.length)
    },
  )

  it('يضيف قائمة منسدلة حقيقية لعمود اختياري من متعدد (نوع الأجر للمستخدمين)', async () => {
    const buffer = await buildImportTemplateWorkbook('users')
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('xl/worksheets/sheet1.xml')?.async('string')
    expect(xml).toContain('<dataValidations')
    expect(xml).toContain(Object.values(ar.enums.payType).join(','))
  })

  it('صف العينة نفسه صف صالح قابل للاستيراد فعليًا — لا بيانات وهمية', async () => {
    const owner = await createUser(db, { username: 'ahmed.hassan' })
    await createProject(db, { ownerId: owner.id, code: 'PRJ-0001' })

    const { previewImport } = await import('@/modules/import/service')
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['import.run'])
    const actor = await actorFor(db, admin.id)

    const buffer = await buildImportTemplateWorkbook('tasks')
    const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
    expect(preview).toMatchObject({ totalRows: 1, toCreate: 1, invalid: 0 })
  })

  it('يمنع تنزيل القالب لمن لم يسجّل الدخول', async () => {
    clearSessionActor()
    await expect(getImportTemplate('users')).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('يمنع تنزيل القالب لمن لا يملك صلاحية import.run', async () => {
    await seedPermissionCatalog(db)
    const noPermission = await createUserWithPermissions(db, ['client.view'])
    setSessionActor(await actorFor(db, noPermission.id))

    await expect(getImportTemplate('users')).rejects.toBeInstanceOf(ForbiddenError)
    clearSessionActor()
  })
})
