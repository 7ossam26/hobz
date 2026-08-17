import { describe, expect, it, vi } from 'vitest'

import type * as ClientService from '@/modules/client/service'

import { createUserWithPermissions, seedPermissionCatalog } from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { buildImportFixture } from '../../helpers/import-fixture'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * SPEC §10 / phase brief: "a guarantee that a failed import leaves zero rows
 * behind." `confirmImport` writes every valid row's `createX`/`updateX` call
 * inside the caller's transaction (`actions.ts` opens it) and never catches a
 * write failure itself — so if the *second* of two otherwise-valid rows fails
 * for a reason no pre-write validation could have caught (a genuine write-time
 * fault), the whole transaction, including the first row that had already
 * "succeeded", rolls back. Proven here by making the second `createClient`
 * call throw after the first ran for real.
 */
vi.mock('@/modules/client/service', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientService>()
  let calls = 0
  return {
    ...actual,
    createClient: vi.fn(async (...args: Parameters<typeof actual.createClient>) => {
      calls += 1
      if (calls === 2) throw new Error('عطل غير متوقع أثناء الكتابة — محاكاة اختبار')
      return actual.createClient(...args)
    }),
  }
})

const { confirmImport } = await import('@/modules/import/service')

async function importerActor() {
  await seedPermissionCatalog(db)
  const admin = await createUserWithPermissions(db, ['import.run'])
  return actorFor(db, admin.id)
}

describe('modules/import — ضمان عدم ترك أي أثر عند فشل الاستيراد', () => {
  it('لا يترك أي صف محفوظ حين يفشل الصف الثاني أثناء الكتابة الفعلية', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('clients', [
      { name: 'عميل سينجح ظاهريًا', phone: '', notes: '' },
      { name: 'عميل سيفشل فعليًا', phone: '', notes: '' },
    ])

    await expect(
      db.$transaction((tx) => confirmImport(tx, { entity: 'clients', buffer, actor })),
    ).rejects.toThrow('عطل غير متوقع أثناء الكتابة')

    const count = await db.client.count()
    expect(count).toBe(0)
  })
})
