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

const DESIGN_LABEL = 'تصميم' // `tasks.categories` default (lib/settings/catalog.ts → i18n/ar.ts `defaults.taskCategories`)

/**
 * docs/TESTING.md §4 axis 10 (Arabic) — the database half.
 *
 * `src/lib/search.ts` folds alef/hamza variants, ta-marbuta, diacritics, etc.
 * so `احمد` finds a record stored as `أحمد` everywhere else in the product.
 * `modules/import/resolve.ts#findClientByName` deliberately does an exact
 * Prisma `where: { name }` match instead — no folding. The two tests below
 * prove that both directions of that behaviour actually hold (exact match
 * resolves, a one-diacritic near-miss does not silently resolve), and the
 * rest of the file proves that whatever text a person types survives the
 * write → confirm → read-back round trip byte-for-byte, and that a
 * length boundary is enforced by character count, not UTF-8 byte count.
 */
describe('modules/import — العربية: حل الأسماء بلا طيّ، وسلامة النص عند الحفظ الفعلي', () => {
  it('يطابق استيراد المشاريع اسم عميل مطابقًا حرفيًا تمامًا (نفس الهمزة) وينجح', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'exactmatch.owner' })
    const client = await createClient(db, { name: 'أحمد للمقاولات' })

    const buffer = await buildImportFixture('projects', [
      {
        name: 'مشروع مطابقة حرفية',
        clientName: 'أحمد للمقاولات',
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
    const row = await db.project.findFirstOrThrow({
      where: { name: 'مشروع مطابقة حرفية' },
    })
    expect(row.clientId).toBe(client.id)
  })

  it('لا يطابق استيراد المشاريع اسم عميل يختلف بالهمزة فقط عن الاسم المخزَّن — الاستيراد لا يطوي النص كبحث النظام', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'nofold.owner' })
    await createClient(db, { name: 'أحمد للمقاولات' }) // بهمزة على الألف، كما يُكتب رسميًا

    const buffer = await buildImportFixture('projects', [
      {
        name: 'مشروع بلا طيّ',
        clientName: 'احمد للمقاولات', // بدون همزة — الشكل الذي يكتبه معظم المستخدمين فعليًا
        ownerUsername: owner.username,
        engagementType: ar.enums.engagementType.HOURLY,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      },
    ])

    const preview = await previewImport(db, { entity: 'projects', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]).toMatchObject({ field: 'clientName' })
    expect(preview.rows[0]?.errors[0]?.message).toContain(
      ar.import.errors.unresolvedClient,
    )
  })

  it('يحافظ على التشكيل الكامل لاسم وملاحظات العميل دون حذف عند الحفظ الفعلي في قاعدة البيانات', async () => {
    const actor = await importerActor()
    const name = 'شَرِكَةُ الأَمَلِ الجَدِيد'
    const notes = 'يُفضَّلُ التَّواصُلُ صَباحًا، وتُجابُ المُكالَماتُ خِلالَ ساعَتَين'
    const buffer = await buildImportFixture('clients', [{ name, phone: '', notes }])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'clients', buffer, actor }))

    const row = await db.client.findFirstOrThrow({ where: { name } })
    expect(row.name).toBe(name)
    expect(row.notes).toBe(notes)
  })

  it('يحافظ على نص عميل يمزج بين العربية وكلمة إنجليزية ورقم هاتف عند الحفظ الفعلي', async () => {
    const actor = await importerActor()
    const name = 'عميل واتساب'
    const notes =
      'التواصل من الساعة 9 صباحًا حتى 5 مساءً، أو عبر WhatsApp على 01012345678'
    const buffer = await buildImportFixture('clients', [{ name, phone: '', notes }])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'clients', buffer, actor }))

    const row = await db.client.findFirstOrThrow({ where: { name } })
    expect(row.notes).toBe(notes)
  })

  it('يحافظ على علامتَي الاتجاه الثنائي وحرف التطويل دون تغيير عند الحفظ الفعلي', async () => {
    const actor = await importerActor()
    const RLM = '‏'
    const LRM = '‎'
    const name = `شركة النور${RLM} للتجارة${LRM} والتوزيع`
    const notes = 'الاســـم الممـــدود بالتطويل لأغراض التنسيق'
    const buffer = await buildImportFixture('clients', [{ name, phone: '', notes }])

    await db.$transaction((tx) => confirmImport(tx, { entity: 'clients', buffer, actor }))

    const row = await db.client.findFirstOrThrow({ where: { name } })
    expect(row.name).toBe(name)
    expect(row.notes).toBe(notes)
  })

  it('يرفض اسم مستخدم مكتوبًا بحروف عربية برسالة تنسيق اسم المستخدم القياسية، لا رسالة خاصة بالاستيراد', async () => {
    const actor = await importerActor()
    const buffer = await buildImportFixture('users', [
      {
        username: 'أحمد', // حروف عربية — مرفوضة بتصميم lib/auth/username.ts (لاتينية فقط)
        fullName: 'أحمد حسن',
        password: 'Passw0rd123',
        isWorker: ar.common.no,
      },
    ])

    const preview = await previewImport(db, { entity: 'users', buffer, actor })
    expect(preview.invalid).toBe(1)
    expect(preview.rows[0]?.errors[0]).toMatchObject({ field: 'username' })
    expect(preview.rows[0]?.errors[0]?.message).toContain(ar.validation.usernameFormat)
  })

  it('يقبل اسم عميل عربيًا بطول ١٦٠ حرفًا بالضبط، ويرفض ١٦١ حرفًا — العدّ بعدد الحروف لا بعدد بايتات UTF-8', async () => {
    const actor = await importerActor()
    // كل حرف عربي هنا يشغل بايتين في UTF-8؛ فحصٌ ساذج بعدد البايتات كان سيرفض
    // نصًا عربيًا أقصر بكثير من الحد الحقيقي. `.max(160)` في Zod يقيس
    // `string.length` (وحدات UTF-16)، وهي هنا مطابقة تمامًا لعدد الأحرف.
    const exactly160 = 'أ'.repeat(160)
    const exactly161 = 'أ'.repeat(161)

    const buffer = await buildImportFixture('clients', [
      { name: exactly160, phone: '', notes: '' },
      { name: exactly161, phone: '', notes: '' },
    ])

    const preview = await previewImport(db, { entity: 'clients', buffer, actor })
    expect(preview.rows[0]).toMatchObject({ action: 'create', errors: [] })
    expect(preview.rows[1]?.action).toBe('invalid')
    expect(preview.rows[1]?.errors.some((error) => error.field === 'name')).toBe(true)
  })

  it('يقبل عنوان مهمة عربيًا بطول ٢٠٠ حرف بالضبط، ويرفض ٢٠١ حرفًا — نفس قاعدة العدّ بالحروف', async () => {
    const actor = await importerActor()
    const owner = await createUser(db, { username: 'titlelen.owner' })
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-TITLELEN-1' })
    const exactly200 = 'ب'.repeat(200)
    const exactly201 = 'ب'.repeat(201)

    const buffer = await buildImportFixture('tasks', [
      {
        projectCode: project.code,
        title: exactly200,
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
      },
      {
        projectCode: project.code,
        title: exactly201,
        categoryLabel: DESIGN_LABEL,
        dueDate: '2026-09-15',
      },
    ])

    const preview = await previewImport(db, { entity: 'tasks', buffer, actor })
    expect(preview.rows[0]).toMatchObject({ action: 'create', errors: [] })
    expect(preview.rows[1]?.action).toBe('invalid')
    expect(preview.rows[1]?.errors.some((error) => error.field === 'title')).toBe(true)
  })
})
