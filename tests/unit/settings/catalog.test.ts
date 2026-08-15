import { describe, expect, it } from 'vitest'

import {
  SETTINGS_CATALOG,
  SETTING_GROUPS,
  SETTING_KEYS,
  isSettingKey,
  settingDefinition,
  settingSeedRows,
} from '@/lib/settings'

describe('lib/settings — كتالوج الإعدادات', () => {
  it('يحتوي على مفاتيح فريدة غير فارغة', () => {
    expect(SETTING_KEYS.length).toBeGreaterThan(0)
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length)
  })

  it('يضع كل إعداد داخل مجموعة معروفة', () => {
    for (const key of SETTING_KEYS) {
      expect(SETTING_GROUPS).toContain(SETTINGS_CATALOG[key].group)
    }
  })

  it('يسمي كل مفتاح ببادئة مجموعته أو بادئة معروفة', () => {
    // Keys are namespaced (`penalty.defaultGraceHours`) so a settings page can
    // be generated from the catalog without a second mapping table.
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z]+\.[A-Za-z]+$/)
    }
  })

  it('يقبل كل قيمة افتراضية مخطّطها الخاص', () => {
    // The real guard against a default that its own schema would reject.
    for (const key of SETTING_KEYS) {
      const definition = SETTINGS_CATALOG[key]
      const result = definition.schema.safeParse(definition.default)
      expect(result.success, `default for ${key} failed its own schema`).toBe(true)
    }
  })

  it('يميّز المفاتيح المعروفة عن غيرها', () => {
    expect(isSettingKey('penalty.defaultGraceHours')).toBe(true)
    expect(isSettingKey('penalty.notARealKey')).toBe(false)
    expect(isSettingKey('')).toBe(false)
    // Prototype keys must not be mistaken for settings.
    expect(isSettingKey('toString')).toBe(false)
    expect(isSettingKey('constructor')).toBe(false)
  })

  it('يعيد تعريف الإعداد كاملًا', () => {
    const definition = settingDefinition('payout.cycleDay')
    expect(definition.group).toBe('payout')
    expect(definition.default).toBe(28)
  })

  it('ينتج صفوف البذرة لكل مفتاح في الكتالوج', () => {
    const rows = settingSeedRows()
    expect(rows).toHaveLength(SETTING_KEYS.length)
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
    for (const row of rows) {
      expect(SETTING_GROUPS).toContain(row.group)
    }
  })
})

