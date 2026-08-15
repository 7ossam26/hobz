import { describe, expect, it } from 'vitest'

import { auditFilterSchema } from '@/modules/audit/schema'
import { buildAuditWhere, diffAuditEntry } from '@/modules/audit/service'

/**
 * docs/TESTING.md §4 axis 12, applied to the audit log.
 *
 * Every field on an audit row except `action`, `entity` and `entityId` is
 * nullable, and the scheduler writes rows with no actor at all. The viewer has
 * to render all of that without printing "null" at a manager investigating a
 * deduction.
 */

describe('modules/audit — الفرق على الحمولات الفارغة', () => {
  it('لا ينتج فرقًا حين لا توجد حمولة إطلاقًا', () => {
    expect(diffAuditEntry({ before: undefined, after: undefined })).toEqual([])
    expect(diffAuditEntry({ before: null, after: null })).toEqual([])
    expect(diffAuditEntry({ before: {}, after: {} })).toEqual([])
  })

  it('يتجاهل الحمولات غير الكائنية بدل أن ينهار', () => {
    // `redact` passes scalars straight through, so a caller could store a
    // string or a number. The diff must degrade, not throw.
    expect(diffAuditEntry({ before: 'نص', after: 'نص آخر' })).toEqual([])
    expect(diffAuditEntry({ before: 42, after: 43 })).toEqual([])
    expect(diffAuditEntry({ before: [], after: [] })).toEqual([])
  })

  it('يعرض الحقول الفارغة كتغيير حين تتغيّر فعلًا', () => {
    // "phone cleared" is a real event and must be visible; "phone was never
    // set and still is not" is not.
    expect(
      diffAuditEntry({ before: { phone: '+201012345678' }, after: { phone: null } }),
    ).toEqual([{ field: 'phone', kind: 'changed', before: '+201012345678', after: null }])
    expect(diffAuditEntry({ before: { phone: null }, after: { phone: null } })).toEqual(
      [],
    )
  })

  it('يميّز الحقل الغائب عن الحقل الفارغ', () => {
    // `{}` → `{ phone: null }` is "the field appeared, empty". Collapsing the
    // two would hide a schema change from the log.
    expect(diffAuditEntry({ before: {}, after: { phone: null } })).toEqual([
      { field: 'phone', kind: 'added', before: undefined, after: null },
    ])
  })

  it('يتعامل مع القوائم الفارغة', () => {
    expect(diffAuditEntry({ before: { roles: [] }, after: { roles: [] } })).toEqual([])
    expect(
      diffAuditEntry({ before: { roles: [] }, after: { roles: ['r1'] } }),
    ).toHaveLength(1)
    expect(
      diffAuditEntry({ before: { roles: ['r1'] }, after: { roles: [] } }),
    ).toHaveLength(1)
  })

  it('يعتبر السلسلة الفارغة قيمة لا غيابًا', () => {
    expect(diffAuditEntry({ before: { note: '' }, after: { note: 'شيء' } })).toHaveLength(
      1,
    )
    expect(diffAuditEntry({ before: { note: '' }, after: { note: '' } })).toEqual([])
  })
})

describe('modules/audit — المرشّحات الفارغة', () => {
  it('ينتج شرطًا فارغًا لا شرطًا مستحيلًا', () => {
    // An empty filter means "show everything". A `where` that accidentally
    // narrowed here would make the log look empty and unusable.
    expect(buildAuditWhere(auditFilterSchema.parse({}))).toEqual({})
  })

  it('يتجاهل المرشّحات الفارغة والمسافات', () => {
    expect(
      buildAuditWhere(
        auditFilterSchema.parse({ actorId: '', entity: '  ', entityId: '', action: '' }),
      ),
    ).toEqual({})
  })

  it('يقبل الترقيم الافتراضي بلا وسائط', () => {
    const parsed = auditFilterSchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(50)
    expect(parsed.from).toBeUndefined()
    expect(parsed.to).toBeUndefined()
  })

  it('يرفض تاريخًا فارغًا بدل أن يفسّره كبداية الزمن', () => {
    // `''` must not parse into an epoch boundary that silently excludes every
    // row written before 1970 — or, worse, every row at all.
    expect(auditFilterSchema.safeParse({ from: '' }).success).toBe(false)
    expect(auditFilterSchema.safeParse({ to: '' }).success).toBe(false)
  })
})
