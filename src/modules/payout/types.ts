import type { LedgerPersonDto } from '@/modules/ledger/types'

/** Money crosses out of the module as canonical 2dp strings, never numbers. */

export type PayoutCycleStatus = 'OPEN' | 'CLOSED' | 'PAID'
export type PayoutStatus = 'DRAFT' | 'APPROVED' | 'PAID'

export interface PayoutDto {
  id: string
  userId: string
  cycleId: string
  user: LedgerPersonDto | null

  /** Signed: negative when the منفّذ owed the agency at the cycle's start. */
  carriedForward: string
  gross: string
  penalties: string
  bonuses: string
  advances: string
  /** Signed. */
  adjustments: string
  net: string
  paidAmount: string
  /** `net − paidAmount`. Derived on read; there is no column for it. */
  outstanding: string

  status: PayoutStatus
  method: string | null
  reference: string | null
  note: string | null

  approvedById: string | null
  approvedAt: Date | null
  paidById: string | null
  paidAt: Date | null
  createdAt: Date
}

export interface PayoutCycleDto {
  id: string
  periodStart: Date
  periodEnd: Date
  status: PayoutCycleStatus
  closedAt: Date | null
  closedById: string | null
  payoutCount: number
  totalNet: string
  totalPaid: string
}

export interface CloseCycleResult {
  closed: boolean
  cycleId: string | null
  /** The cycle opened to receive everything that happens next. */
  nextCycleId: string | null
  payoutsCreated: number
  salaryEntries: number
  /**
   * `already-closed` — somebody got there first (or the job ran twice).
   * `not-started` — the open cycle covers no elapsed time yet, which is what a
   *   second close in the same instant would otherwise settle.
   * `not-due` — the cycle has not reached its `periodEnd` and the caller did
   *   not ask for an early close.
   */
  skipped: 'already-closed' | 'not-started' | 'not-due' | null
}

/** One line of the worker-facing "مستحقاتي" cycle history. */
export interface PayoutStatementDto {
  payout: PayoutDto
  cycle: Pick<PayoutCycleDto, 'id' | 'periodStart' | 'periodEnd' | 'status' | 'closedAt'>
}
