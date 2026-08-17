import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { cellEnumValue, cellOptionalText } from '@/modules/import/cells'
import { importColumns } from '@/modules/import/columns'
import { parseImportFile } from '@/modules/import/parse'

import { buildImportFixture } from '../../helpers/import-fixture'

/**
 * docs/TESTING.md §4 axis 10 (Arabic) — the parse-only half.
 *
 * Everything here exercises `parseImportFile` (and the pure `cells.ts`
 * helpers built on top of it) directly, with no database involved: diacritics,
 * mixed RTL/LTR content, bidi control marks, tatweel, and dropdown-value
 * whitespace all have to survive a raw SheetJS read completely unchanged
 * before any entity-specific logic in `service.ts` ever sees them.
 */
describe('modules/import/parse — سلامة النص العربي عبر القراءة الخام', () => {
  it('يحافظ على التشكيل الكامل (الفتحة والضمة والكسرة والسكون) دون حذف عبر القراءة', async () => {
    const columns = await importColumns('clients')
    const name = 'شَرِكَةُ الأَهْرَامِ المُتَّحِدَة'
    const notes = 'يُفضَّلُ التَّواصُلُ صَباحًا قَبْلَ السَّاعةِ العاشِرة'
    const buffer = await buildImportFixture('clients', [{ name, phone: '', notes }])

    const { rows } = parseImportFile('clients', buffer, columns)

    expect(rows[0]?.cells.name).toBe(name)
    expect(rows[0]?.cells.notes).toBe(notes)
  })

  it('يحافظ على نص عربي يتضمن كلمة إنجليزية ورقم هاتف وأرقامًا غربية داخل السطر دون أي تغيير', async () => {
    const columns = await importColumns('clients')
    const notes =
      'التواصل من الساعة 9 صباحًا حتى 5 مساءً، أو عبر WhatsApp على 01012345678'
    const buffer = await buildImportFixture('clients', [
      { name: 'عميل التواصل المختلط', phone: '', notes },
    ])

    const { rows } = parseImportFile('clients', buffer, columns)

    expect(rows[0]?.cells.notes).toBe(notes)
  })

  it('لا يحذف علامتَي الاتجاه الثنائي RLM وLRM المضمَّنتين داخل النص العربي', async () => {
    const columns = await importColumns('clients')
    const RLM = '‏'
    const LRM = '‎'
    const name = `شركة النور${RLM} للتجارة${LRM} والتوزيع`
    const buffer = await buildImportFixture('clients', [{ name, phone: '', notes: '' }])

    const { rows } = parseImportFile('clients', buffer, columns)

    expect(rows[0]?.cells.name).toBe(name)
    expect(String(rows[0]?.cells.name)).toContain(RLM)
    expect(String(rows[0]?.cells.name)).toContain(LRM)
  })

  it('لا يُشوَّه حرف التطويل (ـ) الموجود داخل النص عبر القراءة', async () => {
    const columns = await importColumns('clients')
    const notes = 'الاســـم الممـــدود بالتطويل لأغراض التنسيق'
    const buffer = await buildImportFixture('clients', [
      { name: 'عميل التطويل', phone: '', notes },
    ])

    const { rows } = parseImportFile('clients', buffer, columns)

    expect(rows[0]?.cells.notes).toBe(notes)
  })

  it('يقصّ المسافات الزائدة حول قيمة قائمة منسدلة عربية قبل مطابقتها بالخيار الصحيح', async () => {
    const columns = await importColumns('users')
    const payTypeColumn = columns.find((column) => column.key === 'payType')
    if (!payTypeColumn) throw new Error('عمود نوع الأجر غير موجود ضمن قالب المستخدمين')

    const padded = `  ${ar.enums.payType.PER_TASK}  `
    const buffer = await buildImportFixture('users', [
      {
        username: 'padded.dropdown',
        fullName: 'مستخدم بمسافات',
        password: 'Passw0rd123',
        payType: padded,
      },
    ])

    const { rows } = parseImportFile('users', buffer, columns)
    const rawCell = rows[0]?.cells.payType

    // الخلية الخام كما قرأها SheetJS ما زالت تحمل المسافات — القصّ لم يحدث بعد هنا.
    expect(rawCell).toBe(padded)
    // `cellOptionalText` يقصّ المسافات أولًا…
    expect(cellOptionalText(rawCell)).toBe(ar.enums.payType.PER_TASK)
    // …وهذا القصّ هو ما يجعل `cellEnumValue` يطابق الخيار الصحيح رغم المسافات.
    expect(cellEnumValue(payTypeColumn, rawCell)).toBe('PER_TASK')
  })
})
