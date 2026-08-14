import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Native checkbox with an accent colour. The role editor renders one per
 * permission — roughly forty on screen at once — so the cost of a JS-backed
 * control here would be paid forty times for no behaviour the native element
 * does not already have.
 */
function Checkbox({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'border-input accent-primary size-4 shrink-0 cursor-pointer rounded-sm border',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Checkbox }
