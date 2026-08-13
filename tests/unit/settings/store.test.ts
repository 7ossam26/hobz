import { beforeEach, describe, expect, it } from 'vitest'

import { AppError } from '@/lib/errors'
import {
  SETTINGS_CATALOG,
  SETTING_KEYS,
  createDefaultsOnlyStore,
  createSettingsStore,
  parseSettingValue,
  resolveSettingValue,
} from '@/lib/settings'

import { fakeSettingsSource } from '../../factories/setting'

describe('lib/settings — قراءة القيم', () => {
  it('يعيد القيمة المخزَّنة عند وجودها', async () => {
    const store = createSettingsStore({
      source: fakeSettingsSource([{ key: 'penalty.defaultGraceHours', value: 48 }]),
    })
    await expect(store.get('penalty.defaultGraceHours')).resolves.toBe(48)
  })

  it('يعيد القيمة الافتراضية عندما لا يوجد صف بعد', async () => {
    // The normal state before the seed runs, and after a new setting is added
    // to the catalog but not yet written. Must not be an error.
    const store = createDefaultsOnlyStore()
    await expect(store.get('penalty.defaultGraceHours')).resolves.toBe(
      SETTINGS_CATALOG['penalty.defaultGraceHours'].default,
    )
  })

  it('يعيد كل مفاتيح الكتالوج حتى غير المخزَّنة', async () => {
    const all = await createDefaultsOnlyStore().all()
    expect(Object.keys(all).sort()).toEqual([...SETTING_KEYS].sort())
  })

  it('يقرأ عدة مفاتيح دفعة واحدة', async () => {
    const store = createSettingsStore({
      source: fakeSettingsSource([
        { key: 'payout.cycleDay', value: 25 },
        { key: 'calendar.workingDaysPerMonth', value: 26 },
      ]),
    })
    const values = await store.getMany([
      'payout.cycleDay',
      'calendar.workingDaysPerMonth',
    ])
    expect(values).toEqual({
      'payout.cycleDay': 25,
      'calendar.workingDaysPerMonth': 26,
    })
  })

  it('يمنع تعديل النسخة المُعادة من التأثير على الذاكرة المؤقتة', async () => {
    const store = createDefaultsOnlyStore()
    const snapshot = await store.all()
    snapshot['payout.cycleDay'] = 1
    await expect(store.get('payout.cycleDay')).resolves.toBe(28)
  })
})

describe('lib/settings — رفض القيم التالفة', () => {
  it('يرفض قيمة مخزَّنة لا تطابق مخططها بدل الرجوع للافتراضي بصمت', async () => {
    // A corrupted grace period silently falling back to a default is exactly
    // the failure that produces an indefensible deduction.
    const store = createSettingsStore({
      source: fakeSettingsSource([{ key: 'penalty.defaultGraceHours', value: 'كثير' }]),
    })
    await expect(store.get('penalty.defaultGraceHours')).rejects.toThrow(AppError)
  })

  it('يذكر المفتاح والسبب في الخطأ', () => {
    try {
      resolveSettingValue('payout.cycleDay', 99, true)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const appError = error as AppError
      expect(appError.code).toBe('VALIDATION')
      expect(appError.details?.key).toBe('payout.cycleDay')
      expect(Array.isArray(appError.details?.issues)).toBe(true)
    }
  })

  it('يتجاهل مفاتيح غير معروفة موجودة في قاعدة البيانات', async () => {
    // A setting removed from the catalog but still present in the table must
    // not break every read.
    const store = createSettingsStore({
      source: fakeSettingsSource([
        { key: 'legacy.removedSetting', value: 'whatever' },
        { key: 'payout.cycleDay', value: 15 },
      ]),
    })
    await expect(store.get('payout.cycleDay')).resolves.toBe(15)
  })
})

