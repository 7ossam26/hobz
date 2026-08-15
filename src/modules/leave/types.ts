import type { CairoDateKey } from '@/lib/calendar'

import type { LeaveStatusInput } from './schema'

export interface LeavePersonDto {
  id: string
  fullName: string
  username: string
}

export interface LeaveDto {
  id: string
  user: LeavePersonDto
  /** Inclusive Cairo dates. */
  startDate: CairoDateKey
  endDate: CairoDateKey
  /** Calendar days covered, inclusive of both ends. */
  totalDays: number
  typeId: string
  status: LeaveStatusInput
  note: string | null
  requestedBy: LeavePersonDto
  decidedBy: LeavePersonDto | null
  decidedAt: Date | null
  decisionNote: string | null
  createdAt: Date
}

export interface LeavePageDto {
  items: LeaveDto[]
  total: number
  page: number
  pageSize: number
}

/**
 * The non-blocking warning the phase brief asks for: "a warning (not a block)
 * when assigning a task that falls inside approved leave".
 *
 * A DTO rather than a thrown error, because that is the difference between a
 * warning and a block. `modules/task` already models finish-to-start
 * dependencies the same way (`DependencyWarningDto`) — the call succeeds and
 * the caller is told.
 */
export interface LeaveWarningDto {
  leaveId: string
  userId: string
  userFullName: string
  startDate: CairoDateKey
  endDate: CairoDateKey
  typeId: string
}
