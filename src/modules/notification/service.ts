import type { NotificationType, Prisma } from '@prisma/client'

import type { Db } from '@/lib/db'
import { DomainError, NotFoundError } from '@/lib/errors'
import { isUniqueViolation } from '@/modules/ledger/service'

import type { ComposedMessage } from './messages'
import {
  ALL_NOTIFICATION_TYPES,
  isMandatoryType,
  type NotificationDto,
  type NotificationPageDto,
  type NotificationPreferenceDto,
} from './types'

/**
 * modules/notification/service.ts — pure functions over an injected `Db`
 * (CLAUDE.md architecture rule), the write path every event bus adapter and
 * every server action goes through.
 */

/** What a `Notification.entityType`/`entityId` pair resolves to on screen. */
function hrefFor(entityType: string | null, entityId: string | null): string | null {
  if (entityType === 'Task' && entityId) return `/tasks/${entityId}`
  if (entityType === 'Payout') return '/my-earnings'
  return null
}

interface NotificationRow {
  id: string
  type: NotificationType
  title: string
  body: string
  entityType: string | null
  entityId: string | null
  dismissable: boolean
  isRead: boolean
  readAt: Date | null
  createdAt: Date
}

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    href: hrefFor(row.entityType, row.entityId),
    dismissable: row.dismissable,
    isRead: row.isRead,
    readAt: row.readAt,
    createdAt: row.createdAt,
  }
}

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  entityType: true,
  entityId: true,
  dismissable: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Preferences (SPEC §8: per-user, except two that cannot be disabled)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A missing row means "enabled" — the same reasoning `lib/settings` uses for
 * the agency-wide catalog (a fresh user needs no seed rows to have every
 * non-mandatory type on). Mandatory types short-circuit to `true` without a
 * query: no override can ever have been written for them (`setPreference`
 * refuses the write), so asking the database would be answering a question
 * this function already knows the answer to.
 */
export async function isTypeEnabled(
  db: Db,
  userId: string,
  type: NotificationType,
): Promise<boolean> {
  if (isMandatoryType(type)) return true
  const row = await db.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
    select: { enabled: true },
  })
  return row?.enabled ?? true
}

export interface SetPreferenceArgs {
  userId: string
  type: NotificationType
  enabled: boolean
}

/**
 * SPEC §8: "except two that cannot be disabled." Enforced here — the one
 * write path every preference change goes through — not only in the UI,
 * which CLAUDE.md invariant 3 calls cosmetic. A direct call to this function
 * with `enabled: false` for `TASK_ASSIGNED`/`TASK_OVERDUE` throws exactly as
 * a server action attempting it would.
 */
export async function setPreference(
  db: Db,
  args: SetPreferenceArgs,
): Promise<NotificationPreferenceDto> {
  if (isMandatoryType(args.type) && !args.enabled) {
    throw new DomainError('notifications.errors.mandatoryType', { type: args.type })
  }

  await db.notificationPreference.upsert({
    where: { userId_type: { userId: args.userId, type: args.type } },
    create: { userId: args.userId, type: args.type, enabled: args.enabled },
    update: { enabled: args.enabled },
  })

  return { type: args.type, enabled: args.enabled, locked: isMandatoryType(args.type) }
}

/** The full 16-row table the preferences page renders — never fewer, never more. */
export async function listPreferences(
  db: Db,
  userId: string,
): Promise<NotificationPreferenceDto[]> {
  const rows = await db.notificationPreference.findMany({
    where: { userId },
    select: { type: true, enabled: true },
  })
  const overrides = new Map(rows.map((r) => [r.type, r.enabled]))

  return ALL_NOTIFICATION_TYPES.map((type) => ({
    type,
    enabled: isMandatoryType(type) ? true : (overrides.get(type) ?? true),
    locked: isMandatoryType(type),
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery — the one write path every event bus adapter shares
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliverNotificationArgs {
  userId: string
  type: NotificationType
  message: ComposedMessage
  /**
   * De-duplicates a scheduled or threshold-crossing delivery (`TASK_DUE_SOON`
   * keyed on the due date, `MANAGER_DIGEST` keyed on the Cairo day). Omitted
   * for one-shot events, which rely on their own domain rule firing once.
   */
  dedupeKey?: string | null
}

/**
 * Write one `Notification`, honouring the recipient's preference.
 *
 * Returns `null`, never throws, when the type is disabled or a duplicate
 * delivery was caught by the `dedupeKey` unique index — both are "nothing to
 * do", not failures, and a caller iterating many recipients (the digest) must
 * not have one disabled preference abort the rest.
 */
export async function deliverNotification(
  db: Db,
  args: DeliverNotificationArgs,
): Promise<NotificationDto | null> {
  if (!(await isTypeEnabled(db, args.userId, args.type))) return null

  try {
    const row = await db.notification.create({
      data: {
        userId: args.userId,
        type: args.type,
        title: args.message.title,
        body: args.message.body,
        entityType: args.message.entityType,
        entityId: args.message.entityId,
        payload: (args.message.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        dismissable: args.message.dismissable,
        dedupeKey: args.dedupeKey ?? null,
      },
      select: NOTIFICATION_SELECT,
    })
    return toDto(row)
  } catch (error) {
    if (isUniqueViolation(error)) return null
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading and marking read — always the caller's own inbox
// ─────────────────────────────────────────────────────────────────────────────

export interface ListNotificationsArgs {
  userId: string
  page: number
  pageSize: number
  unreadOnly: boolean
}

export async function listNotifications(
  db: Db,
  args: ListNotificationsArgs,
): Promise<NotificationPageDto> {
  const where = {
    userId: args.userId,
    ...(args.unreadOnly ? { isRead: false } : {}),
  }

  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
      select: NOTIFICATION_SELECT,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId: args.userId, isRead: false } }),
  ])

  return {
    items: rows.map(toDto),
    total,
    unreadCount: unread,
    page: args.page,
    pageSize: args.pageSize,
  }
}

export async function getUnreadCount(db: Db, userId: string): Promise<number> {
  return db.notification.count({ where: { userId, isRead: false } })
}

export async function markRead(
  db: Db,
  args: { userId: string; id: string },
): Promise<void> {
  const result = await db.notification.updateMany({
    where: { id: args.id, userId: args.userId },
    data: { isRead: true, readAt: new Date() },
  })
  if (result.count === 0) throw new NotFoundError('Notification', args.id)
}

/** Returns how many rows flipped, so the drawer can toast a real count. */
export async function markAllRead(db: Db, userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  })
  return result.count
}
