import {
  SETTINGS_CATALOG,
  createSettingsStore,
  type SettingKey,
  type SettingsSource,
  type SettingsStore,
} from '@/lib/settings'

export interface BuiltSetting {
  key: string
  value: unknown
}

export function buildSetting<K extends SettingKey>(
  key: K,
  value: unknown = SETTINGS_CATALOG[key].default,
): BuiltSetting {
  return { key, value }
}

/**
 * An in-memory `SettingsSource`, so a service under test can be given specific
 * business numbers without a database.
 *
 * docs/TESTING.md §5 forbids asserting on hardcoded business numbers — read them
 * back from the same store the code under test uses.
 */
export function fakeSettingsSource(rows: BuiltSetting[] = []): SettingsSource & {
  calls: number
  set(key: string, value: unknown): void
} {
  const state = new Map(rows.map((r) => [r.key, r.value]))
  return {
    calls: 0,
    set(key, value) {
      state.set(key, value)
    },
    async loadAll() {
      this.calls += 1
      return [...state].map(([key, value]) => ({ key, value }))
    },
  }
}

export function fakeSettingsStore(rows: BuiltSetting[] = []): SettingsStore {
  return createSettingsStore({ source: fakeSettingsSource(rows) })
}
