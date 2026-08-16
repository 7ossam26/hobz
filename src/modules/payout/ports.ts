import type { Db } from '@/lib/db'

/**
 * modules/payout/ports.ts — the notification boundary, in the same shape
 * every other domain module's `ports.ts` uses: this module knows *that* a
 * payout was approved or paid, and delivering an in-app notification is
 * Phase 9's.
 */

/** SPEC §8's "payout approved". */
export interface PayoutApprovedEvent {
  type: 'PayoutApproved'
  payoutId: string
  userId: string
  /** `lib/money` storage string. */
  net: string
  approvedById: string | null
  at: Date
}

/**
 * SPEC §8's "payout paid" — emitted for every recorded payment, partial or
 * final, because both put real money in the منفّذ's hand and both deserve to
 * be heard about, not only the one that zeroes the outstanding balance.
 */
export interface PayoutPaidEvent {
  type: 'PayoutPaid'
  payoutId: string
  userId: string
  /** This payment's amount, not the running total (`lib/money` storage string). */
  amount: string
  fullyPaid: boolean
  paidById: string | null
  at: Date
}

export type PayoutDomainEvent = PayoutApprovedEvent | PayoutPaidEvent

export interface PayoutEventBus {
  emit(db: Db, event: PayoutDomainEvent): Promise<void>
}

export const noopPayoutEvents: PayoutEventBus = {
  emit: async () => {},
}
