import { describe, expect, it } from 'vitest'

import { SETTING_FIELDS } from '@/app/(app)/settings/field-map'
import { ar } from '@/i18n/ar'
import { SETTINGS_CATALOG, SETTING_KEYS, type SettingKey } from '@/lib/settings/catalog'

/**
 * The Settings page is generated from the catalog, so the failure mode it has
 * is a *silent omission*: someone adds a setting in Phase 13, the page renders
 * fine, and the new number is simply unreachable by the operator it exists for.
 * These tests are what makes that a build failure instead.
 */
describe('صفحة الإعدادات — تغطية كل مفاتيح الكتالوج', () => {
  it('لكل مفتاح في الكتالوج عنصر تحكم معرَّف', () => {
    const missing = SETTING_KEYS.filter((key) => SETTING_FIELDS[key] === undefined)
    expect(missing).toEqual([])
  })

  it('لا يوجد عنصر تحكم لمفتاح غير موجود في الكتالوج', () => {
    const extra = Object.keys(SETTING_FIELDS).filter(
      (key) => !Object.prototype.hasOwnProperty.call(SETTINGS_CATALOG, key),
    )
    expect(extra).toEqual([])
  })

  it('لكل مفتاح مسمّى عربي في ar.settings.keys', () => {
    const missing = SETTING_KEYS.filter((key) => !ar.settings.keys[key])
    expect(missing).toEqual([])
  })

  it('لكل مجموعة إعدادات عنوان ووصف عربيان', () => {
    const groups = new Set(SETTING_KEYS.map((key) => SETTINGS_CATALOG[key].group))
    for (const group of groups) {
      expect(ar.settings.groups[group], group).toBeTruthy()
      expect(ar.settings.groupHints[group], group).toBeTruthy()
    }
  })
})

describe('صفحة الإعدادات — توافق عنصر التحكم مع مخطط الكتالوج', () => {
  /**
   * The catalog default is, by construction, a valid value of the right shape.
   * Asserting the control kind against it is what catches a `number` control
   * wired to a list setting — which would render an empty box and then save a
   * `NaN` over a real configuration.
   */
  const expectedKind: Record<string, (value: unknown) => boolean> = {
    number: (value) => typeof value === 'number',
    boolean: (value) => typeof value === 'boolean',
    select: (value) => typeof value === 'string',
    time: (value) => typeof value === 'string',
    enumSet: (value) => Array.isArray(value),
    taxonomy: (value) => Array.isArray(value),
    stringList: (value) => Array.isArray(value),
    labelMap: (value) => typeof value === 'object' && !Array.isArray(value),
    templateMap: (value) => typeof value === 'object' && !Array.isArray(value),
  }

  for (const key of SETTING_KEYS) {
    it(`نوع عنصر التحكم يطابق قيمة ${key} الافتراضية`, () => {
      const field = SETTING_FIELDS[key]
      const predicate = expectedKind[field.kind]
      expect(predicate, field.kind).toBeDefined()
      expect(predicate?.(SETTINGS_CATALOG[key].default)).toBe(true)
    })
  }

  it('كل خيار في قائمة منسدلة أو مجموعة قيم يقبله مخطط الكتالوج', () => {
    for (const key of SETTING_KEYS) {
      const field = SETTING_FIELDS[key]
      if (field.kind === 'select') {
        for (const option of field.options) {
          expect(
            SETTINGS_CATALOG[key].schema.safeParse(option.value).success,
            `${key}:${option.value}`,
          ).toBe(true)
        }
      }
      if (field.kind === 'enumSet') {
        for (const option of field.options) {
          expect(
            SETTINGS_CATALOG[key].schema.safeParse([option.value]).success,
            `${key}:${option.value}`,
          ).toBe(true)
        }
      }
    }
  })

  it('كل مفتاح في محرِّر المسميات موجود في القيمة الافتراضية', () => {
    for (const key of SETTING_KEYS) {
      const field = SETTING_FIELDS[key]
      if (field.kind !== 'labelMap' && field.kind !== 'templateMap') continue

      const defaults = SETTINGS_CATALOG[key].default as Record<string, string>
      for (const entry of field.entries) {
        expect(Object.keys(defaults), `${key}:${entry.key}`).toContain(entry.key)
      }
      // And nothing in the stored default is missing a box to edit it in.
      const editable = new Set(field.entries.map((entry) => entry.key))
      for (const storedKey of Object.keys(defaults)) {
        expect(editable, `${key}:${storedKey}`).toContain(storedKey)
      }
    }
  })
})

describe('صفحة الإعدادات — حدود عنصر التحكم لا تناقض الكتالوج', () => {
  const numericKeys = SETTING_KEYS.filter(
    (key): key is SettingKey => SETTING_FIELDS[key].kind === 'number',
  )

  for (const key of numericKeys) {
    it(`حدود ${key} المعروضة يقبلها المخطط`, () => {
      const field = SETTING_FIELDS[key]
      if (field.kind !== 'number') throw new Error('unreachable')
      const schema = SETTINGS_CATALOG[key].schema

      // A `min`/`max` the schema would reject is a control that lets the
      // operator type a value the save then bounces, with no explanation.
      if (field.min !== undefined) {
        expect(schema.safeParse(field.min).success, `${key} min`).toBe(true)
      }
      if (field.max !== undefined) {
        expect(schema.safeParse(field.max).success, `${key} max`).toBe(true)
      }
    })
  }
})
