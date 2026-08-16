'use server'

import { revalidatePath } from 'next/cache'

import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/db'

import { notificationIdSchema, updateNotificationPreferenceSchema } from './schema'
import { markAllRead, markRead, setPreference } from './service'
import type { NotificationPreferenceDto } from './types'

/**
 * Thin server actions: session → zod → service → revalidate. `requireAuth`,
 * not `requirePermission` — every one of these operates on the caller's own
 * inbox or the caller's own preferences, so authentication is the only gate
 * (the same reasoning `modules/ledger/queries.ts.getMyLedgerPage` documents
 * for مستحقاتي).
 */

function revalidateNotifications(): void {
  revalidatePath('/notifications')
  revalidatePath('/notifications/preferences')
}

export const markNotificationReadAction = requireAuth(
  async (actor, raw: unknown): Promise<void> => {
    const input = notificationIdSchema.parse(raw)
    await markRead(prisma, { userId: actor.id, id: input.id })
    revalidateNotifications()
  },
)

export const markAllNotificationsReadAction = requireAuth(
  async (actor): Promise<number> => {
    const count = await markAllRead(prisma, actor.id)
    revalidateNotifications()
    return count
  },
)

/**
 * SPEC §8: `TASK_ASSIGNED`/`TASK_OVERDUE` cannot be disabled. Enforced in
 * `modules/notification/service.ts.setPreference` — this action carries no
 * extra check of its own, because a second copy of the rule here is a second
 * place it could drift from the one that actually matters (the direct
 * service call a test or a future caller might make).
 */
export const updateNotificationPreferenceAction = requireAuth(
  async (actor, raw: unknown): Promise<NotificationPreferenceDto> => {
    const input = updateNotificationPreferenceSchema.parse(raw)
    const result = await setPreference(prisma, {
      userId: actor.id,
      type: input.type,
      enabled: input.enabled,
    })
    revalidateNotifications()
    return result
  },
)
