import type { PayType } from './schema'

export interface UserRoleDto {
  id: string
  nameAr: string
  nameEn: string
}

export interface UserSummaryDto {
  id: string
  username: string
  fullName: string
  phone: string | null
  isWorker: boolean
  isActive: boolean
  mustChangePassword: boolean
  payType: PayType
  roles: UserRoleDto[]
}

export interface UserDetailDto extends UserSummaryDto {
  /** Money crosses this boundary as a string, never a `number` (invariant 2). */
  monthlySalary: string | null
  defaultTaskRate: string | null
  weeklyCapacityHours: number
  penaltyProfileId: string | null
  timezone: string
  createdAt: Date
}

export interface UserPageDto {
  items: UserSummaryDto[]
  total: number
  page: number
  pageSize: number
}

/**
 * The port Phase 4 fills in. Deactivation is blocked while the user still owns
 * work, and "owns work" is a Task question — a table that does not exist yet.
 */
export interface OpenTaskRef {
  id: string
  title: string
}
