import { describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { SETTINGS_CATALOG, SETTING_KEYS } from '@/lib/settings'
import {
  listSettings,
  listSettingsByGroup,
  updateSetting,
} from '@/modules/setting/service'

import { actingAs } from '../../helpers/auth'

/**
 * The example module's service, exercised the way every service in this codebase
 * is meant to be: called directly with a fake client, no database, no Next.js.
 */

interface StoredSetting {
  key: string
  group: string
  value: unknown
  updatedAt: Date
  updatedById: string | null
}

function fakeDb(rows: StoredSetting[] = []) {
  const settings = new Map(rows.map((r) => [r.key, r]))
  const auditRows: Array<Record<string, unknown>> = []

  const db = {
    setting: {
      findMany: vi.fn(async () => [...settings.values()]),
      findUnique: vi.fn(
        async ({ where }: { where: { key: string } }) => settings.get(where.key) ?? null,
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { key: string }
          create: StoredSetting
          update: Partial<StoredSetting>
        }) => {
          const existing = settings.get(where.key)
          const row: StoredSetting = existing
            ? { ...existing, ...update, updatedAt: new Date('2026-08-13T00:00:00.000Z') }
            : { ...create, updatedAt: new Date('2026-08-13T00:00:00.000Z') }
          settings.set(where.key, row)
          return row
        },
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data)
        return data
      }),
    },
  }

  return { db: db as unknown as Db, settings, auditRows, spies: db }
}

const row = (key: string, group: string, value: unknown): StoredSetting => ({
  key,
  group,
  value,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedById: 'seed',
})

describe('modules/setting — القراءة', () => {
  it('يعرض كل مفاتيح الكتالوج حتى ما لم يُكتب منها بعد', async () => {
    // Driven by the catalog, not the table: a never-written setting must still
    // appear on the settings page, showing its default.
    const { db } = fakeDb()
    const result = await listSettings(db)

    expect(result).toHaveLength(SETTING_KEYS.length)
    expect(result.every((s) => s.isDefault)).toBe(true)
  })

  it('يميّز القيمة المخزَّنة عن القيمة الافتراضية', async () => {
    const { db } = fakeDb([row('payout.cycleDay', 'payout', 15)])
    const result = await listSettings(db)

    const stored = result.find((s) => s.key === 'payout.cycleDay')
    expect(stored).toMatchObject({ value: 15, isDefault: false, updatedById: 'seed' })

    const untouched = result.find((s) => s.key === 'penalty.defaultGraceHours')
    expect(untouched).toMatchObject({
      value: SETTINGS_CATALOG['penalty.defaultGraceHours'].default,
      isDefault: true,
      updatedAt: null,
      updatedById: null,
    })
  })

  it('يجمّع الإعدادات في مجموعات دون فقدان أي مفتاح', async () => {
    const { db } = fakeDb()
    const groups = await listSettingsByGroup(db)

    const flattened = groups.flatMap((g) => g.settings.map((s) => s.key))
    expect(flattened.sort()).toEqual([...SETTING_KEYS].sort())
    for (const group of groups) {
      expect(group.settings.every((s) => s.group === group.group)).toBe(true)
    }
  })
})

