import { getSettings } from '@/lib/settings'

import type { PenaltySettings } from './assess'

/**
 * modules/penalty/settings — the one place this module reads Settings.
 *
 * CLAUDE.md invariant 4 keeps business numbers out of service files, so
 * `assess.ts` and `service.ts` take a `PenaltySettings` and never fetch one.
 * This is the adapter that fills it, and it is called from jobs, actions and
 * ports — never from a service. The same split `modules/leave/lookup.ts` and
 * `modules/ledger/earnings.ts` already make.
 *
 * All five keys in one round trip, because a recomputation that read the mode
 * before an operator's save and the value after it would apply a formula that
 * never existed.
 */
export interface LoadedPenaltySettings extends PenaltySettings {
  /** Settings `payout.cycleDay` — the entry's cycle attribution. */
  cycleDay: number
}

export async function loadPenaltySettings(): Promise<LoadedPenaltySettings> {
  const values = await getSettings([
    'penalty.defaultMode',
    'penalty.defaultValue',
    'penalty.defaultGraceHours',
    'penalty.penalizeRevisionLateness',
    'calendar.workingDaysPerMonth',
    'payout.cycleDay',
  ])

  return {
    defaultMode: values['penalty.defaultMode'],
    defaultValue: values['penalty.defaultValue'],
    defaultGraceHours: values['penalty.defaultGraceHours'],
    penalizeRevisionLateness: values['penalty.penalizeRevisionLateness'],
    workingDaysPerMonth: values['calendar.workingDaysPerMonth'],
    cycleDay: values['payout.cycleDay'],
  }
}
