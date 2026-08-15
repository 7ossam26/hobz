import { describe, expect, it } from 'vitest'

import { createClientSchema, updateClientSchema } from '@/modules/client/schema'
import { listClients } from '@/modules/client/service'

import { createClient as createClientRow } from '../../factories/db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * Axis 1 — boundaries.
 *
 * Phone: `createClientSchema`/`updateClientSchema` both route `phone` through
 * `normalizeEgyptMobile` (`lib/phone`, already exhaustively boundary-tested at
 * that layer in `tests/unit/phone/phone.test.ts`). What is NOT yet proven is
 * that the *schema* actually surfaces those same boundaries as a validation
 * failure/success rather than silently passing something else through — that
 * wiring is what this section proves.
 */
describe('modules/client/schema — حدود التحقق من رقم الموبايل المصري', () => {
  it('يقبل رقمًا بطول 10 خانات وطنية بالضبط ويطبّعه إلى E.164', () => {
    const result = createClientSchema.safeParse({
      name: 'عميل',
      phone: '01012345678',
      notes: undefined,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.phone).toBe('+201012345678')
  })

  it('يرفض رقمًا أقصر بخانة واحدة من الطول الوطني الصحيح', () => {
    const result = createClientSchema.safeParse({
      name: 'عميل',
      phone: '0101234567', // 9 national digits, one short
      notes: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('يرفض رقمًا أطول بخانة واحدة من الطول الوطني الصحيح', () => {
    const result = createClientSchema.safeParse({
      name: 'عميل',
      phone: '010123456789', // 11 national digits, one long
      notes: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('يقبل كل بادئات الشبكات المصرية الأربع الحدّية (10، 11، 12، 15)', () => {
    for (const prefix of ['10', '11', '12', '15']) {
      const result = createClientSchema.safeParse({
        name: 'عميل',
        phone: `0${prefix}12345678`,
        notes: undefined,
      })
      expect(result.success, `prefix ${prefix}`).toBe(true)
    }
  })

  it('يرفض بادئة مجاورة غير مفعَّلة (13، بين 12 المقبولة و15 المقبولة)', () => {
    const result = createClientSchema.safeParse({
      name: 'عميل',
      phone: '01312345678',
      notes: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('updateClientSchema يطبّق نفس حدود الموبايل على التعديل', () => {
    const valid = updateClientSchema.safeParse({
      id: 'c1',
      name: 'عميل',
      phone: '01012345678',
      notes: undefined,
    })
    expect(valid.success).toBe(true)

    const invalid = updateClientSchema.safeParse({
      id: 'c1',
      name: 'عميل',
      phone: '0101234567', // one digit short
      notes: undefined,
    })
    expect(invalid.success).toBe(false)
  })

  it('حقل فارغ يُقرأ كـ"لم يُقدَّم" لا كرقم غير صالح', () => {
    const result = createClientSchema.safeParse({
      name: 'عميل',
      phone: '',
      notes: undefined,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.phone).toBeNull()
  })
})

describe('modules/client — حد صفحة الترقيم (pageSize) بالضبط', () => {
  it('صفحة تحتوي بالضبط pageSize من الصفوف: الصفحة الثانية فارغة', async () => {
    const PAGE_SIZE = 5
    for (let i = 0; i < PAGE_SIZE; i++) {
      await createClientRow(db, { name: `عميل صفحة أ ${i}` })
    }

    const page1 = await listClients(db, { page: 1, pageSize: PAGE_SIZE })
    expect(page1.items).toHaveLength(PAGE_SIZE)
    expect(page1.total).toBe(PAGE_SIZE)

    const page2 = await listClients(db, { page: 2, pageSize: PAGE_SIZE })
    expect(page2.items).toHaveLength(0)
    expect(page2.total).toBe(PAGE_SIZE)
  })

  it('pageSize + 1 من الصفوف: الصفحة الثانية تحتوي على صف واحد بالضبط', async () => {
    const PAGE_SIZE = 5
    for (let i = 0; i < PAGE_SIZE + 1; i++) {
      await createClientRow(db, { name: `عميل صفحة ب ${i}` })
    }

    const page2 = await listClients(db, { page: 2, pageSize: PAGE_SIZE })
    expect(page2.items).toHaveLength(1)
    expect(page2.total).toBe(PAGE_SIZE + 1)
  })
})
