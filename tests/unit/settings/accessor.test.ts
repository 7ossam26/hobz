import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db'
// Type-only, so it does not defeat the `vi.resetModules()` reload below.
import type * as SettingsLib from '@/lib/settings'

/**
 * The app-facing accessor in `lib/settings/index.ts` — the thin layer that wires
 * the store to Prisma. Small, but it owns two behaviours worth pinning down:
 * the client is constructed lazily, and `invalidateSettingsCache()` genuinely
 * reaches the same store instance `getSetting()` reads from.
 */

const findMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    setting: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}))

type SettingsModule = typeof SettingsLib

async function loadModule(): Promise<SettingsModule> {
  vi.resetModules()
  return import('@/lib/settings')
}

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue([])
})

afterEach(() => {
  vi.resetModules()
})

describe('lib/settings — محوّل قاعدة البيانات', () => {
  it('يقرأ المفتاح والقيمة فقط من جدول الإعدادات', async () => {
    // Selecting the whole row would drag `updatedBy` relations into a query that
    // runs on effectively every request.
    const { prismaSettingsSource } = await loadModule()
    const db = { setting: { findMany } } as unknown as Db

    findMany.mockResolvedValue([{ key: 'payout.cycleDay', value: 12 }])
    const rows = await prismaSettingsSource(db).loadAll()

    expect(findMany).toHaveBeenCalledWith({ select: { key: true, value: true } })
    expect(rows).toEqual([{ key: 'payout.cycleDay', value: 12 }])
  })
})

describe('lib/settings — المُلحِق العام', () => {
  it('يعيد القيمة المخزَّنة عبر عميل Prisma', async () => {
    findMany.mockResolvedValue([{ key: 'payout.cycleDay', value: 12 }])
    const { getSetting } = await loadModule()

    await expect(getSetting('payout.cycleDay')).resolves.toBe(12)
  })

  it('لا ينشئ عميل قاعدة البيانات قبل أول قراءة', async () => {
    // Importing lib/settings in a unit test must not open a connection pool.
    const { getSetting } = await loadModule()
    expect(findMany).not.toHaveBeenCalled()

    await getSetting('payout.cycleDay')
    expect(findMany).toHaveBeenCalledOnce()
  })

  it('يقرأ عدة مفاتيح دفعة واحدة', async () => {
    findMany.mockResolvedValue([
      { key: 'payout.cycleDay', value: 12 },
      { key: 'calendar.workingDaysPerMonth', value: 24 },
    ])
    const { getSettings } = await loadModule()

    await expect(
      getSettings(['payout.cycleDay', 'calendar.workingDaysPerMonth']),
    ).resolves.toEqual({
      'payout.cycleDay': 12,
      'calendar.workingDaysPerMonth': 24,
    })
    expect(findMany).toHaveBeenCalledOnce()
  })

  it('يعيد لقطة كاملة لكل الإعدادات', async () => {
    const { getAllSettings, SETTING_KEYS } = await loadModule()
    const all = await getAllSettings()
    expect(Object.keys(all).sort()).toEqual([...SETTING_KEYS].sort())
  })

  it('يشارك كل النداءات نفس الذاكرة المؤقتة', async () => {
    findMany.mockResolvedValue([{ key: 'payout.cycleDay', value: 12 }])
    const { getSetting, getAllSettings } = await loadModule()

    await getSetting('payout.cycleDay')
    await getAllSettings()
    await getSetting('penalty.defaultGraceHours')

    expect(findMany).toHaveBeenCalledOnce()
  })

  it('يرى القيمة الجديدة بعد إبطال الذاكرة المؤقتة', async () => {
    // This is the contract the settings action depends on: without it, a saved
    // grace period would not take effect until the TTL expired.
    findMany.mockResolvedValue([{ key: 'payout.cycleDay', value: 12 }])
    const { getSetting, invalidateSettingsCache } = await loadModule()

    await expect(getSetting('payout.cycleDay')).resolves.toBe(12)

    findMany.mockResolvedValue([{ key: 'payout.cycleDay', value: 20 }])
    await expect(getSetting('payout.cycleDay')).resolves.toBe(12)

    invalidateSettingsCache()
    await expect(getSetting('payout.cycleDay')).resolves.toBe(20)
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('يبطل الذاكرة المؤقتة حتى قبل أول قراءة دون انهيار', async () => {
    const { invalidateSettingsCache, getSetting } = await loadModule()
    expect(() => invalidateSettingsCache()).not.toThrow()
    await expect(getSetting('payout.cycleDay')).resolves.toBe(28)
  })
})
