import { Flag } from 'lucide-react'
import * as React from 'react'

import { ar } from '@/i18n/ar'
import { priorityHue, type Priority } from '@/lib/palette'
import { cn } from '@/lib/utils'

/**
 * Priority, as a flag.
 *
 * A different *shape* from `StatusChip` on purpose. Status and priority are the
 * two things scanned in the same glance down a task list, and if both are
 * rounded tinted rectangles the eye has to read them to tell them apart. A
 * filled flag and a tinted chip separate at a distance.
 *
 * LOW is drawn as an outline rather than a fill: on a list where most tasks are
 * LOW, filling it would colour everything, and colouring everything is the same
 * as colouring nothing.
 */
export function PriorityFlag({
  priority,
  label,
  showLabel = true,
  className,
  ...props
}: React.ComponentProps<'span'> & {
  priority: string
  label?: string
  /** Icon only. The accessible name is still rendered, visually hidden. */
  showLabel?: boolean
}) {
  const hue = priorityHue(priority)
  const text = label ?? ar.enums.priority[priority as Priority] ?? priority
  const isLow = hue === 'neutral'

  return (
    <span
      data-slot="priority-flag"
      data-hue={hue}
      className={cn(
        'text-hue-text inline-flex w-fit shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      {...props}
    >
      <Flag
        className={cn('size-3.5 shrink-0', isLow ? 'fill-none' : 'fill-hue-solid stroke-hue-solid')}
        aria-hidden
      />
      <span className={showLabel ? undefined : 'sr-only'}>{text}</span>
    </span>
  )
}
