import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Chrome stays quiet; colour encodes data (SPEC §9). The variants here are the
 * *semantic* ones this phase actually needs — active/inactive, system role —
 * not a decorative palette. Phase 2 adds the 10-hue data palette for statuses.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-muted-foreground border-transparent',
        outline: 'text-foreground',
        /** Data: the account is usable. */
        positive:
          'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        /** Data: the account is switched off. */
        muted:
          'border-transparent bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
        /** Data: protected/system, and the reason a control is disabled. */
        accent:
          'border-transparent bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
        warning:
          'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
