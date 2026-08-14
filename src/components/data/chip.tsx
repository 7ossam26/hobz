import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import type { Hue } from '@/lib/palette'
import { cn } from '@/lib/utils'

/**
 * The primitive every coloured mark in this product is built from.
 *
 * A `Chip` is never told a colour. It is told **which datum** it is showing —
 * `hue="emerald"` — and the stylesheet binds that to `--hue-surface`,
 * `--hue-text`, `--hue-line` and `--hue-solid` (see the hue-binding block in
 * `globals.css`). Two things fall out of that, and both are the point of
 * SPEC §9:
 *
 *  1. You cannot paint anything here without first naming what it means. There
 *     is no `color` prop to reach for when a screen "needs a bit of colour".
 *  2. Eleven hues cost one set of utility classes instead of eleven, so the
 *     data palette adds a few hundred bytes to the CSS rather than a few
 *     kilobytes.
 *
 * Server component: a chip is text and a border. Nothing here is interactive.
 */

const chipVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        /** The default. A tint the text sits on — legible at a glance in a dense list. */
        soft: 'bg-hue-surface text-hue-text border-transparent',
        /** For rows already carrying a tinted background of their own. */
        outline: 'text-hue-text border-hue-line bg-transparent',
        /** Quietest form: colour reduced to a dot, text stays neutral. */
        ghost: 'text-foreground border-transparent bg-transparent',
      },
      size: {
        sm: 'h-5 px-1.5 text-[0.6875rem]',
        md: 'h-6 px-2 text-xs',
      },
    },
    defaultVariants: { tone: 'soft', size: 'md' },
  },
)

export interface ChipProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof chipVariants> {
  hue: Hue
  /** Draw the hue as a leading dot. Implied by `tone="ghost"`. */
  dot?: boolean
}

export function Chip({ hue, tone, size, dot, className, children, ...props }: ChipProps) {
  const showDot = dot ?? tone === 'ghost'

  return (
    <span
      data-slot="chip"
      data-hue={hue}
      className={cn(chipVariants({ tone, size }), className)}
      {...props}
    >
      {showDot ? <Dot hue={hue} inherit /> : null}
      {children}
    </span>
  )
}

/**
 * A hue reduced to its smallest legible form, for column cells and legends
 * where a full chip would out-shout the row.
 *
 * 8px with a 3:1 contrast ratio against the page — the WCAG threshold for a
 * non-text graphic that carries meaning, which is exactly what this is.
 */
export function Dot({
  hue,
  inherit,
  className,
  ...props
}: React.ComponentProps<'span'> & { hue?: Hue; inherit?: boolean }) {
  return (
    <span
      data-slot="dot"
      aria-hidden
      {...(inherit ? {} : { 'data-hue': hue ?? 'neutral' })}
      className={cn('bg-hue-solid size-2 shrink-0 rounded-full', className)}
      {...props}
    />
  )
}

/**
 * A hue as a leading edge marker — the 3px rule down the inline start of a
 * card or row. Used where a chip would repeat a label the row already shows.
 */
export function HueRule({
  hue,
  className,
  ...props
}: React.ComponentProps<'span'> & { hue: Hue }) {
  return (
    <span
      data-slot="hue-rule"
      data-hue={hue}
      aria-hidden
      className={cn('bg-hue-solid w-[3px] shrink-0 self-stretch rounded-full', className)}
      {...props}
    />
  )
}

export { chipVariants }
