import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { ForbiddenError } from '@/lib/errors'
import { can, type Actor } from '@/lib/rbac'

import { listPayoutsSchema, type ListPayoutsInput } from './schema'
import { getPayout, listCycles, listPayouts, listStatements } from './service'
import type { PayoutCycleDto, PayoutDto, PayoutStatementDto } from './types'

/**
 * Two audiences, two keys.
 *
 * `payout.view` is the finance view: every منفّذ's payout, in every cycle. A
 * worker reading their *own* statements holds `ledger.view.own` instead — SPEC
 * §6's B6/J3 decision puts that on the مستحقاتي page and nowhere else, and it
 * would be wrong to make a منفّذ hold `payout.view` (which would show them
 * everyone's) just to read their own.
 */
export function scopePayouts(actor: Actor | null): Record<string, unknown> {
  if (!actor) throw new ForbiddenError('payout.view')
  if (can(actor, 'payout.view')) return {}
  if (can(actor, 'ledger.view.own')) return { userId: actor.id }
  throw new ForbiddenError('payout.view')
}

export async function getPayoutCycles(limit?: number): Promise<PayoutCycleDto[]> {
  const actor = await requireActor()
  if (!can(actor, 'payout.view')) throw new ForbiddenError('payout.view')
  return listCycles(prisma, limit === undefined ? {} : { limit })
}

export async function getPayouts(raw: unknown): Promise<PayoutDto[]> {
  const actor = await requireActor()
  const filters: ListPayoutsInput = listPayoutsSchema.parse(raw ?? {})
  const scope = scopePayouts(actor)

  if (!can(actor, 'payout.view') && filters.userId && filters.userId !== actor.id) {
    throw new ForbiddenError('payout.view')
  }

  return listPayouts(prisma, { ...filters, scope })
}

export async function getPayoutById(id: string): Promise<PayoutDto> {
  const actor = await requireActor()
  const payout = await getPayout(prisma, id)

  // Checked after the read rather than inside it because a single row is
  // fetched by primary key — the same shape `modules/leave/queries.ts` uses.
  const scope = scopePayouts(actor)
  if ('userId' in scope && scope.userId !== payout.userId) {
    throw new ForbiddenError('payout.view')
  }
  return payout
}

/** The cycle history on مستحقاتي — always the caller's own. */
export async function getMyStatements(limit?: number): Promise<PayoutStatementDto[]> {
  const actor = await requireActor()
  if (!can(actor, 'ledger.view.own') && !can(actor, 'ledger.view.all')) {
    throw new ForbiddenError('ledger.view.own')
  }
  return listStatements(prisma, {
    userId: actor.id,
    ...(limit === undefined ? {} : { limit }),
  })
}
