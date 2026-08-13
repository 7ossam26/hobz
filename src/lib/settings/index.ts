import { prisma } from '@/lib/db'
import type { Db } from '@/lib/db'

import type { SettingKey, SettingValue } from './catalog'
import { createSettingsStore, type SettingsSource, type SettingsStore } from './store'

export * from './catalog'
export {
  createSettingsStore,
  createDefaultsOnlyStore,
  parseSettingValue,
  resolveSettingValue,
  DEFAULT_TTL_MS,
  type SettingsSource,
  type SettingsStore,
} from './store'

/** Adapter from the `Setting` table to the store's port. */
export function prismaSettingsSource(db: Db): SettingsSource {
  return {
    async loadAll() {
      return db.setting.findMany({ select: { key: true, value: true } })
    },
  }
}

// Lazily constructed so that importing anything from lib/settings in a unit test
// does not instantiate a Prisma client.
let appStore: SettingsStore | null = null

function store(): SettingsStore {
  appStore ??= createSettingsStore({ source: prismaSettingsSource(prisma) })
  return appStore
}

/**
 * The accessor the whole app uses:
 *
 *   const grace = await getSetting('penalty.defaultGraceHours')  // → number
 *
 * Typed by the catalog, Zod-validated on read, cached with a short TTL, and
 * invalidated explicitly whenever the settings module writes.
 */
export function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return store().get(key)
}

export function getSettings<K extends SettingKey>(
  keys: readonly K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  return store().getMany(keys)
}

export function getAllSettings(): Promise<{ [K in SettingKey]: SettingValue<K> }> {
  return store().all()
}

export function invalidateSettingsCache(): void {
  store().invalidate()
}
