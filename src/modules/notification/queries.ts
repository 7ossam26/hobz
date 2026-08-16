import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'

import { listNotificationsSchema } from './schema'
import { getUnreadCount, listNotifications, listPreferences } from './service'
import type { NotificationPageDto, NotificationPreferenceDto } from './types'

/**
 * Read paths for Server Components — always the caller's own inbox. There is
 * no `userId` parameter anywhere in this file, on purpose: unlike `ledger` or
 * `payout`, there is no "view all" notification permission in SPEC §6, so a
 * notification is never anyone's business but the recipient's.
 */

export async function getMyNotifications(raw?: unknown): Promise<NotificationPageDto> {
  const actor = await requireActor()
  const filters = listNotificationsSchema.parse(raw ?? {})
  return listNotifications(prisma, { userId: actor.id, ...filters })
}

export async function getMyUnreadCount(): Promise<number> {
  const actor = await requireActor()
  return getUnreadCount(prisma, actor.id)
}

export async function getMyNotificationPreferences(): Promise<NotificationPreferenceDto[]> {
  const actor = await requireActor()
  return listPreferences(prisma, actor.id)
}
