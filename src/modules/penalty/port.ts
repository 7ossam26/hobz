import { calendarFor } from '@/lib/calendar'
import type { Db } from '@/lib/db'
import type { PenaltyPort, PenaltyRecomputeRequest } from '@/modules/lateness/ports'

import { noopMoneyEvents, type MoneyEventBus } from './ports'
import { recomputeTaskPenalty } from './service'
import { loadPenaltySettings, type LoadedPenaltySettings } from './settings'

/**
 * modules/penalty/port — the other end of Phase 6's `PenaltyPort`.
 *
 * Phase 6 shipped `noopPenaltyPort` with a note that said, in effect: *an
 * extension has been approved, this deduction is now wrong, and until Phase 8
 * every such instruction is preserved as an `extension.penaltyRecomputeRequested`
 * audit row so it can be replayed*. This is Phase 8. The interface is
 * unchanged, which is what that promise was worth.
 *
 * The port carries `cause` through to the `REVERSAL`'s own note, so a منفّذ
 * whose deduction disappeared reads "إعادة احتساب خصم مهمة «…»: اعتماد تمديد
 * نقل موعد التسليم" rather than an unexplained credit.
 */

export interface PenaltyPortArgs {
  settings: LoadedPenaltySettings
  events?: MoneyEventBus
}

export function createPenaltyPort(args: PenaltyPortArgs): PenaltyPort {
  return {
    async recompute(db: Db, request: PenaltyRecomputeRequest): Promise<void> {
      await recomputeTaskPenalty(db, {
        taskId: request.taskId,
        // Bound to the caller's client, so a recomputation inside an extension
        // approval's transaction sees that transaction's new due date rather
        // than the one it is replacing.
        calendar: calendarFor(db),
        settings: args.settings,
        cycleDay: args.settings.cycleDay,
        cause: request.cause,
        now: request.at,
        actor: request.requestedById ? { id: request.requestedById } : null,
        events: args.events ?? noopMoneyEvents,
      })
    },
  }
}

/** The production port, reading its own settings — an adapter, not a service. */
export const prismaPenaltyPort: PenaltyPort = {
  async recompute(db, request) {
    const settings = await loadPenaltySettings()
    await createPenaltyPort({ settings }).recompute(db, request)
  },
}
