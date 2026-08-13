import { SUPER_ADMIN_ROLE, type Permission } from '@/lib/rbac'

let seq = 0

export interface BuiltRole {
  id: string
  nameEn: string
  nameAr: string
  description: string | null
  isSystem: boolean
  deletedAt: Date | null
  permissions: Permission[]
}

export function buildRole(overrides: Partial<BuiltRole> = {}): BuiltRole {
  seq += 1
  return {
    id: `role_${seq}`,
    nameEn: `ROLE_${seq}`,
    nameAr: `دور ${seq}`,
    description: null,
    isSystem: false,
    deletedAt: null,
    permissions: [],
    ...overrides,
  }
}

/**
 * The reserved role. Note it carries NO permission list: SUPER_ADMIN holds every
 * permission implicitly (SPEC §2), and a factory that enumerated them would
 * quietly turn that into a snapshot that goes stale the moment a permission is
 * added.
 */
export function buildSuperAdminRole(overrides: Partial<BuiltRole> = {}): BuiltRole {
  return buildRole({
    nameEn: SUPER_ADMIN_ROLE,
    nameAr: 'مدير النظام',
    isSystem: true,
    permissions: [],
    ...overrides,
  })
}