describe('lib/settings — التحقق قبل الكتابة', () => {
  it('يقبل قيمة صحيحة ويعيدها بعد التحليل', () => {
    expect(parseSettingValue('payout.cycleDay', 15)).toEqual({
      key: 'payout.cycleDay',
      value: 15,
    })
  })

  it('يرفض مفتاحًا غير موجود في الكتالوج', () => {
    expect(() => parseSettingValue('penalty.madeUpKey', 1)).toThrow(AppError)
    try {
      parseSettingValue('penalty.madeUpKey', 1)
    } catch (error) {
      expect((error as AppError).messageKey).toBe('errors.settingUnknown')
    }
  })

  it('يرفض قيمة خارج المدى المسموح', () => {
    expect(() => parseSettingValue('payout.cycleDay', 31)).toThrow(AppError)
    expect(() => parseSettingValue('penalty.defaultGraceHours', -5)).toThrow(AppError)
    expect(() => parseSettingValue('penalty.penalizeRevisionLateness', 'yes')).toThrow(
      AppError,
    )
  })

  it('يرفض وضع خصم غير معروف', () => {
    expect(() => parseSettingValue('penalty.defaultMode', 'RANDOM_MODE')).toThrow(
      AppError,
    )
    expect(parseSettingValue('penalty.defaultMode', 'FIXED_ONCE').value).toBe(
      'FIXED_ONCE',
    )
  })
})

describe('lib/settings — الذاكرة المؤقتة', () => {
  let clock = 0
  const now = (): number => clock

  beforeEach(() => {
    clock = 0
  })

  it('يقرأ من المصدر مرة واحدة خلال مدة الصلاحية', async () => {
    const source = fakeSettingsSource([{ key: 'payout.cycleDay', value: 10 }])
    const store = createSettingsStore({ source, ttlMs: 60_000, now })

    await store.get('payout.cycleDay')
    await store.get('payout.cycleDay')
    await store.get('calendar.workingDaysPerMonth')

    expect(source.calls).toBe(1)
  })

  it('يعيد القراءة بعد انتهاء مدة الصلاحية', async () => {
    const source = fakeSettingsSource([{ key: 'payout.cycleDay', value: 10 }])
    const store = createSettingsStore({ source, ttlMs: 60_000, now })

    await store.get('payout.cycleDay')
    clock = 59_999
    await store.get('payout.cycleDay')
    expect(source.calls).toBe(1)

    clock = 60_000
    await store.get('payout.cycleDay')
    expect(source.calls).toBe(2)
  })

  it('يقرأ القيمة الجديدة فور إبطال الذاكرة المؤقتة', async () => {
    const source = fakeSettingsSource([{ key: 'payout.cycleDay', value: 10 }])
    const store = createSettingsStore({ source, ttlMs: 60_000, now })

    await expect(store.get('payout.cycleDay')).resolves.toBe(10)

    source.set('payout.cycleDay', 20)
    await expect(store.get('payout.cycleDay')).resolves.toBe(10)

    store.invalidate()
    await expect(store.get('payout.cycleDay')).resolves.toBe(20)
    expect(source.calls).toBe(2)
  })

  it('يعطّل التخزين المؤقت عند ضبط المدة على صفر', async () => {
    const source = fakeSettingsSource([{ key: 'payout.cycleDay', value: 10 }])
    const store = createSettingsStore({ source, ttlMs: 0, now })

    await store.get('payout.cycleDay')
    await store.get('payout.cycleDay')
    expect(source.calls).toBe(2)
  })

  it('يجمع القراءات المتزامنة في استعلام واحد', async () => {
    // Without this, a cold cache on a busy request would stampede the DB with
    // one identical query per concurrent reader.
    const source = fakeSettingsSource([{ key: 'payout.cycleDay', value: 10 }])
    const store = createSettingsStore({ source, ttlMs: 60_000, now })

    await Promise.all([
      store.get('payout.cycleDay'),
      store.get('payout.cycleDay'),
      store.get('calendar.workingDaysPerMonth'),
    ])

    expect(source.calls).toBe(1)
  })

  it('لا يحتفظ بذاكرة مؤقتة فاسدة بعد فشل القراءة', async () => {
    let shouldFail = true
    const store = createSettingsStore({
      source: {
        async loadAll() {
          if (shouldFail) throw new Error('connection lost')
          return [{ key: 'payout.cycleDay', value: 7 }]
        },
      },
      ttlMs: 60_000,
      now,
    })

    await expect(store.get('payout.cycleDay')).rejects.toThrow('connection lost')

    shouldFail = false
    await expect(store.get('payout.cycleDay')).resolves.toBe(7)
  })
})
