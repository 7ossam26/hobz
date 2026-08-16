import type { NotificationType } from '@prisma/client'

export type { NotificationType }

/** The two types SPEC §8 says a منفّذ may never turn off. */
export const MANDATORY_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'TASK_ASSIGNED',
  'TASK_OVERDUE',
]

/**
 * Every value the `NotificationType` enum carries. Kept as one literal list
 * (rather than reading `Object.values` off the Prisma enum object) so the
 * preferences page shows every type — including one nobody has an override
 * row for yet — without a database round trip.
 */
export const ALL_NOTIFICATION_TYPES: readonly NotificationType[] = [
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
]

export function isMandatoryType(type: NotificationType): boolean {
  return (MANDATORY_NOTIFICATION_TYPES as readonly string[]).includes(type)
}

export interface NotificationDto {
  id: string
  type: NotificationType
  title: string
  body: string
  entityType: string | null
  entityId: string | null
  /** The deep link, derived from `entityType`/`entityId` — null when neither is set. */
  href: string | null
  dismissable: boolean
  isRead: boolean
  readAt: Date | null
  createdAt: Date
}

export interface NotificationPageDto {
  items: NotificationDto[]
  total: number
  unreadCount: number
  page: number
  pageSize: number
}

export interface NotificationPreferenceDto {
  type: NotificationType
  enabled: boolean
  /** True for `MANDATORY_NOTIFICATION_TYPES` — the UI greys the toggle out. */
  locked: boolean
}
