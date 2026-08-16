'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { notificationPayoutEvents } from '@/modules/notification/bus'

import { closeCycleUnderLock } from './job'
import { closeCycleSchema, markPayoutPaidSchema, payoutIdSchema } from './schema'
import { approvePayout, markPayoutPaid } from './service'
import type { CloseCycleResult, PayoutDto } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate.
 *
 * SPEC §6's three keys, kept apart on purpose: generating the payouts, agreeing
 * they are right, and handing over the money are three decisions and often
 * three people.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

function revalidateMoney(): void {
  revalidatePath('/payouts')
  revalidatePath('/my-earnings')
}

/**
 * SPEC §5.5's "also closeable early by permission".
 *
 * Goes through the same advisory lock as the scheduled close and passes
 * `allowEarly` — this action *is* the permission the SPEC sentence refers to,
 * so it is the one caller allowed to settle a cycle before its `periodEnd`.
 */
export const closeCycleAction = requirePermission(
  'payout.generate',
  async (actor, raw: unknown): Promise<CloseCycleResult & { acquired: boolean }> => {
    const input = closeCycleSchema.parse(raw ?? {})
    const settings = await getSettings(['payout.cycleDay'])
    const clientIp = await ip()

    const outcome = await closeCycleUnderLock(prisma, {
      actor,
      now: new Date(),
      cycleDay: settings['payout.cycleDay'],
      allowEarly: true,
      ...(input.cycleId ? { cycleId: input.cycleId } : {}),
      ...(clientIp ? { ip: clientIp } : {}),
    })

    revalidateMoney()

    return outcome.result
      ? { ...outcome.result, acquired: true }
      : {
          acquired: false,
          closed: false,
          cycleId: null,
          nextCycleId: null,
          payoutsCreated: 0,
          salaryEntries: 0,
          skipped: null,
        }
  },
)

export const approvePayoutAction = requirePermission(
  'payout.approve',
  async (actor, raw: unknown): Promise<PayoutDto> => {
    const input = payoutIdSchema.parse(raw)
    const clientIp = await ip()

    const payout = await prisma.$transaction((tx) =>
      approvePayout(tx, {
        payoutId: input.payoutId,
        actor,
        now: new Date(),
        events: notificationPayoutEvents,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney()
    return payout
  },
)

export const markPayoutPaidAction = requirePermission(
  'payout.markPaid',
  async (actor, raw: unknown): Promise<PayoutDto> => {
    const input = markPayoutPaidSchema.parse(raw)
    const settings = await getSettings(['payout.cycleDay', 'payout.paymentMethods'])
    const clientIp = await ip()

    // One transaction: the PAYOUT ledger entry, the running paidAmount and the
    // audit row are one payment or they are none of it.
    const payout = await prisma.$transaction((tx) =>
      markPayoutPaid(tx, {
        payoutId: input.payoutId,
        amount: input.amount,
        paymentMethods: settings['payout.paymentMethods'],
        actor,
        cycleDay: settings['payout.cycleDay'],
        now: new Date(),
        events: notificationPayoutEvents,
        ...(input.method ? { method: input.method } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.note ? { note: input.note } : {}),
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney()
    return payout
  },
)
