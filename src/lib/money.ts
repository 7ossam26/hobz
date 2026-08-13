import { Decimal } from 'decimal.js'

/**
 * lib/money — the ONLY place money arithmetic is allowed to happen.
 *
 * CLAUDE.md invariant 2: money is `Decimal`, never `number`. Every helper here
 * takes and returns `Money`. `number` appears in exactly two places, both
 * deliberate: as an *input* convenience on `toMoney()` (callers pass literals
 * like `100`) and as the percentage argument on `pct()`.
 *
 * Rounding policy: HALF_UP at 2 decimal places, matching Postgres
 * `Decimal(12,2)` and matching how a human accountant rounds. Banker's rounding
 * would be defensible statistically and indefensible in a conversation with a
 * worker about their deduction — and this product exists to make that
 * conversation arithmetic (CLAUDE.md).
 */

Decimal.set({
  // Well above Decimal(12,2); intermediate products (task value × pct × days)
  // must not lose precision before the single explicit round2() at the end.
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -12,
  toExpPos: 21,
})

export type Money = Decimal
export type MoneyInput = Money | string | number

/** Money columns are `Decimal(12,2)`: 10 integer digits + 2 fractional. */
export const MONEY_SCALE = 2
export const MONEY_MAX = new Decimal('9999999999.99')
export const MONEY_MIN = new Decimal('-9999999999.99')

/** LRM, RLM, embedding/override marks, ALM, and the isolate controls. */
const BIDI_CONTROL_CHARS = /[\u200e\u200f\u202a-\u202e\u061c\u2066-\u2069]/g
/** NBSP and narrow NBSP, which ICU emits before the currency symbol. */
const NBSP_CHARS = /[\u00a0\u202f]/g

/**
 * Coerce to `Money`. Rejects NaN/Infinity loudly rather than letting a poisoned
 * value reach the ledger, where it would be permanent.
 */
export function toMoney(value: MoneyInput): Money {
  if (value instanceof Decimal) {
    if (!value.isFinite())
      throw new RangeError(`Invalid money value: ${value.toString()}`)
    return value
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError(`Invalid money value: ${value}`)
  }
  const d = new Decimal(value)
  if (!d.isFinite()) throw new RangeError(`Invalid money value: ${String(value)}`)
  return d
}

export const zero = (): Money => new Decimal(0)

export function add(a: MoneyInput, b: MoneyInput): Money {
  return toMoney(a).plus(toMoney(b))
}

export function sub(a: MoneyInput, b: MoneyInput): Money {
  return toMoney(a).minus(toMoney(b))
}

export function mul(a: MoneyInput, b: MoneyInput): Money {
  return toMoney(a).times(toMoney(b))
}

export function div(a: MoneyInput, b: MoneyInput): Money {
  const divisor = toMoney(b)
  if (divisor.isZero()) throw new RangeError('Division by zero in money arithmetic')
  return toMoney(a).dividedBy(divisor)
}

/**
 * `percent` is expressed the way the Settings UI shows it: `pct(1000, 5)` is
 * 5% of 1000 = 50. Unrounded on purpose — the caller decides where the single
 * rounding step goes (see the module note on precision).
 */
export function pct(amount: MoneyInput, percent: MoneyInput): Money {
  return toMoney(amount).times(toMoney(percent)).dividedBy(100)
}

/** Round to 2dp, HALF_UP. The last operation before anything is persisted. */
export function round2(value: MoneyInput): Money {
  return toMoney(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP)
}

/** Balances are always `SUM(amount)` (CLAUDE.md invariant 1). */
export function sum(values: readonly MoneyInput[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(toMoney(v)), new Decimal(0))
}

export function negate(value: MoneyInput): Money {
  return toMoney(value).negated()
}

export function abs(value: MoneyInput): Money {
  return toMoney(value).abs()
}

/** Returns -1, 0 or 1. Never compare Money with `<` / `===`. */
export function compare(a: MoneyInput, b: MoneyInput): -1 | 0 | 1 {
  return toMoney(a).comparedTo(toMoney(b)) as -1 | 0 | 1
}

export const eq = (a: MoneyInput, b: MoneyInput): boolean => compare(a, b) === 0
export const gt = (a: MoneyInput, b: MoneyInput): boolean => compare(a, b) === 1
export const gte = (a: MoneyInput, b: MoneyInput): boolean => compare(a, b) >= 0
export const lt = (a: MoneyInput, b: MoneyInput): boolean => compare(a, b) === -1
export const lte = (a: MoneyInput, b: MoneyInput): boolean => compare(a, b) <= 0

export const isZero = (v: MoneyInput): boolean => toMoney(v).isZero()
export const isNegative = (v: MoneyInput): boolean =>
  toMoney(v).isNegative() && !toMoney(v).isZero()
export const isPositive = (v: MoneyInput): boolean => toMoney(v).greaterThan(0)

export function max(a: MoneyInput, b: MoneyInput): Money {
  return gte(a, b) ? toMoney(a) : toMoney(b)
}

export function min(a: MoneyInput, b: MoneyInput): Money {
  return lte(a, b) ? toMoney(a) : toMoney(b)
}

/**
 * A payout can reach zero but never go negative (SPEC §5.4). The surplus is the
 * caller's problem — it carries forward as a debit balance, which the ledger
 * expresses naturally because balance is a sum.
 */
export function clampAtZero(value: MoneyInput): Money {
  const v = toMoney(value)
  return v.isNegative() ? new Decimal(0) : v
}

/** True when the value fits `Decimal(12,2)` without the database truncating it. */
export function fitsColumn(value: MoneyInput): boolean {
  const v = round2(value)
  return v.lessThanOrEqualTo(MONEY_MAX) && v.greaterThanOrEqualTo(MONEY_MIN)
}

/** Canonical persistence form: always exactly 2 decimal places. */
export function toStorageString(value: MoneyInput): string {
  return round2(value).toFixed(MONEY_SCALE)
}

export interface FormatOptions {
  /** Append the EGP symbol (ج.م.). Default: false. */
  withCurrency?: boolean
  /** Render a leading `+` for positive values — used for ledger credits. */
  signDisplay?: boolean
}

/**
 * Display formatting: `Intl.NumberFormat('ar-EG')` with Western digits
 * (`-u-nu-latn`) and a fixed 2dp, per CLAUDE.md.
 *
 * Unicode bidi control marks that ICU injects are stripped. Two reasons:
 * their exact placement varies between ICU versions, which would make this
 * function's output untestable; and direction is handled properly at the
 * rendering layer instead — `MoneyText` wraps the value in `dir="ltr"` with
 * `tabular-nums`, which is more robust than embedded marks.
 */
export function format(value: MoneyInput, options: FormatOptions = {}): string {
  const rounded = round2(value)
  const formatter = new Intl.NumberFormat('ar-EG-u-nu-latn', {
    minimumFractionDigits: MONEY_SCALE,
    maximumFractionDigits: MONEY_SCALE,
    ...(options.withCurrency
      ? {
          style: 'currency' as const,
          currency: 'EGP',
          currencyDisplay: 'symbol' as const,
        }
      : {}),
    ...(options.signDisplay ? { signDisplay: 'exceptZero' as const } : {}),
  })

  return formatter
    .format(rounded.toNumber())
    .replace(BIDI_CONTROL_CHARS, '')
    .replace(NBSP_CHARS, ' ')
    .trim()
}

export { Decimal }
