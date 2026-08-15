import { describe, expect, it } from 'vitest'

import { listClients } from '@/modules/client/service'

import { createClient as createClientRow } from '../../factories/db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * docs/TESTING.md §4 axis 10: "name normalization in search (`احمد` finds
 * `أحمد`)".
 *
 * `listClients` searches with Prisma's `contains`/`mode: 'insensitive'`, which
 * compiles to a Postgres `ILIKE`. `ILIKE` case-folds but does not fold Arabic
 * orthographic variants — the exact gap `lib/search.ts` and its test suite
 * exist to close for the command palette. This file proves the same gap is
 * real for the clients list, and (once fixed) that it is closed the same way.
 */
describe('modules/client — البحث المتسامح مع اختلاف رسم الهمزة والألف', () => {
  it('يجد عميلًا مكتوبًا بالهمزة عند البحث بدونها والعكس', async () => {
    const withHamza = await createClientRow(db, { name: 'أحمد للتصميم' })
    const withoutHamza = await createClientRow(db, { name: 'احمد للطباعة' })
    // A completely different name must never surface for either spelling.
    await createClientRow(db, { name: 'شركة النيل للمقاولات' })

    // Typing the no-hamza spelling must find the client stored WITH hamza —
    // a literal Postgres `ILIKE '%احمد%'` cannot match "أحمد للتصميم" because
    // "أ" and "ا" are different bytes.
    const byBareAlef = await listClients(db, { search: 'احمد', page: 1, pageSize: 25 })
    expect(byBareAlef.items.map((c) => c.id)).toContain(withHamza.id)
    expect(byBareAlef.items.map((c) => c.id)).toContain(withoutHamza.id)

    // Typing the hamza spelling must find the client stored WITHOUT hamza —
    // the same gap in the other direction.
    const byHamza = await listClients(db, { search: 'أحمد', page: 1, pageSize: 25 })
    expect(byHamza.items.map((c) => c.id)).toContain(withHamza.id)
    expect(byHamza.items.map((c) => c.id)).toContain(withoutHamza.id)
  })

  it('لا يطابق اسمًا مختلفًا تمامًا', async () => {
    await createClientRow(db, { name: 'أحمد للتصميم' })
    const unrelated = await createClientRow(db, { name: 'مؤسسة الوفاء للنشر' })

    const page = await listClients(db, { search: 'احمد', page: 1, pageSize: 25 })
    expect(page.items.map((c) => c.id)).not.toContain(unrelated.id)
  })

  it('يطوي التاء المربوطة والألف المقصورة أيضًا', async () => {
    const client = await createClientRow(db, { name: 'شركة فاطمة للديكور' })

    const page = await listClients(db, { search: 'فاطمه', page: 1, pageSize: 25 })
    expect(page.items.map((c) => c.id)).toContain(client.id)
  })

  it('يقسّم النتائج المطابقة على الصفحات بشكل صحيح', async () => {
    for (let i = 0; i < 3; i += 1) {
      await createClientRow(db, { name: `أحمد ${i}` })
    }

    const firstPage = await listClients(db, { search: 'احمد', page: 1, pageSize: 2 })
    expect(firstPage.items).toHaveLength(2)
    expect(firstPage.total).toBe(3)

    const secondPage = await listClients(db, { search: 'احمد', page: 2, pageSize: 2 })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.total).toBe(3)
  })
})
