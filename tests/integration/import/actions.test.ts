import { describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'

import { createUserWithPermissions, seedPermissionCatalog } from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { buildForeignWorkbook, buildImportFixture } from '../../helpers/import-fixture'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const { confirmImportAction, previewImportAction } =
  await import('@/modules/import/actions')

const db = testDb()

function fileFormData(entity: string, buffer: Buffer, filename = 'file.xlsx'): FormData {
  const formData = new FormData()
  formData.set('entity', entity)
  formData.set(
    'file',
    new File([new Uint8Array(buffer)], filename, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
  return formData
}

describe('modules/import/actions — الصلاحية أولًا، ثم القيمة لا الرمي عبر حدود الـ Server Action', () => {
  it('يرفض مستخدمًا غير مُسجَّل دخول ولا يكتب شيئًا', async () => {
    clearSessionActor()
    const buffer = await buildImportFixture('clients', [
      { name: 'x', phone: '', notes: '' },
    ])
    await expect(
      previewImportAction(fileFormData('clients', buffer)),
    ).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('يرفض مستخدمًا لا يملك صلاحية import.run، ولا يكتب شيئًا عند التأكيد', async () => {
    await seedPermissionCatalog(db)
    const noPermission = await createUserWithPermissions(db, ['client.view'])
    setSessionActor(await actorFor(db, noPermission.id))

    const buffer = await buildImportFixture('clients', [
      { name: 'عميل ممنوع', phone: '', notes: '' },
    ])

    await expect(
      previewImportAction(fileFormData('clients', buffer)),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      confirmImportAction(fileFormData('clients', buffer)),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await db.client.count()).toBe(0)
    clearSessionActor()
  })

  it('يعيد معاينة صحيحة، ثم يؤكد الاستيراد فعليًا، لمالك صلاحية import.run', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['import.run'])
    setSessionActor(await actorFor(db, admin.id))

    const buffer = await buildImportFixture('clients', [
      { name: 'عميل عبر الإجراء', phone: '', notes: '' },
    ])

    const preview = await previewImportAction(fileFormData('clients', buffer))
    expect(preview).toMatchObject({ ok: true, preview: { toCreate: 1, invalid: 0 } })

    const confirmed = await confirmImportAction(fileFormData('clients', buffer))
    expect(confirmed).toMatchObject({ ok: true, result: { created: 1 } })

    expect(await db.client.count({ where: { name: 'عميل عبر الإجراء' } })).toBe(1)
    clearSessionActor()
  })

  it('يعيد رسالة {ok:false} بدل رمي استثناء حين لا يُرفق ملف', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['import.run'])
    setSessionActor(await actorFor(db, admin.id))

    const formData = new FormData()
    formData.set('entity', 'clients')

    const result = await previewImportAction(formData)
    expect(result).toEqual({ ok: false, messageKey: 'import.errors.fileRequired' })
    clearSessionActor()
  })

  it('يعيد رسالة {ok:false} بدل رمي استثناء عبر حدود الإجراء حين لا يطابق الملف القالب', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['import.run'])
    setSessionActor(await actorFor(db, admin.id))

    const buffer = await buildForeignWorkbook()
    const result = await previewImportAction(fileFormData('clients', buffer))
    expect(result).toMatchObject({ ok: false, messageKey: 'import.errors.wrongTemplate' })
    clearSessionActor()
  })
})
