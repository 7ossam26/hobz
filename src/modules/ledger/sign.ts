import { DomainError } from '@/lib/errors'
import {
  fitsColumn,
  isNegative,
  isPositive,
  isZero,
  negate,
  round2,
  toMoney,
  toStorageString,
  type MoneyInput,
} from '@/lib/money'

/**
 * modules/ledger/sign — which direction each kind of movement goes.
 *
 * SPEC §4 says balance is `SUM(amount)`. That sentence only works if the sign
 * lives in the amount itself: if a `PENALTY` could be stored positive, every
 * query that adds money up would have to know which types to subtract, and the
 * first one that forgot would pay somebody their own deduction. So the sign is
 * fixed per type, checked once, on the only path that writes.
 *
 * There is deliberately no `direction` column and no debit/credit pair. A second
 * representation of the sign is a second thing that can disagree with the first.
 */

export const LEDGER_TYPES = [
  'EARNING',
  'SALARY',
  'PENALTY',
  'BONUS',
  'ADVANCE',
  'ADJUSTMENT',
  'PAYOUT',
  'REVERSAL',
] as const

export type LedgerType = (typeof LEDGER_TYPES)[number]

/**
 * `either` is not "unconstrained" — it means the sign is decided by the
 * movement's own content rather than by its name. An `ADJUSTMENT` can pay a
 * previous assignee (SPEC M4) or claw something back; a `REVERSAL` always
 * carries the opposite sign of whatever it reverses.
 */
export type LedgerSign = 'credit' | 'debit' | 'either'

const SIGN: Readonly<Record<LedgerType, LedgerSign>> = {
  EARNING: 'credit',
  SALARY: 'credit',
  BONUS: 'credit',
  PENALTY: 'debit',
  ADVANCE: 'debit',
  PAYOUT: 'debit',
  ADJUSTMENT: 'either',
  REVERSAL: 'either',
}

export function signOf(type: LedgerType): LedgerSign {
  return SIGN[type]
}

export const isCredit = (type: LedgerType): boolean => signOf(type) === 'credit'
export const isDebit = (type: LedgerType): boolean => signOf(type) === 'debit'

export function isLedgerType(value: string): value is LedgerType {
  return Object.prototype.hasOwnProperty.call(SIGN, value)
}

/**
 * Everything that must be true of an amount before it can become permanent.
 *
 * Order matters: range and scale are checked before the sign, so a value with
 * three decimal places is reported as such rather than as "wrong direction".
 */
export function assertSignForType(type: LedgerType, amount: MoneyInput): void {
  const value = toMoney(amount)

  if (!fitsColumn(value)) {
    throw new DomainError('ledger.errors.amountOutOfRange', {
      type,
      amount: value.toString(),
    })
  }

  // Rejected, never rounded. A silent round here would drop half a piastre out
  // of one entry and reappear as a balance nobody can reproduce by hand.
  if (!round2(value).equals(value)) {
    throw new DomainError('ledger.errors.amountScale', {
      type,
      amount: value.toString(),
    })
  }

  if (isZero(value)) {
    throw new DomainError('ledger.errors.amountZero', { type })
  }

  const sign = signOf(type)
  if (sign === 'credit' && isNegative(value)) {
    throw new DomainError('ledger.errors.mustBeCredit', {
      type,
      amount: value.toString(),
    })
  }
  if (sign === 'debit' && isPositive(value)) {
    throw new DomainError('ledger.errors.mustBeDebit', { type, amount: value.toString() })
  }
}

/**
 * Turn the magnitude a human typed into the signed value the ledger stores.
 *
 * The سلفة dialog asks for "٣٠٠٠" and means −3000.00. Doing that conversion
 * here — once, next to the rule — is what stops each caller from remembering to
 * negate, and what makes forgetting a caught error rather than a credit.
 *
 * Refuses the two-way types on purpose: an `ADJUSTMENT` has no magnitude to
 * infer a sign from, so its caller must state the sign.
 */
export function signedAmountFor(type: LedgerType, magnitude: MoneyInput): string {
  const sign = signOf(type)
  if (sign === 'either') {
    throw new DomainError('ledger.errors.signedAmountRequired', { type })
  }

  const value = toMoney(magnitude)
  if (!isPositive(value)) {
    throw new DomainError('ledger.errors.magnitudeMustBePositive', {
      type,
      amount: value.toString(),
    })
  }

  const signed = sign === 'debit' ? negate(value) : value
  assertSignForType(type, signed)
  return toStorageString(signed)
}