describe('lib/settings — القيم الافتراضية تحترم قواعد العمل', () => {
  it('يغلق دورة الصرف في يوم موجود في كل شهر', () => {
    // Capping at 28 is what removes February from the problem entirely.
    const day = SETTINGS_CATALOG['payout.cycleDay'].default
    expect(day).toBeGreaterThanOrEqual(1)
    expect(day).toBeLessThanOrEqual(28)
    expect(SETTINGS_CATALOG['payout.cycleDay'].schema.safeParse(29).success).toBe(false)
    expect(SETTINGS_CATALOG['payout.cycleDay'].schema.safeParse(0).success).toBe(false)
  })

  it('يجعل أوزان مؤشر الأداء تساوي مئة بالمئة', () => {
    // SPEC §5.6 — the four weights are the whole score.
    const total =
      SETTINGS_CATALOG['performance.weightOnTime'].default +
      SETTINGS_CATALOG['performance.weightQuality'].default +
      SETTINGS_CATALOG['performance.weightVolume'].default +
      SETTINGS_CATALOG['performance.weightEstimateAccuracy'].default
    expect(total).toBe(100)
  })

  it('يجعل عطلة نهاية الأسبوع الجمعة والسبت افتراضيًا', () => {
    expect(SETTINGS_CATALOG['calendar.weekendDays'].default).toEqual(['FRI', 'SAT'])
  })

  it('يفعّل احتساب تأخير التعديلات افتراضيًا', () => {
    // SPEC decision T4 — default ON, one boolean to turn off.
    expect(SETTINGS_CATALOG['penalty.penalizeRevisionLateness'].default).toBe(true)
  })

  it('يمنع قسمة الراتب على صفر أيام عمل', () => {
    const schema = SETTINGS_CATALOG['calendar.workingDaysPerMonth'].schema
    expect(schema.safeParse(0).success).toBe(false)
    expect(schema.safeParse(-1).success).toBe(false)
    expect(schema.safeParse(22).success).toBe(true)
  })

  it('يرفض قيمة خصم سالبة', () => {
    expect(SETTINGS_CATALOG['penalty.defaultValue'].schema.safeParse(-1).success).toBe(
      false,
    )
    expect(
      SETTINGS_CATALOG['penalty.defaultGraceHours'].schema.safeParse(-1).success,
    ).toBe(false)
    // Zero grace is legitimate: "due at 17:00 means late at 17:01".
    expect(
      SETTINGS_CATALOG['penalty.defaultGraceHours'].schema.safeParse(0).success,
    ).toBe(true)
  })

  it('يقبل صيغة الوقت HH:mm فقط', () => {
    const schema = SETTINGS_CATALOG['calendar.workdayStart'].schema
    expect(schema.safeParse('09:00').success).toBe(true)
    expect(schema.safeParse('23:59').success).toBe(true)
    expect(schema.safeParse('24:00').success).toBe(false)
    expect(schema.safeParse('9:00').success).toBe(false)
    expect(schema.safeParse('09:60').success).toBe(false)
  })

  it('يرفض قائمة فارغة لطرق الصرف وأنواع الإجازات', () => {
    expect(SETTINGS_CATALOG['payout.paymentMethods'].schema.safeParse([]).success).toBe(
      false,
    )
    expect(SETTINGS_CATALOG['calendar.leaveTypes'].schema.safeParse([]).success).toBe(
      false,
    )
  })

  /**
   * `Task.categoryId` (SPEC §4) stores the id, never the label, so that
   * renaming a category in Settings is a label change and not a silent
   * re-categorisation of every task filed under it. That only holds if the ids
   * are real, unique and stable — which is what this asserts.
   */
  it('تصنيفات المهام تحمل معرّفًا ثابتًا ومسمى عربيًا', () => {
    const schema = SETTINGS_CATALOG['tasks.categories'].schema

    expect(schema.safeParse([]).success).toBe(false)
    expect(schema.safeParse(['تصميم']).success).toBe(false)
    expect(schema.safeParse([{ id: 'design', label: '' }]).success).toBe(false)
    expect(schema.safeParse([{ id: '', label: 'تصميم' }]).success).toBe(false)
    // Ids are latin kebab-case: they end up in URLs, filters and audit rows.
    expect(schema.safeParse([{ id: 'تصميم', label: 'تصميم' }]).success).toBe(false)
    expect(schema.safeParse([{ id: 'Design', label: 'تصميم' }]).success).toBe(false)
    expect(schema.safeParse([{ id: '-design', label: 'تصميم' }]).success).toBe(false)

    expect(schema.safeParse([{ id: 'design', label: 'تصميم' }]).success).toBe(true)
    expect(schema.safeParse([{ id: 'motion-design', label: 'تصميم' }]).success).toBe(
      true,
    )
  })

  it('يرفض تكرار معرّف تصنيف', () => {
    const schema = SETTINGS_CATALOG['tasks.categories'].schema

    expect(
      schema.safeParse([
        { id: 'design', label: 'تصميم' },
        { id: 'design', label: 'تصميم آخر' },
      ]).success,
    ).toBe(false)
  })

  it('التصنيفات الافتراضية معرّفاتها فريدة', () => {
    const defaults = SETTINGS_CATALOG['tasks.categories'].default
    const ids = defaults.map((c) => c.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('يوفّر مسمى عربيًا لكل حالة مهمة', () => {
    const labels = SETTINGS_CATALOG['labels.taskStatus'].default
    const statuses = [
      'BACKLOG',
      'ASSIGNED',
      'IN_PROGRESS',
      'SUBMITTED',
      'IN_REVIEW',
      'REVISION_REQUESTED',
      'APPROVED',
      'DONE',
      'BLOCKED',
      'CANCELLED',
    ]
    for (const status of statuses) {
      expect(Object.keys(labels)).toContain(status)
    }
  })
})