describe('modules/setting — الكتابة', () => {
  it('يكتب القيمة بعد التحقق من مخططها', async () => {
    const { db, settings } = fakeDb()
    const actor = actingAs(['settings.edit'], { id: 'u1' })

    const result = await updateSetting(db, {
      actor,
      key: 'payout.cycleDay',
      value: 15,
    })

    expect(result).toMatchObject({ key: 'payout.cycleDay', value: 15, isDefault: false })
    expect(settings.get('payout.cycleDay')).toMatchObject({
      value: 15,
      group: 'payout',
      updatedById: 'u1',
    })
  })

  it('يرفض قيمة خارج المدى ولا يكتب شيئًا', async () => {
    // CLAUDE.md invariant 4: an invalid business number must never reach the column.
    const { db, spies } = fakeDb()

    await expect(
      updateSetting(db, {
        actor: actingAs(['settings.edit']),
        key: 'payout.cycleDay',
        value: 31,
      }),
    ).rejects.toThrow(AppError)

    expect(spies.setting.upsert).not.toHaveBeenCalled()
    expect(spies.auditLog.create).not.toHaveBeenCalled()
  })

  it('يرفض مفتاحًا غير موجود في الكتالوج', async () => {
    const { db, spies } = fakeDb()

    await expect(
      updateSetting(db, {
        actor: actingAs(['settings.edit']),
        key: 'penalty.inventedKey',
        value: 1,
      }),
    ).rejects.toThrow(AppError)

    expect(spies.setting.upsert).not.toHaveBeenCalled()
  })

  it('يسجّل التغيير في سجل التدقيق مع القيمة قبل وبعد', async () => {
    // CLAUDE.md invariant 7 — settings drive money, so they are audited.
    const { db, auditRows } = fakeDb([row('payout.cycleDay', 'payout', 28)])

    await updateSetting(db, {
      actor: actingAs(['settings.edit'], { id: 'u1' }),
      key: 'payout.cycleDay',
      value: 15,
      ip: '10.0.0.5',
    })

    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({
      actorId: 'u1',
      action: 'setting.updated',
      entity: 'Setting',
      entityId: 'payout.cycleDay',
      before: { value: 28 },
      after: { value: 15 },
      ip: '10.0.0.5',
    })
  })

  it('يسجّل القيمة الافتراضية كقيمة سابقة عند أول كتابة', async () => {
    // Otherwise the first edit of any setting shows "before: null", which tells
    // the reader nothing about what actually changed.
    const { db, auditRows } = fakeDb()

    await updateSetting(db, {
      actor: actingAs(['settings.edit']),
      key: 'penalty.defaultGraceHours',
      value: 48,
    })

    expect(auditRows[0]).toMatchObject({
      before: { value: SETTINGS_CATALOG['penalty.defaultGraceHours'].default },
      after: { value: 48 },
    })
  })

  // The vehicle is `payout.paymentMethods`, the remaining plain list of Arabic
  // strings. `tasks.categories` moved to `{ id, label }` entries in Phase 4 and
  // `calendar.leaveTypes` followed in Phase 6, both so that the column pointing
  // at them (`Task.categoryId`, `Leave.typeId`) survives a rename; those shapes
  // are covered in tests/unit/settings/catalog.test.ts.
  it('يقبل تعديل قائمة عربية كاملة', async () => {
    const { db, settings } = fakeDb()

    await updateSetting(db, {
      actor: actingAs(['settings.edit']),
      key: 'payout.paymentMethods',
      value: ['إنستاباي', 'نقدًا'],
    })

    expect(settings.get('payout.paymentMethods')?.value).toEqual(['إنستاباي', 'نقدًا'])
  })

  it('يرفض قائمة أنواع الإجازات بالشكل القديم (نصوص بلا معرّف)', async () => {
    // The Phase 6 migration rewrote the stored row; a client still posting the
    // old shape must be refused rather than silently accepted and then thrown
    // on at read time.
    const { db } = fakeDb()

    await expect(
      updateSetting(db, {
        actor: actingAs(['settings.edit']),
        key: 'calendar.leaveTypes',
        value: ['إجازة سنوية', 'إجازة مرضية'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('يقبل تعديل أنواع الإجازات بمعرّف ثابت ومسمى عربي', async () => {
    const { db, settings } = fakeDb()

    await updateSetting(db, {
      actor: actingAs(['settings.edit']),
      key: 'calendar.leaveTypes',
      value: [
        { id: 'annual', label: 'إجازة سنوية' },
        { id: 'study', label: 'إجازة دراسية' },
      ],
    })

    expect(settings.get('calendar.leaveTypes')?.value).toEqual([
      { id: 'annual', label: 'إجازة سنوية' },
      { id: 'study', label: 'إجازة دراسية' },
    ])
  })

  it('يقبل تعديل تصنيفات المهام بمعرّف ثابت ومسمى عربي', async () => {
    const { db, settings } = fakeDb()

    await updateSetting(db, {
      actor: actingAs(['settings.edit']),
      key: 'tasks.categories',
      value: [{ id: 'design', label: 'تصميم جرافيك' }],
    })

    expect(settings.get('tasks.categories')?.value).toEqual([
      { id: 'design', label: 'تصميم جرافيك' },
    ])
  })
})
