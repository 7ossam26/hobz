import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { ForbiddenError } from '@/lib/errors'
import { can, type Actor } from '@/lib/rbac'

import { listLedgerSchema, type ListLedgerInput } from './schema'
import { listEntries, summaryFor } from './service'
import type { LedgerPageDto, LedgerSummaryDto } from './types'

/**
 * Read paths with RBAC scoping baked in (CLAUDE.md invariant 3: "Permissions
 * are enforced in the query layer, server-side. Hiding a button is cosmetic.")
 *
 * SPEC §6 gives the ledger two keys and they mean exactly what they say:
 * `ledger.view.all` sees everyone's money, `ledger.view.own` sees your own.
 * Holding neither sees nothing — there is no implicit "well, it's your own
 * data" fallback, because a منفّذ whose role does not include `ledger.view.own`
 * has deliberately not been given the مستحقاتي page.
 */
export function scopeLedger(actor: Actor | null): Record<string, unknown> {
  if (!actor) throw new ForbiddenError('ledger.view.own')
  if (can(actor, 'ledger.view.all')) return {}
  if (can(actor, 'ledger.view.own')) return { userId: actor.id }
  throw new ForbiddenError('ledger.view.own')
}

/**
 * Reject a request for *somebody else's* ledger before it becomes a query.
 *
 * The scope fragment would already have narrowed the results to the caller, so
 * this changes no data — it changes the answer from "a suspiciously empty
 * statement" to "you may not read that", which is the difference between a
 * confusing page and an honest one.
 */
function assertSubject(actor: Actor, requested: string | undefined): string | undefined {
  if (!requested) return requested
  if (can(actor, 'ledger.view.all')) return requested
  if (requested !== actor.id) throw new ForbiddenError('ledger.view.all')
  return requested
}

export async function getLedgerPage(raw: unknown): Promise<LedgerPageDto> {
  const actor = await requireActor()
  const filters: ListLedgerInput = listLedgerSchema.parse(raw ?? {})
  const scope = scopeLedger(actor)

  return listEntries(prisma, {
    ...filters,
    scope,
    userId: assertSubject(actor, filters.userId) ?? (scope.userId as string | undefined),
  })
}

/**
 * The مستحقاتي statement — **always the caller's own**, never the scope's.
 *
 * `getLedgerPage` widens to everyone for a `ledger.view.all` holder, which is
 * right for a finance screen and wrong for this one: a manager who also holds
 * that key would open their own مستحقاتي page and find the whole organization's money
 * on it. The page has no user parameter for the same reason — there is nothing
 * to tamper with.
 */
export async function getMyLedgerPage(raw: unknown): Promise<LedgerPageDto> {
  const actor = await requireActor()
  if (!can(actor, 'ledger.view.own') && !can(actor, 'ledger.view.all')) {
    throw new ForbiddenError('ledger.view.own')
  }
  const filters: ListLedgerInput = listLedgerSchema.parse(raw ?? {})

  return listEntries(prisma, {
    ...filters,
    userId: actor.id,
    scope: { userId: actor.id },
  })
}

/** The header of the مستحقاتي page: balance, this cycle, what is still owed. */
export async function getMyLedgerSummary(): Promise<LedgerSummaryDto> {
  const actor = await requireActor()
  if (!can(actor, 'ledger.view.own') && !can(actor, 'ledger.view.all')) {
    throw new ForbiddenError('ledger.view.own')
  }
  return summaryFor(prisma, { userId: actor.id })
}

export async function getLedgerSummaryFor(userId: string): Promise<LedgerSummaryDto> {
  const actor = await requireActor()
  // `assertSubject` alone would let *any* authenticated user read their own
  // balance, because it returns early when the subject is the caller. That is
  // precisely the implicit "well, it's their own data" fallback `scopeLedger`
  // above refuses to make, and a منفّذ whose role was never given
  // `ledger.view.own` has deliberately not been shown their money.
  scopeLedger(actor)
  assertSubject(actor, userId)
  return summaryFor(prisma, { userId })
}
