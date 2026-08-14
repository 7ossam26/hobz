import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The native `<select>`, styled.
 *
 * A listbox built on Radix would cost client JS on a route that has no other
 * reason to be interactive, and the native control is already RTL-correct,
 * keyboard-accessible and touch-friendly. Phase 2 can replace it where a
 * combobox genuinely earns its weight — a filter with two options does not.
 */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { Select }
