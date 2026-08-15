'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requireAuth, requirePermission } from '@/lib/auth/session'
import { calendarFor } from '@/lib/calendar'
import { prisma } from '@/lib/db'
import { can } from '@/lib/rbac'
import { getSettings } from '@/lib/settings'
import { recomputeTaskSchedule } from '@/modules/calendar/job'

import { decideExtensionSchema, requestExtensionSchema } from './schema'
import { decideExtension, requestExtension } from './service'
import type { ExtensionRequestDto } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate.
 *
 * Requesting is `requireAuth` plus an ownership check inside the service: SPEC
 * §6 gates *approval* with `task.extend` and says nothing about asking, and
 * the phase brief puts the request in the assignee's hands. Anybody holding
 * `task.extend` may also raise one on someone's behalf, which is the ordinary
 * case of a manager filing it after a phone call.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

export const requestExtensionAction = requireAuth(
  async (actor, raw: unknown): Promise<ExtensionRequestDto> => {
    const input = requestExtensionSchema.parse(raw)
    const request = await requestExtension(prisma, {
      actor,
      input,
      mayRequestForOthers: can(actor, 'task.extend'),
      ip: await ip(),
    })
    revalidatePath('/tasks')
    return request
  },
)

export const decideExtensionAction = requirePermission(
  'task.extend',
  async (actor, raw: unknown): Promise<ExtensionRequestDto> => {
    const input = decideExtensionSchema.parse(raw)
    const request = await decideExtension(prisma, { actor, input, ip: await ip() })

    // An approved extension can take a task from "three days late and
    // escalated to the admin" to "not late at all". Waiting for 03:00 to
    // clear the flag would leave a red board all afternoon, so the one task
    // that changed is recomputed now. Idempotent, so the nightly run over it
    // later is a no-op.
    if (request.status === 'APPROVED') {
      const settings = await getSettings([
        'penalty.defaultGraceHours',
        'notifications.escalateToPmAfterDays',
        'notifications.escalateToAdminAfterDays',
      ])
      await recomputeTaskSchedule(prisma, {
        taskId: request.taskId,
        calendar: calendarFor(prisma),
        defaultGraceHours: settings['penalty.defaultGraceHours'],
        thresholds: {
          pmAfterDays: settings['notifications.escalateToPmAfterDays'],
          adminAfterDays: settings['notifications.escalateToAdminAfterDays'],
        },
        now: new Date(),
      })
    }

    revalidatePath('/tasks')
    revalidatePath(`/tasks/${request.taskId}`)
    return request
  },
)
