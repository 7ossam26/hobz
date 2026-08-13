import { recordAudit } from '@/lib/audit'
import type { Db } from '@/lib/db'
import type { Actor } from '@/lib/rbac'
import {
  SETTINGS_CATALOG,
  SETTING_KEYS,
  parseSettingValue,
  type SettingGroup,
  type SettingKey,
} from '@/lib/settings'

import type { SettingDto, SettingGroupDto } from './types'

/**
 * modules/setting/service.ts — the reference implementation of the service
 * pattern (CLAUDE.md architecture rules).
 *
 * Rules this file demonstrates and every other service must follow:
 *   - Pure functions. No module-level state.
 *   - The Prisma client arrives as the first parameter, so a caller can pass a
 *     transaction client and a unit test can pass a fake.
 *   - No `next/*` import — this file must be runnable under plain Vitest.
 *   - The actor is data, not ambient context; permission checks happen before
 *     the call, in the action or query layer.
 *   - Every mutation writes an audit row inside the same transaction.
 */

export async function listSettings(db: Db): Promise<SettingDto[]> {
  const rows = await db.setting.findMany({
    select: { key: true, group: true, value: true, updatedAt: true, updatedById: true },
  })
  const byKey = new Map(rows.map((r) => [r.key, r]))

  // Driven by the catalog, not by the table: a setting that has never been
  // written must still appear, showing its default.
  return SETTING_KEYS.map((key) => {
    const row = byKey.get(key)
    return {
      key,
      group: SETTINGS_CATALOG[key].group,
      value: row ? row.value : SETTINGS_CATALOG[key].default,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
      updatedById: row?.updatedById ?? null,
    }
  })
}

export async function listSettingsByGroup(db: Db): Promise<SettingGroupDto[]> {
  const settings = await listSettings(db)
  const grouped = new Map<SettingGroup, SettingDto[]>()
  for (const setting of settings) {
    const bucket = grouped.get(setting.group)
    if (bucket) bucket.push(setting)
    else grouped.set(setting.group, [setting])
  }
  return [...grouped].map(([group, items]) => ({ group, settings: items }))
}

export interface UpdateSettingArgs {
  actor: Actor
  key: string
  value: unknown
  ip?: string
}

/**
 * Validate against the catalog, upsert, and audit — in that order.
 *
 * The caller is responsible for invalidating the settings cache afterwards.
 * The service does not do it itself because it may be running inside a
 * transaction that has not committed yet; invalidating early would repopulate
 * the cache with pre-commit data.
 */
export async function updateSetting(
  db: Db,
  args: UpdateSettingArgs,
): Promise<SettingDto> {
  const { key, value } = parseSettingValue(args.key, args.value)
  const group = SETTINGS_CATALOG[key].group

  const before = await db.setting.findUnique({ where: { key } })

  const row = await db.setting.upsert({
    where: { key },
    create: { key, group, value: value as never, updatedById: args.actor.id },
    update: { value: value as never, updatedById: args.actor.id },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'setting.updated',
    entity: 'Setting',
    entityId: key,
    before: before ? { value: before.value } : { value: SETTINGS_CATALOG[key].default },
    after: { value },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return {
    key,
    group,
    value: row.value,
    isDefault: false,
    updatedAt: row.updatedAt,
    updatedById: row.updatedById,
  }
}

export function settingKeys(): readonly SettingKey[] {
  return SETTING_KEYS
}
