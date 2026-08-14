import type { Permission } from '@/lib/rbac'

export interface RoleSummaryDto {
  id: string
  nameAr: string
  nameEn: string
  description: string | null
  isSystem: boolean
  /**
   * `null` for SUPER_ADMIN — it holds every permission implicitly, and a count
   * would be a snapshot that goes stale the moment a phase adds a key
   * (SPEC §2). The UI renders a sentence there, not a number.
   */
  permissionCount: number | null
  memberCount: number
}

export interface RoleDetailDto extends RoleSummaryDto {
  permissions: Permission[]
  /** True when this role's permission set is implicit and not editable. */
  holdsAllPermissions: boolean
}

/** One checkbox group in the role editor: a permission domain and its keys. */
export interface PermissionGroupDto {
  domain: string
  labelAr: string
  permissions: Array<{ key: Permission; descriptionAr: string }>
}
