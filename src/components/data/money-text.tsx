import * as React from 'react'

import { format, isNegative, isZero, type MoneyInput } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The only way money is rendered.
 *
 * Four rules, all from CLAUDE.md invariant 2 and SPEC §2, and all of them
 * invisible until they are broken:
 *
 *  - **`tabular-nums`.** Column-aligned digits. Without it a ledger's decimal
 *    points wander and a reader cannot compare two rows by eye.
 *  - **Western digits, `ar-EG` grouping.** `1,250.00`, never `١٬٢٥٠٫٠٠`.
 *  - **`dir="ltr"` on an isolated run.** A number inside RTL text is a
 *    bidirectional minefield: without isolation, `-1,250.00` renders as
 *    `1,250.00-` and a deduction reads as a credit. This is the single highest
 *    consequence rendering bug available in this product.
 *  - **The value arrives as a string or `Decimal`, never a `number`.** The
 *    prop type permits `number` only because `lib/money` does, for literals in
 *    tests and stories.
 *
 * `tone="ledger"` colours the sign — and that is a datum, not decoration: in a
 * list of ledger entries the direction of the money *is* the fact being read.
 * Plain amounts (a salary, a task value) get no colour at all.
 */
export function MoneyText({
  value,
  withCurrency = false,
  signed = false,
  tone = 'plain',
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  value: MoneyInput
  /** Append ج.م. Use once per group, not on every row. */
  withCurrency?: boolean
  /** Render a leading `+` for credits. Implied by `tone="ledger"`. */
  signed?: boolean
  /** `ledger` tints by sign; `plain` never colours. */
  tone?: 'plain' | 'ledger'
}) {
  const showSign = signed || tone === 'ledger'
  const text = format(value, { withCurrency, signDisplay: showSign })

  const hue =
    tone === 'ledger' && !isZero(value) ? (isNegative(value) ? 'red' : 'emerald') : undefined

  return (
    <span
      data-slot="money"
      dir="ltr"
      {...(hue ? { 'data-hue': hue } : {})}
      className={cn(
        'numeric-latn inline-block font-medium',
        hue ? 'text-hue-text' : undefined,
        className,
      )}
      {...props}
    >
      {text}
    </span>
  )
}
