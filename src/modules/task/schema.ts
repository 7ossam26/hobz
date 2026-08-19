import { z } from 'zod'

import { ar } from '@/i18n/ar'

import { TASK_STATUSES } from './state-machine'

/**
 * One Zod schema per input, shared between the server action and the form
 * (SPEC §3). The status enum is built from `TASK_STATUSES` rather than
 * re-listed, so the state machine and the validator can never drift apart.
 */

export const taskStatusSchema = z.enum(TASK_STATUSES)
export type TaskStatusInput = z.infer<typeof taskStatusSchema>

export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
export type PriorityInput = z.infer<typeof prioritySchema>

export const delayAttributionSchema = z.enum([
  'WORKER',
  'CLIENT',
  'INTERNAL',
  'DEPENDENCY',
])
export type DelayAttributionInput = z.infer<typeof delayAttributionSchema>

/**
 * Money arrives as a string and stays a string all the way to Prisma's
 * `Decimal` column — never parsed to `number` in between (CLAUDE.md
 * invariant 2). Same shape as `modules/user/schema.ts`'s `moneySchema`, and
 * for the same reason: `''` means "not provided", checked before the format
 * regex so a blank field never reports as malformed.
 */
const moneySchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))
  .refine((v) => v === null || /^\d{1,10}(\.\d{1,2})?$/.test(v), {
    message: ar.validation.amountFormat,
  })

/** A positive amount — the reassignment partial payment, which is a credit. */
const positiveMoneySchema = z
  .string()
  .trim()
  .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), {
    message: ar.validation.amountFormat,
  })
  .refine((v) => Number.parseFloat(v) > 0, {
    message: ar.tasks.errors.partialAmountInvalid,
  })

/**
 * Hours, not money, so a `number` is honest here — but bounded and 2dp, so a
 * fat-fingered `800` on a task cannot quietly wreck the estimate-accuracy
 * component of a performance score (SPEC §5.6).
 */
const estimatedHoursSchema = z
  .number()
  .min(0, ar.validation.amountNegative)
  .max(9999)
  .refine((v) => Number.isFinite(v) && Math.round(v * 100) === v * 100, {
    message: ar.validation.amountFormat,
  })
  .default(0)

const dateInput = z.union([z.coerce.date(), z.date()])

const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))

const optionalText = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))

/**
 * Exported so `modules/project-template` can reuse the exact field set when it
 * learns to spawn tasks, rather than growing a second drifting copy — the same
 * reason `projectCoreShape` is exported from `modules/project/schema.ts`.
 */
export const taskCoreShape = {
  title: z.string().trim().min(1, ar.validation.required).max(200),
  description: optionalText,
  milestoneId: optionalId,
  priority: prioritySchema.default('MEDIUM'),
  /** Validated against the live Settings list in the service, not here. */
  categoryId: z.string().trim().min(1, ar.validation.required).max(40),
  estimatedHours: estimatedHoursSchema,
  dueDate: dateInput,
}

export const createTaskSchema = z.object({
  projectId: z.string().min(1),
  ...taskCoreShape,
  /** Assigning at creation is an assignment: it moves the task to ASSIGNED. */
  assigneeId: optionalId,
  /** Omitted → auto-filled from the assignee's `defaultTaskRate`. */
  taskValue: moneySchema,
  watcherIds: z.array(z.string().min(1)).default([]),
})
export type CreateTaskInput = z.infer<typeof createTaskSchema>

/**
 * Status and assignee are deliberately absent: both have their own guarded
 * paths (`transitionTask`, `assignTask`) with their own permissions
 * (`task.approve`, `task.cancel`, `task.assign`). Letting a generic edit carry
 * a status would route around the state machine and around SPEC §6.
 */
export const updateTaskSchema = z.object({
  id: z.string().min(1),
  ...taskCoreShape,
  taskValue: moneySchema,
  delayReason: optionalText,
  delayAttribution: delayAttributionSchema.nullable().optional().default(null),
})
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

export const taskIdSchema = z.object({ id: z.string().min(1) })

/**
 * SPEC M4: reassignment mid-task opens the "pay the previous assignee?"
 * decision. `partialAmount` is optional and never defaulted — an absent amount
 * means the manager chose not to pay, which must stay distinguishable from
 * "the field did not reach the server".
 */
export const assignTaskSchema = z.object({
  taskId: z.string().min(1),
  assigneeId: z.string().trim().min(1, ar.tasks.errors.assigneeRequired),
  taskValue: moneySchema,
  partialAmount: positiveMoneySchema.optional(),
})
export type AssignTaskInput = z.infer<typeof assignTaskSchema>

