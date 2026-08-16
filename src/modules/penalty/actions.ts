'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { calendarFor } from '@/lib/calendar'
import { prisma } from '@/lib/db'
import { DomainError } from '@/lib/errors'
import { assertCan } from '@/lib/rbac'

import {
  assignPenaltyProfile,
  createPenaltyProfile,
  deletePenaltyProfile,
  updatePenaltyProfile,
} from './profiles'
import {
  assignPenaltyProfileSchema,
  createPenaltySchema,
  deletePenaltyProfileSchema,
  grantBonusSchema,
  penaltyProfileSchema,
  recomputeTaskPenaltySchema,
  reverseMoneyEntrySchema,
  updatePenaltyProfileSchema,
} from './schema'
import {
  createManualPenalty,
  grantBonus,
  recomputeTaskPenalty,
  reversePenaltyOrBonus,
} from './service'
import { loadPenaltySettings } from './settings'
import type { PenaltyProfileDto, PenaltyRecomputeResult } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate
 * (CLAUDE.md invariant 3).
 *
 * Each opens a transaction, for two reasons rather than one. Every ledger write
 * is paired with an audit row and the two must land together (invariant 7) —
 * and `recomputeTaskPenalty`'s per-task advisory lock is *transaction*-scoped,
 * so calling it outside one would take a lock on a pooled connection and
 * release it before the read it was meant to protect.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

function revalidateMoney(userId?: string): void {
  revalidatePath('/penalties')
  revalidatePath('/my-earnings')
  revalidatePath('/payouts')
  if (userId) revalidatePath(`/users/${userId}`)
}

export const createPenaltyAction = requirePermission(
  'penalty.create',
  async (actor, raw: unknown): Promise<PenaltyRecomputeResult> => {
    const input = createPenaltySchema.parse(raw)
    const settings = await loadPenaltySettings()
    const clientIp = await ip()

    const outcome = await prisma.$transaction((tx) =>
      createManualPenalty(tx, {
        userId: input.userId,
        amount: input.amount,
        reason: input.reason,
        actor,
        cycleDay: settings.cycleDay,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney(input.userId)
    return outcome
  },
)

export const grantBonusAction = requirePermission(
  'bonus.create',
  async (actor, raw: unknown): Promise<{ entryId: string; amount: string }> => {
    const input = grantBonusSchema.parse(raw)
    const settings = await loadPenaltySettings()
    const clientIp = await ip()

    const outcome = await prisma.$transaction((tx) =>
      grantBonus(tx, {
        userId: input.userId,
        amount: input.amount,
        reason: input.reason,
        actor,
        cycleDay: settings.cycleDay,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney(input.userId)
    return outcome
  },
)

/**
 * SPEC §6 gives reversal exactly two keys, and which one applies depends on the
 * *entry*, which is only known after a read. So the action gates on
 * `penalty.reverse` up front and re-checks against the row's real type — the
 * same two-step `modules/ledger/actions` uses, and for the same reason:
 * `penalty.reverse` getting somebody through the door must not silently also
 * grant them reversal of a bonus.
 */
export const reversePenaltyAction = requirePermission(
  'penalty.reverse',
  async (actor, raw: unknown) => {
    const input = reverseMoneyEntrySchema.parse(raw)
    const entry = await prisma.ledgerEntry.findUnique({
      where: { id: input.entryId },
      select: { id: true, type: true, userId: true },
    })
    if (!entry)
      throw new DomainError('penalties.errors.notPenalty', { id: input.entryId })
    if (entry.type === 'BONUS') assertCan(actor, 'bonus.reverse')

    const settings = await loadPenaltySettings()
    const clientIp = await ip()

    const outcome = await prisma.$transaction((tx) =>
      reversePenaltyOrBonus(tx, {
        entryId: input.entryId,
        reason: input.reason,
        actor,
        cycleDay: settings.cycleDay,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidateMoney(entry.userId)
    return outcome
  },
)

/**
 * The "recalculate now" button (phase brief item 9's register, and the task
 * sheet). Gated on `penalty.create`: it can move somebody's money, even though
 * the number it lands on is the system's rather than the operator's.
 *
 * It contends for the same per-task lock the nightly job takes, so a manual
 * recalculation firing while the scheduler is mid-sweep is told the lock was
 * held and does nothing — the correct outcome rather than an error, because
 * whoever holds it is computing the same answer (docs/TESTING.md §4 axis 6).
 */
export const recomputeTaskPenaltyAction = requirePermission(
  'penalty.create',
  async (actor, raw: unknown): Promise<PenaltyRecomputeResult> => {
    const input = recomputeTaskPenaltySchema.parse(raw)
    const settings = await loadPenaltySettings()
    const clientIp = await ip()

    const outcome = await prisma.$transaction((tx) =>
      recomputeTaskPenalty(tx, {
        taskId: input.taskId,
        calendar: calendarFor(tx),
        settings,
        cycleDay: settings.cycleDay,
        cause: 'manual',
        now: new Date(),
        actor,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidatePath(`/tasks/${input.taskId}`)
    revalidateMoney()
    return outcome
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Penalty profiles (SPEC R2) — agency configuration, so `settings.edit`
// ─────────────────────────────────────────────────────────────────────────────

export const createPenaltyProfileAction = requirePermission(
  'settings.edit',
  async (actor, raw: unknown): Promise<PenaltyProfileDto> => {
    const input = penaltyProfileSchema.parse(raw)
    const clientIp = await ip()

    const profile = await prisma.$transaction((tx) =>
      createPenaltyProfile(tx, {
        input,
        actor,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidatePath('/settings')
    return profile
  },
)

export const updatePenaltyProfileAction = requirePermission(
  'settings.edit',
  async (actor, raw: unknown): Promise<PenaltyProfileDto> => {
    const { id, ...input } = updatePenaltyProfileSchema.parse(raw)
    const clientIp = await ip()

    const profile = await prisma.$transaction((tx) =>
      updatePenaltyProfile(tx, {
        id,
        input,
        actor,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidatePath('/settings')
    return profile
  },
)

export const deletePenaltyProfileAction = requirePermission(
  'settings.edit',
  async (actor, raw: unknown): Promise<void> => {
    const { id } = deletePenaltyProfileSchema.parse(raw)
    const clientIp = await ip()

    await prisma.$transaction((tx) =>
      deletePenaltyProfile(tx, { id, actor, ...(clientIp ? { ip: clientIp } : {}) }),
    )

    revalidatePath('/settings')
    revalidatePath('/users')
  },
)

/**
 * Assigning a formula to a person is an edit to that person, so it is
 * `user.edit` and not `settings.edit`. A team lead who may change who does what
 * should not need the key that changes what the agency's rules *are*.
 */
export const assignPenaltyProfileAction = requirePermission(
  'user.edit',
  async (actor, raw: unknown): Promise<void> => {
    const input = assignPenaltyProfileSchema.parse(raw)
    const clientIp = await ip()

    await prisma.$transaction((tx) =>
      assignPenaltyProfile(tx, {
        userId: input.userId,
        profileId: input.profileId,
        actor,
        ...(clientIp ? { ip: clientIp } : {}),
      }),
    )

    revalidatePath(`/users/${input.userId}`)
    revalidatePath('/users')
  },
)
