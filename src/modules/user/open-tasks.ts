import type { Db } from '@/lib/db'

import type { OpenTaskRef } from './types'

/**
 * The open-task lookup, as a port.
 *
 * Phase 1 must block deactivation while a user still owns work (the phase brief
 * is explicit about the Arabic error listing the tasks), but `Task` is a Phase 4
 * table. So the *rule* ships now — guarded, audited, and unit-tested against a
 * lookup that returns real tasks — and only the query behind it is deferred.
 * This is the same "define the interface now and no-op it behind a clean port"
 * shape the Phase 4 brief prescribes for the ledger.
 *
 * When Phase 4 lands, `noOpenTasks` is replaced by one query and every existing
 * test keeps its meaning. What must NOT happen is the guard being written later
 * along with the table — that is how a rule ends up existing only in the brief.
 */
export type OpenTaskLookup = (db: Db, userId: string) => Promise<OpenTaskRef[]>

/**
 * Phase 1's implementation: there are no tasks, so nobody has open ones.
 *
 * Deliberately *not* a `NotImplementedError`. Every other Phase 0 stub throws
 * because a silent wrong answer there is a wrong payout; here the honest answer
 * for a database with no `tasks` table genuinely is "none", and throwing would
 * make deactivation impossible for the entire phase.
 */
export const noOpenTasks: OpenTaskLookup = async () => []

/**
 * Statuses that count as "still owns this" when Phase 4 wires the real query:
 * everything except the terminal ones (DONE, CANCELLED) and the unassigned
 * BACKLOG. Recorded here so the decision is reviewed with the rule, not
 * reinvented later.
 */
export const OPEN_TASK_STATUSES = [
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'REVISION_REQUESTED',
  'APPROVED',
  'BLOCKED',
] as const
