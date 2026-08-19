'use client'

import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * The one date field in the product.
 *
 * ── Why it exists ──────────────────────────────────────────────────────────
 *
 * A bare `<input type="date">` was reported as "opens sometimes". Three things
 * were true at once and this component closes all three, because betting on
 * which one a given user hit is how a bug gets fixed twice:
 *
 *  1. **The calendar indicator moves under RTL.** The document is `dir="rtl"`
 *     (`app/layout.tsx`), so Blink's `::-webkit-calendar-picker-indicator`
 *     renders at the inline end — the *left* edge — where nobody looks for it.
 *     Two screens had already worked around this locally with `dir="ltr"`
 *     (`audit-filters.tsx`, `holidays-section.tsx`); six others had not, which
 *     is exactly the kind of drift a shared component exists to prevent.
 *  2. **`min-w-0` let the control shrink below its intrinsic width.** `Input`
 *     sets `flex w-full min-w-0`, and inside a two-column grid in a sheet that
 *     can put the field near 150px, where Blink clips the indicator out of the
 *     box entirely — no click target anywhere.
 *  3. **Nothing ever called `showPicker()`.** So the *only* affordance was that
 *     indicator. Calling it explicitly makes a click anywhere on the field open
 *     the calendar, which is what a user means by "clicking the date field".
 *
 * ── Why `onClick` and deliberately not `onFocus` ───────────────────────────
 *
 * A modal focuses the first control in its body when it opens
 * (`use-modal.ts`). Binding `showPicker()` to focus would therefore pop a
 * calendar nobody asked for every time a sheet whose first field is a date is
 * opened — and again on every programmatic refocus. Click is the user actually
 * asking. There is a test asserting focus does *not* open it.
 *
 * `showPicker` throws `NotAllowedError` without user activation and is absent
 * on older Safari, so the call is optional-chained and guarded: the fallback is
 * exactly today's native behaviour, never worse.
 */
function DateInput({
  className,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  function handleClick(event: React.MouseEvent<HTMLInputElement>) {
    onClick?.(event)
    if (event.defaultPrevented) return

    const element = event.currentTarget
    try {
      element.showPicker?.()
    } catch {
      // Unsupported, or the click did not count as user activation. The native
      // indicator still works; this is an enhancement, not the mechanism.
    }
  }

  return (
    <Input
      {...props}
      type="date"
      // The calendar glyph belongs on the trailing edge where the browser puts
      // it in an LTR document; the value itself (`2026-08-19`) is latin digits
      // and reads left-to-right regardless of the page direction.
      dir="ltr"
      onClick={handleClick}
      className={cn('min-w-[9.5rem] tabular-nums', className)}
    />
  )
}

export { DateInput }
