import type { Db } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import type { AdjustmentIntent, LedgerPort } from '@/modules/task/ports'

import { recordAdjustment } from './service'

/**
 * modules/ledger/port — the other half of Phase 4's `LedgerPort`.
 *
 * Phase 4 shipped `noopLedgerPort` with a note that said, in effect, *this is
 * where SPEC M4's "pay the previous assignee a partial amount?" will land, and
 * until then every intent is preserved as a `task.partialPaymentIntent` audit
 * row so Phase 7 can replay them*. This is Phase 7. The interface is unchanged,
 * which is what that promise was worth.
 *
 * The intent's `note` becomes the adjustment's reason — it is already real
 * Arabic prose from `i18n/ar`, built by `modules/task` from the same template
 * the reassignment dialog showed the manager, so the منفّذ and the manager read
 * one wording.
 */

export interface LedgerPortArgs {
  /** Settings `payout.cycleDay`. */
  cycleDay: number
}

export function createLedgerPort(args: LedgerPortArgs): LedgerPort {
  return {
    async recordAdjustment(db: Db, intent: AdjustmentIntent): Promise<void> {
      await recordAdjustment(db, {
        userId: intent.userId,
        amount: intent.amount,
        reason: intent.note,
        taskId: intent.taskId,
        actor: { id: intent.createdById },
        cycleDay: args.cycleDay,
        at: intent.at,
      })
    },
  }
}

/** The production port, reading its own setting — an adapter, not a service. */
export const prismaLedgerPort: LedgerPort = {
  async recordAdjustment(db, intent) {
    const cycleDay = await getSetting('payout.cycleDay')
    await createLedgerPort({ cycleDay }).recordAdjustment(db, intent)
  },
}
