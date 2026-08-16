import { z } from 'zod'

const NOTIFICATION_TYPE = z.enum([
  'TASK_ASSIGNED',
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'TASK_SUBMITTED',
  'TASK_REVISION_REQUESTED',
  'TASK_APPROVED',
  'TASK_ESCALATED',
  'TASK_MENTIONED',
  'PENALTY_APPLIED',
  'BONUS_GRANTED',
  'MONEY_REVERSED',
  'PAYOUT_APPROVED',
  'PAYOUT_PAID',
  'EXTENSION_REQUESTED',
  'EXTENSION_DECIDED',
  'MANAGER_DIGEST',
])

export const listNotificationsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  unreadOnly: z.boolean().default(false),
})
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>

export const notificationIdSchema = z.object({ id: z.string().min(1) })
export type NotificationIdInput = z.infer<typeof notificationIdSchema>

export const updateNotificationPreferenceSchema = z.object({
  type: NOTIFICATION_TYPE,
  enabled: z.boolean(),
})
export type UpdateNotificationPreferenceInput = z.infer<
  typeof updateNotificationPreferenceSchema
>
