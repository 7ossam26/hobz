'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { DomainError } from '@/lib/errors'
import { assertCan } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'

import {
  recordAdjustmentSchema,
  recordAdvanceSchema,
  recordBonusSchema,
  reverseEntrySchema,
} from './schema'
import {
  getEntry,
  recordAdjustment,
  recordAdvance,
  recordBonus,
  reverseEntry,
} from './service'
import type { LedgerEntryDto } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate
 * (CLAUDE.md invariant 3).
 *
 * Each one opens a transaction, because every ledger write is paired with an
 * audit row and the two must land together (invariant 7).
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

function revalidateMoney(userId: string): void {
  revalidatePath('/my-earnings')
  revalidatePath('/payouts')
  revalidatePath(`/users/${userId}`)
}

export const recordAdvanceAction = requirePermission(
  'advance.create',
  async (actor, raw: unknown): Promise<LedgerEntryDto> => {
    const input = recordAdvanceSchema.parse(raw)
    const cycleDay = await getSetting('payout.cycleDay')
    const clientIp = await ip()

    const entry = await prisma.$transaction((tx) =>
      recordAdvance(tx, {
        userId: input.userId,
        amount: input.amount,
        note: input.note,
        actor,
        cycleDay,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney(input.userId)
    return entry
  },
)

/**
 * SPEC M4's reassignment decision reaches the ledger through
 * `modules/ledger/port.ts`, not through here. This is the manual instrument:
 * the correction for anything a `REVERSAL` may not touch (an entry in a cycle
 * that has already been paid out).
 *
 * Gated on `penalty.create` — the catalog has no `adjustment.*` key, and
 * inventing one would be inventing a permission (the same reasoning SPEC §6
 * records for the three Phase-6 reads). `penalty.create` is the narrowest
 * existing key that already means "may move money against a منفّذ by hand".
 */
export const recordAdjustmentAction = requirePermission(
  'penalty.create',
  async (actor, raw: unknown): Promise<LedgerEntryDto> => {
    const input = recordAdjustmentSchema.parse(raw)

    // An `ADJUSTMENT` is signed, so this one action can debit *or* credit — and
    // a credit is money into somebody's pocket, which SPEC §6 puts behind
    // `bonus.create`. Gating the whole action on `penalty.create` alone would
    // let "may deduct by hand" quietly mean "may pay anyone anything".
    if (Number(input.amount) > 0) assertCan(actor, 'bonus.create')

    const cycleDay = await getSetting('payout.cycleDay')
    const clientIp = await ip()

    const entry = await prisma.$transaction((tx) =>
      recordAdjustment(tx, {
        userId: input.userId,
        amount: input.amount,
        reason: input.reason,
        actor,
        cycleDay,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney(input.userId)
    return entry
  },
)

export const recordBonusAction = requirePermission(
  'bonus.create',
  async (actor, raw: unknown): Promise<LedgerEntryDto> => {
    const input = recordBonusSchema.parse(raw)
    const cycleDay = await getSetting('payout.cycleDay')
    const clientIp = await ip()

    const entry = await prisma.$transaction((tx) =>
      recordBonus(tx, {
        userId: input.userId,
        amount: input.amount,
        reason: input.reason,
        actor,
        cycleDay,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney(input.userId)
    return entry
  },
)

/**
 * Reversing a bonus needs `bonus.reverse`; reversing a penalty needs
 * `penalty.reverse` (SPEC §6). The permission therefore depends on the *entry*,
 * which is only known after a read — so the action gates on the narrower of the
 * two up front and re-checks against the row's real type.
 *
 * Phase 8 owns the penalty half of this and will call the service directly from
 * its own recomputation path; this action is the human one.
 */
export const reverseLedgerEntryAction = requirePermission(
  'penalty.reverse',
  async (actor, raw: unknown): Promise<LedgerEntryDto> => {
    const input = reverseEntrySchema.parse(raw)
    const original = await getEntry(prisma, input.entryId)

    /**
     * SPEC §6 gives reversal exactly two keys — `penalty.reverse` and
     * `bonus.reverse` — so exactly two kinds of entry are reversible *by a
     * human through this action*. `penalty.reverse` getting somebody through
     * the door must not silently also grant them reversal of a salary, an
     * advance or a payment, none of which the catalog contemplates.
     *
     * The other types are still reversible on the paths that own them: the
     * cancellation subscriber reverses an `EARNING`, Phase 8's recomputation
     * reverses its own `PENALTY`. What a human has, for everything else, is an
     * `ADJUSTMENT` with a mandatory reason — which is the more honest record
     * anyway, because it says a decision was made rather than that history
     * changed.
     */
    if (original.type === 'BONUS') {
      assertCan(actor, 'bonus.reverse')
    } else if (original.type !== 'PENALTY') {
      throw new DomainError('ledger.errors.notHumanReversible', {
        entryId: original.id,
        type: original.type,
      })
    }

    const cycleDay = await getSetting('payout.cycleDay')
    const clientIp = await ip()

    const entry = await prisma.$transaction((tx) =>
      reverseEntry(tx, {
        entryId: input.entryId,
        reason: input.reason,
        actor,
        cycleDay,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney(entry.userId)
    return entry
  },
)
