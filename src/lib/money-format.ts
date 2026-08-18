/**
 * lib/money-format — how money is *displayed*, and nothing else.
 *
 * Split out of `lib/money` in Phase 12 for one measured reason: `MoneyText`
 * renders inside client components, so importing `lib/money` put **decimal.js
 * (12.5 KB gzip) into every route's browser bundle** — on a 180 KB budget
 * (SPEC §9), and for code that does no arithmetic. `/tasks` was 1.5 KB over
 * budget; this file is what put it back under.
 *
 * The split is along the right seam, not a convenient one. Arithmetic stays in
 * `lib/money` and stays `Decimal` (CLAUDE.md invariant 2) — nothing here adds,
 * multiplies, or compares two amounts. All this does is turn one already-final
 * amount into the string a human reads, which is presentation.
 *
 * **There is still exactly one formatter.** `lib/money` re-exports `format`
 * from here, so every existing caller and every existing test hits this code
 * path. A second implementation is precisely what would let a ledger row and a
 * payout total disagree about the same number.
 *
 * Rounding is HALF_UP at 2dp, identical to `round2`:
 *  - a `Decimal` rounds through its own `toFixed`, under the HALF_UP mode
 *    `lib/money` sets globally;
 *  - a `number` rounds through `Number.prototype.toFixed`, which the ECMAScript
 *    spec defines as "pick the larger n" on ties — HALF_UP on the double's
 *    exact value, which is what `new Decimal(number)` sees too;
 *  - a decimal `string` rounds through the digit arithmetic below, because
 *    `Number('2.345').toFixed(2)` would answer `'2.34'` (the nearest double is
 *    below the tie) where `Decimal('2.345')` answers `'2.35'`. The string is
 *    the exact value the database handed us, so the string is what we round.
 */

/**
 * Anything with a 2dp rendering. `Decimal` satisfies it structurally, which is
 * how this module stays free of the dependency it exists to keep out of the
 * browser.
 */
export type MoneyDisplayValue =
  string | number | { toFixed(decimalPlaces: number): string }

/** Money columns are `Decimal(12,2)`: 10 integer digits + 2 fractional. */
const SCALE = 2

/**
 * The column's ceiling, as a string and as a plain number.
 *
 * They live here rather than beside `MONEY_MAX` in `lib/money` for the same
 * bundle reason as everything else in this file: a module's `schema.ts` is
 * imported by its form (SPEC §3 — one schema, shared with the server action),
 * and the schemas only ever want the *bound*, not a `Decimal`. Importing
 * `lib/money` for one comparison shipped 13 KB of arithmetic to the browser.
 *
 * `lib/money` builds its `Decimal` `MONEY_MAX` from the string below, so there
 * is still one definition of the ceiling.
 */
export const MONEY_MAX_STRING = '9999999999.99'
export const MONEY_MIN_STRING = '-9999999999.99'
export const MONEY_MAX_NUMBER = Number(MONEY_MAX_STRING)
export const MONEY_MIN_NUMBER = Number(MONEY_MIN_STRING)

/** LRM, RLM, embedding/override marks, ALM, and the isolate controls. */
const BIDI_CONTROL_CHARS = /[\u200e\u200f\u202a-\u202e\u061c\u2066-\u2069]/g
/** NBSP and narrow NBSP, which ICU emits before the currency symbol. */
const NBSP_CHARS = /[\u00a0\u202f]/g

/** Plain decimal notation — the only form a money column or DTO ever holds. */
const PLAIN_DECIMAL = /^([+-]?)(\d+)(?:\.(\d*))?$/

/**
 * Round a plain decimal string to 2dp, HALF_UP, without floating point.
 *
 * Carry propagates through the integer part, so `'9.999'` becomes `'10.00'`
 * rather than `'9.100'` — the failure mode a naive slice-and-increment has.
 */
function roundDecimalString(sign: string, integer: string, fraction: string): string {
  const padded = fraction.padEnd(SCALE + 1, '0')
  const kept = padded.slice(0, SCALE)
  const roundUp = Number(padded[SCALE]) >= 5

  let digits = `${integer}${kept}`
  if (roundUp) {
    // String increment: cheaper to reason about than BigInt parsing, and total
    // for any length of integer part.
    const chars = digits.split('')
    let index = chars.length - 1
    for (; index >= 0; index -= 1) {
      if (chars[index] === '9') {
        chars[index] = '0'
      } else {
        chars[index] = String(Number(chars[index]) + 1)
        break
      }
    }
    digits = index < 0 ? `1${chars.join('')}` : chars.join('')
  }

  const wholeLength = digits.length - SCALE
  const wholePart = digits.slice(0, wholeLength).replace(/^0+(?=\d)/, '')
  return `${sign}${wholePart}.${digits.slice(wholeLength)}`
}

/**
 * The canonical `-1234.50` form. This is the single point where an invalid
 * amount is rejected — a NaN reaching a screen reads as a real balance, and a
 * screen is where somebody argues about their pay.
 */
export function toFixedMoneyString(value: MoneyDisplayValue): string {
  if (typeof value === 'object' && value !== null && 'toFixed' in value) {
    return value.toFixed(SCALE)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Invalid money value: ${value}`)
    return value.toFixed(SCALE)
  }

  const match = PLAIN_DECIMAL.exec(value.trim())
  if (match) {
    const [, rawSign, integer, fraction] = match
    return roundDecimalString(
      rawSign === '-' ? '-' : '',
      integer as string,
      fraction ?? '',
    )
  }

  // Exponent notation and the like. Outside the `Decimal(12,2)` range in every
  // real case, but formatted rather than thrown so a report does not 500.
  const asNumber = Number(value)
  if (!Number.isFinite(asNumber)) throw new RangeError(`Invalid money value: ${value}`)
  return asNumber.toFixed(SCALE)
}

/** -1, 0 or 1, read off the canonical string. No arithmetic, no `Decimal`. */
export function moneySign(value: MoneyDisplayValue): -1 | 0 | 1 {
  const fixed = toFixedMoneyString(value)
  // `-0.00` is zero, and must not render as a debit.
  if (/^-?0\.0*$/.test(fixed)) return 0
  return fixed.startsWith('-') ? -1 : 1
}

export const isDisplayZero = (value: MoneyDisplayValue): boolean => moneySign(value) === 0
export const isDisplayNegative = (value: MoneyDisplayValue): boolean =>
  moneySign(value) === -1

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
export function formatMoney(
  value: MoneyDisplayValue,
  options: FormatOptions = {},
): string {
  const formatter = new Intl.NumberFormat('ar-EG-u-nu-latn', {
    minimumFractionDigits: SCALE,
    maximumFractionDigits: SCALE,
    ...(options.withCurrency
      ? {
          style: 'currency' as const,
          currency: 'EGP',
          currencyDisplay: 'symbol' as const,
        }
      : {}),
    ...(options.signDisplay ? { signDisplay: 'exceptZero' as const } : {}),
  })

  // Already rounded to 2dp, so the double round-trip cannot move a digit: every
  // value inside `Decimal(12,2)` is exactly representable to 2dp well within
  // the 2^53 integer range.
  return formatter
    .format(Number(toFixedMoneyString(value)))
    .replace(BIDI_CONTROL_CHARS, '')
    .replace(NBSP_CHARS, ' ')
    .trim()
}
