import type { MilestoneStatusInput } from './schema'

export interface MilestoneDto {
  id: string
  projectId: string
  name: string
  dueDate: Date | null
  order: number
  status: MilestoneStatusInput
}
