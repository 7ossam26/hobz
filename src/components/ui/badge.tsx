import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Chrome stays quiet; colour encodes data (SPEC §9).
 *
 * These variants were written in Phase 1, before the hue system existed, and
 * they kept their hardcoded Tailwind pairs (`bg-emerald-100 … dark:bg-emerald-950`)
 * long after `data-hue` arrived. That made them the one place in the component
 * library holding literal colours — invisible to the contrast suite, and immune
 * to any change to the palette. They now bind to a hue like everything else, so
 * a badge is a chip and gets a chip's guarantees.
 *
 * `accent` is deliberately not a data hue: violet is reserved for actions and
 * identity (SPEC §9), so it reads the accent tokens directly.
 */
const BADGE_HUE = {
  positive: 'emerald',
  warning: 'amber',
  /** Data: the account is switched off. Neutral is the correct "no signal". */
  muted: 'neutral',
} as const

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-muted-foreground border-transparent',
        outline: 'text-foreground',
        /** Data: the account is usable. */
        positive: 'bg-hue-surface text-hue-text border-transparent',
        /** Data: the account is switched off. */
        muted: 'bg-hue-surface text-hue-text border-transparent',
        /** Data: protected/system, and the reason a control is disabled. */
        accent: 'bg-accent-soft text-accent-on-soft border-transparent',
        warning: 'bg-hue-surface text-hue-text border-transparent',
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
  const hue = variant && variant in BADGE_HUE
    ? BADGE_HUE[variant as keyof typeof BADGE_HUE]
    : undefined

  return (
    <span
      data-slot="badge"
      {...(hue ? { 'data-hue': hue } : {})}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
