import type { EffectiveHealth } from './health'
import type { EngagementType, ProjectMemberRoleInput, ProjectStatusInput } from './schema'

export interface ProjectClientRefDto {
  id: string
  name: string
}

export interface ProjectOwnerRefDto {
  id: string
  fullName: string
  username: string
  phone: string | null
  isActive: boolean
}

export interface ProjectMemberDto {
  userId: string
  fullName: string
  username: string
  phone: string | null
  isActive: boolean
  role: ProjectMemberRoleInput
  addedAt: Date
}

export interface ProjectSummaryDto {
  id: string
  code: string
  name: string
  client: ProjectClientRefDto | null
  owner: ProjectOwnerRefDto
  engagementType: EngagementType
  status: ProjectStatusInput
  startDate: Date
  dueDate: Date
  health: EffectiveHealth
  milestoneCount: number
  memberCount: number
}

export interface ProjectDetailDto extends ProjectSummaryDto {
  gracePeriodHours: number | null
  penalizeRevisionLateness: boolean | null
  members: ProjectMemberDto[]
  createdAt: Date
  updatedAt: Date
}

export interface ProjectPageDto {
  items: ProjectSummaryDto[]
  total: number
  page: number
  pageSize: number
}

export interface ProjectFacetOptionsDto {
  owners: ProjectOwnerRefDto[]
  clients: ProjectClientRefDto[]
  statusCounts: Partial<Record<ProjectStatusInput, number>>
}
