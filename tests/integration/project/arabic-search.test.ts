import { describe, expect, it } from 'vitest'

import { getProjectFacetOptions, listProjects } from '@/modules/project/service'

import {
  createClient as createClientRow,
  createProject as createProjectRow,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { testDb } from '../../setup/reset'

const db = testDb()

const THRESHOLDS = {
  overdueTasksThreshold: 3,
  blockedDaysThreshold: 3,
  amberDaysBeforeDue: 3,
}

async function list(search: string, page = 1, pageSize = 25) {
  return listProjects(db, {
    scope: {},
    filters: { search, page, pageSize },
    now: new Date('2026-03-01T00:00:00Z'),
    thresholds: THRESHOLDS,
  })
}

/**
 * docs/TESTING.md §4 axis 10, project's own copy of the same gap covered in
 * tests/integration/client/arabic-search.test.ts. `listProjects` ORs the
 * search term across `name` and `code` with Prisma `contains`/`insensitive`
 * (Postgres `ILIKE`), which folds case but not Arabic orthographic variants.
 */
describe('modules/project — البحث المتسامح مع اختلاف رسم الهمزة والألف', () => {
  it('يجد مشروعًا مكتوبًا بالهمزة عند البحث بدونها والعكس', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const withHamza = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-AR-1',
      name: 'موقع أحمد الإلكتروني',
    })
    const withoutHamza = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-AR-2',
      name: 'هوية احمد البصرية',
    })
    await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-AR-3',
      name: 'تطبيق شركة النيل',
    })

    const byBareAlef = await list('احمد')
    expect(byBareAlef.items.map((p) => p.id)).toContain(withHamza.id)
    expect(byBareAlef.items.map((p) => p.id)).toContain(withoutHamza.id)

    const byHamza = await list('أحمد')
    expect(byHamza.items.map((p) => p.id)).toContain(withHamza.id)
    expect(byHamza.items.map((p) => p.id)).toContain(withoutHamza.id)
  })

  it('لا يطابق اسمًا مختلفًا تمامًا', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-AR-4',
      name: 'موقع أحمد الإلكتروني',
    })
    const unrelated = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-AR-5',
      name: 'منصة التدريب الداخلي',
    })

    const page = await list('احمد')
    expect(page.items.map((p) => p.id)).not.toContain(unrelated.id)
  })

  it('لا يزال يبحث بالكود أيضًا، دون حساسية لحالة الأحرف', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const project = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'ACME-01',
      name: 'مشروع بلا صلة بالبحث',
    })

    const page = await list('acme')
    expect(page.items.map((p) => p.id)).toContain(project.id)
  })

  it('يقسّم النتائج المطابقة على الصفحات بشكل صحيح ويحترم النطاق (scope)', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    for (let i = 0; i < 3; i += 1) {
      await createProjectRow(db, {
        ownerId: owner.id,
        code: `PRJ-PG-${i}`,
        name: `أحمد ${i}`,
      })
    }
    // Out of scope: must never appear, matching search term or not.
    const otherOwner = await createUserWithPermissions(db, ['project.view.all'])
    await createProjectRow(db, {
      ownerId: otherOwner.id,
      code: 'PRJ-PG-OUT',
      name: 'أحمد خارج النطاق',
    })

    const scoped = await listProjects(db, {
      scope: { ownerId: owner.id },
      filters: { search: 'احمد', page: 1, pageSize: 2 },
      now: new Date('2026-03-01T00:00:00Z'),
      thresholds: THRESHOLDS,
    })
    expect(scoped.items).toHaveLength(2)
    expect(scoped.total).toBe(3)

    const secondPage = await listProjects(db, {
      scope: { ownerId: owner.id },
      filters: { search: 'احمد', page: 2, pageSize: 2 },
      now: new Date('2026-03-01T00:00:00Z'),
      thresholds: THRESHOLDS,
    })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.total).toBe(3)
  })
})

/**
 * docs/TESTING.md §4 axis 10 also covers collation, not just search:
 * `getProjectFacetOptions` (owner/client names) and `getProject` (member
 * names) both order Arabic strings with `localeCompare(..., 'ar')`. A plain
 * `Array.prototype.sort()` with no locale compares raw UTF-16 code units
 * instead, which gets ordinary letters right by coincidence (the base Arabic
 * letters happen to sit in roughly alphabetical order in Unicode) but breaks
 * on alef variants: `ٱ` (alef wasla, U+0671 — one of the letters
 * `lib/search.ts`'s fold table already treats as "ا", so real data can
 * contain it) sits *after* nearly the whole alphabet by code point even
 * though it is alphabetically the very first letter. `localeCompare('ar')`
 * gets this right; a code-point sort does not.
 */
describe('modules/project — الترتيب الأبجدي العربي لأسماء العملاء', () => {
  it('يرتّب أسماء العملاء ترتيبًا أبجديًا عربيًا صحيحًا، لا بترتيب رموز يونيكود', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])

    const alefWasla = await createClientRow(db, { name: 'ٱحمد للدهانات' })
    const ba = await createClientRow(db, { name: 'بلال للمقاولات' })
    const waw = await createClientRow(db, { name: 'ولاء للتوريدات' })

    await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-SORT-1',
      clientId: alefWasla.id,
    })
    await createProjectRow(db, { ownerId: owner.id, code: 'PRJ-SORT-2', clientId: ba.id })
    await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-SORT-3',
      clientId: waw.id,
    })

    // Raw code-point order would be [بلال, ولاء, ٱحمد] — "ٱ" (U+0671) sorts
    // after "و" (U+0648) despite being alphabetically first. Confirms the
    // naive sort really would get this wrong, so the assertion below is
    // proving something, not restating a tautology.
    const naiveOrder = [ba.name, waw.name, alefWasla.name].slice().sort()
    expect(naiveOrder).toEqual([ba.name, waw.name, alefWasla.name])

    const facets = await getProjectFacetOptions(db, { ownerId: owner.id })
    expect(facets.clients.map((c) => c.id)).toEqual([alefWasla.id, ba.id, waw.id])
  })
})