export const taskWatcherSchema = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1),
})
export type TaskWatcherInput = z.infer<typeof taskWatcherSchema>

export const taskDependencySchema = z.object({
  taskId: z.string().min(1),
  dependsOnTaskId: z.string().min(1),
})
export type TaskDependencyInput = z.infer<typeof taskDependencySchema>

/** 1–5, set on approval, feeding the performance score (SPEC §5.6). */
export const qualityRatingSchema = z
  .number()
  .int()
  .min(1, ar.tasks.errors.ratingRange)
  .max(5, ar.tasks.errors.ratingRange)

export const approveTaskSchema = z.object({
  taskId: z.string().min(1),
  qualityRating: qualityRatingSchema,
})
export type ApproveTaskInput = z.infer<typeof approveTaskSchema>

/**
 * SPEC T4: a revision request sets a **new due date**. The penalty already
 * accrued on the original delivery stands and is frozen; the revision accrues
 * against this date.
 */
export const requestRevisionSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().trim().min(1, ar.validation.required).max(2000),
  newDueDate: dateInput,
})
export type RequestRevisionInput = z.infer<typeof requestRevisionSchema>

export const blockTaskSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().trim().min(1, ar.validation.required).max(2000),
})
export type BlockTaskInput = z.infer<typeof blockTaskSchema>

export const cancelTaskSchema = blockTaskSchema
export type CancelTaskInput = z.infer<typeof cancelTaskSchema>

export const transitionTaskSchema = z.object({
  taskId: z.string().min(1),
  to: taskStatusSchema,
  reason: optionalText,
})
export type TransitionTaskInput = z.infer<typeof transitionTaskSchema>

export const addCommentSchema = z.object({
  taskId: z.string().min(1),
  body: z.string().trim().min(1, ar.tasks.errors.commentEmpty).max(4000),
})
export type AddCommentInput = z.infer<typeof addCommentSchema>

export const listTasksSchema = z.object({
  search: z.string().trim().optional(),
  projectId: z.array(z.string()).optional(),
  milestoneId: z.array(z.string()).optional(),
  status: z.array(taskStatusSchema).optional(),
  priority: z.array(prioritySchema).optional(),
  categoryId: z.array(z.string()).optional(),
  assigneeId: z.array(z.string()).optional(),
  /** Tasks past `dueDate` and not yet delivered. */
  overdueOnly: z.boolean().optional(),
  /**
   * Due within `tasks.dueSoonDays` and not yet delivered (Phase 5 list facet).
   * Renamed from `dueThisWeek` in Phase 12, when the seven days became a
   * Settings value and "this week" stopped being guaranteed true.
   */
  dueSoon: z.boolean().optional(),
  /**
   * A due-date window, inclusive at both ends. The calendar grid's real filter:
   * it used to fetch the whole 1000-row ceiling and drop everything outside the
   * visible month in application code, which made the payload roughly thirty
   * times what the screen showed. A `BETWEEN` on an indexed column expresses it
   * exactly, so nothing about *which* tasks appear changes — only how many rows
   * cross the wire.
   */
  dueFrom: z.date().optional(),
  dueTo: z.date().optional(),
  sort: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).default(1),
  /**
   * The list view never asks past 100 (`PAGE_SIZES`, `components/shared/
   * data-table/state.ts`) — the 1000 ceiling exists only for the Phase 5
   * board and calendar reads, which fetch the whole scoped-and-filtered set
   * once and group it in memory (`modules/task/queries.ts`), the same
   * "fetch small, group in the app" trade `listProjects`'s Arabic search
   * branch already makes at this SPEC §2 scale.
   */
  pageSize: z.number().int().min(1).max(1000).default(25),
})
export type ListTasksInput = z.infer<typeof listTasksSchema>

/** Phase 5 — bulk actions from the list view's row-selection toolbar. */
export const bulkAssignTasksSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1),
  assigneeId: z.string().trim().min(1, ar.tasks.errors.assigneeRequired),
})
export type BulkAssignTasksInput = z.infer<typeof bulkAssignTasksSchema>

export const bulkSetPrioritySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1),
  priority: prioritySchema,
})
export type BulkSetPriorityInput = z.infer<typeof bulkSetPrioritySchema>

export const bulkSetDueDateSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1),
  dueDate: dateInput,
})
export type BulkSetDueDateInput = z.infer<typeof bulkSetDueDateSchema>
