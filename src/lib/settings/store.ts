import { AppError } from '@/lib/errors'

import {
  SETTINGS_CATALOG,
  SETTING_KEYS,
  isSettingKey,
  type SettingKey,
  type SettingValue,
} from './catalog'

/**
 * Minimal structural port over the `Setting` table. Deliberately not typed as
 * Prisma: it keeps the store unit-testable with a plain fake and keeps
 * `lib/settings` free of a DB dependency.
 */
export interface SettingsSource {
  loadAll(): Promise<Array<{ key: string; value: unknown }>>
}

export interface SettingsStoreOptions {
  source: SettingsSource
  /** Cache lifetime. 0 disables caching (used by tests that assert reads). */
  ttlMs?: number
  /** Injectable clock so TTL behaviour is testable without timers. */
  now?: () => number
}

export const DEFAULT_TTL_MS = 60_000

export interface SettingsStore {
  get<K extends SettingKey>(key: K): Promise<SettingValue<K>>
  getMany<K extends SettingKey>(
    keys: readonly K[],
  ): Promise<{ [P in K]: SettingValue<P> }>
  all(): Promise<{ [K in SettingKey]: SettingValue<K> }>
  /** Called after any settings write so the next read is fresh. */
  invalidate(): void
}

type ResolvedSettings = { [K in SettingKey]: SettingValue<K> }

/**
 * Resolve one raw DB value against the catalog.
 *
 * Missing → the catalog default. That is the normal state before the seed runs
 * and after a new setting is added, so it must not be an error.
 *
 * Present but invalid → throws. A corrupted grace period or penalty percentage
 * silently falling back to a default is precisely the failure mode that produces
 * a wrong deduction, and this product exists to make deductions defensible.
 */
export function resolveSettingValue<K extends SettingKey>(
  key: K,
  raw: unknown,
  present: boolean,
): SettingValue<K> {
  const definition = SETTINGS_CATALOG[key]
  if (!present) return definition.default as SettingValue<K>

  const parsed = definition.schema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError('VALIDATION', 'errors.settingInvalid', {
      key,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }
  return parsed.data as SettingValue<K>
}

/**
 * Validate a candidate value before it is written. Used by the settings module's
 * write path, so an invalid value can never reach the column in the first place.
 */
export function parseSettingValue(
  key: string,
  raw: unknown,
): { key: SettingKey; value: unknown } {
  if (!isSettingKey(key)) {
    throw new AppError('VALIDATION', 'errors.settingUnknown', { key })
  }
  const parsed = SETTINGS_CATALOG[key].schema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError('VALIDATION', 'errors.validation', {
      key,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }
  return { key, value: parsed.data }
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  const { source } = options
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? (() => Date.now())

  let cache: ResolvedSettings | null = null
  let cachedAt = 0
  // Concurrent callers during a cold cache share one query instead of stampeding.
  let inFlight: Promise<ResolvedSettings> | null = null

  function isFresh(): boolean {
    return cache !== null && ttlMs > 0 && now() - cachedAt < ttlMs
  }

  async function load(): Promise<ResolvedSettings> {
    const rows = await source.loadAll()
    const byKey = new Map<string, unknown>()
    for (const row of rows) byKey.set(row.key, row.value)

    const resolved = {} as ResolvedSettings
    // One localized cast. `resolveSettingValue` is correctly typed per key, but
    // TypeScript cannot see that a value produced for key `k` belongs in slot
    // `k` of a mapped type when `k` is only known at runtime. The type safety
    // that matters — callers getting `number` from
    // `get('penalty.defaultGraceHours')` — is preserved by the public signature.
    const target = resolved as Record<SettingKey, unknown>
    for (const key of SETTING_KEYS) {
      target[key] = resolveSettingValue(key, byKey.get(key), byKey.has(key))
    }
    return resolved
  }

  async function snapshot(): Promise<ResolvedSettings> {
    if (isFresh() && cache) return cache
    if (inFlight) return inFlight

    inFlight = load()
      .then((resolved) => {
        cache = resolved
        cachedAt = now()
        return resolved
      })
      .finally(() => {
        inFlight = null
      })

    return inFlight
  }

  return {
    async get(key) {
      return (await snapshot())[key]
    },

    async getMany(keys) {
      const s = await snapshot()
      const out = {} as { [P in (typeof keys)[number]]: SettingValue<P> }
      for (const key of keys) out[key] = s[key]
      return out
    },

    async all() {
      return { ...(await snapshot()) }
    },

    invalidate() {
      cache = null
      cachedAt = 0
    },
  }
}

/** A store backed purely by catalog defaults — useful in unit tests. */
export function createDefaultsOnlyStore(): SettingsStore {
  return createSettingsStore({ source: { loadAll: async () => [] } })
}
