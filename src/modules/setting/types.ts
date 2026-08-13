import type { SettingGroup, SettingKey } from '@/lib/settings'

/** What a read path returns. Never the raw Prisma row. */
export interface SettingDto {
  key: SettingKey
  group: SettingGroup
  value: unknown
  /** True when no row exists yet and the catalog default is being reported. */
  isDefault: boolean
  updatedAt: Date | null
  updatedById: string | null
}

export interface SettingGroupDto {
  group: SettingGroup
  settings: SettingDto[]
}
