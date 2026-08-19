import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Hand-written rather than pulled from the registry: the shadcn input is a
 * plain element with classes, and vendoring it would add nothing but a file to
 * keep in sync. Logical properties only — `px-3` is direction-agnostic, `pl-3`
 * would land on the wrong side under RTL.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input bg-surface-field placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs transition-colors outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
