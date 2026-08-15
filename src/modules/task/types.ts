import type { AssignmentLeaveWarning } from './ports'
import type { DelayAttributionInput, PriorityInput } from './schema'
import type { TaskStatus } from './state-machine'

/**
 * DTOs crossing out of the module. Money is always a string here, never a
 * `number` (CLAUDE.md invariant 2) — the same rule `modules/user/types.ts`
 * follows for `monthlySalary`.
 */

export interface TaskPersonDto {
  id: string
  fullName: string
  username: string
}

export interface TaskSummaryDto {
  id: string
  projectId: string
  projectName: string
  /** The project's short code (`PRJ-0001…`) — Phase 5's board/card identity mark. */
  projectCode: string
  milestoneId: string | null
  title: string
  status: TaskStatus
  priority: PriorityInput
  categoryId: string
  assignee: TaskPersonDto | null
  taskValue: string
  estimatedHours: string
  dueDate: Date
  /** True when past `dueDate` and not yet delivered. */
  isOverdue: boolean
}

export interface TaskDetailDto extends TaskSummaryDto {
  description: string | null
  originalDueDate: Date
  assignedAt: Date | null
  startedAt: Date | null
  submittedAt: Date | null
  approvedAt: Date | null
  elapsedMinutesRaw: number
  elapsedMinutesWorking: number
  delayReason: string | null
  delayAttribution: DelayAttributionInput | null
  qualityRating: number | null
  watchers: TaskPersonDto[]
  createdAt: Date
}

export interface TaskPageDto {
  items: TaskSummaryDto[]
  total: number
  page: number
  pageSize: number
}

/**
 * Finish-to-start, warning only (SPEC §4). This DTO is the banner Phase 5
 * renders; nothing in the service consumes it as a gate.
 */
export interface DependencyWarningDto {
  taskId: string
  title: string
  status: TaskStatus
  projectId: string
}

/**
 * One side of the Phase 5 dependencies tab's graph — a dependency this task
 * is waiting on, or a task waiting on this one. `satisfied` mirrors the same
 * APPROVED/DONE test `DependencyWarningDto`'s absence implies; carried
 * explicitly here because this DTO, unlike the warning list, includes
 * satisfied rows too.
 */
export interface DependencyRowDto {
  taskId: string
  title: string
  status: TaskStatus
  projectId: string
  satisfied: boolean
}

export interface TaskCommentDto {
  id: string
  taskId: string
  author: TaskPersonDto
  body: string
  /** Resolved user ids, not raw handles. */
  mentions: string[]
  createdAt: Date
}

export type TaskActivityKind =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'ASSIGNED'
  | 'WATCHER_ADDED'
  | 'WATCHER_REMOVED'
  | 'COMMENTED'
  | 'DUE_DATE_CHANGED'
  | 'VALUE_CHANGED'
  | 'UPDATED'
  | 'DEPENDENCY_ADDED'
  | 'DEPENDENCY_REMOVED'
  | 'ELAPSED_RECOMPUTED'

export interface TaskActivityDto {
  id: string
  taskId: string
  /** Null for scheduler/system activity. */
  actor: TaskPersonDto | null
  type: TaskActivityKind
  from: string | null
  to: string | null
  createdAt: Date
}

/**
 * What a transition returns. `warnings` is how "starting a task whose
 * dependency is unapproved must succeed and surface a warning" is expressed:
 * the call resolves, and the caller is told.
 */
export interface TaskTransitionResultDto {
  task: TaskDetailDto
  warnings: DependencyWarningDto[]
}

/**
 * What an assignment returns (Phase 6).
 *
 * Same shape and same reasoning as `TaskTransitionResultDto`: the phase brief
 * asks for "a warning (not a block) when assigning a task that falls inside
 * approved leave", and a warning that the caller cannot see is not a warning.
 * The call resolves, the assignment stands, and the manager is told that
 * أحمد is away for four of the six days they just gave him.
 */
export interface TaskAssignmentResultDto {
  task: TaskDetailDto
  leaveWarnings: AssignmentLeaveWarning[]
}

/**
 * Creating a task with an assignee *is* an assignment (it takes the BACKLOG →
 * ASSIGNED edge at birth), so it can warn about leave too — and it carries the
 * dependency warnings a fresh task can already have. Hence both lists, rather
 * than an always-empty `leaveWarnings` bolted onto every transition result.
 */
export interface TaskCreationResultDto extends TaskTransitionResultDto {
  leaveWarnings: AssignmentLeaveWarning[]
}
