import * as React from 'react'

import { Dot } from '@/components/data/chip'
import { hueForIndexed, hueForKey } from '@/lib/palette'
import { cn } from '@/lib/utils'

/**
 * Marks for things whose colour comes from *identity* rather than from state:
 * a project, a task category, a client.
 *
 * The hue is derived from the key, so it is stable forever without a colour
 * column in the database and without an admin ever choosing one. Two people
 * looking at the same project see the same colour; the same project seen next
 * year is still that colour.
 *
 * Categories index into the palette in their configured order instead of
 * hashing: they are a short, ordered, admin-curated list (SPEC §7), and
 * adjacent entries in Settings looking adjacent on screen is worth more than
 * an even spread. Past the tenth category it falls back to the hash.
 */

export function CategoryDot({
  category,
  index = -1,
  showLabel = true,
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  category: string
  /** Position in the Settings list, when the caller knows it. */
  index?: number
  showLabel?: boolean
}) {
  return (
    <span
      data-slot="category"
      className={cn('inline-flex w-fit items-center gap-1.5 text-xs whitespace-nowrap', className)}
      {...props}
    >
      <Dot hue={hueForIndexed(index, category)} />
      <span className={showLabel ? undefined : 'sr-only'}>{category}</span>
    </span>
  )
}

/**
 * A project, as it appears inside a task row: a coloured square with the
 * project code, then the name. The square is what makes a list of forty tasks
 * across six projects scannable — the eye groups by colour long before it
 * reads a code.
 */
export function ProjectMark({
  project,
  showName = true,
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  project: { id: string; code: string; name?: string }
  showName?: boolean
}) {
  return (
    <span
      data-slot="project"
      data-hue={hueForKey(project.id)}
      className={cn('inline-flex min-w-0 items-center gap-2 text-sm', className)}
      {...props}
    >
      <span
        aria-hidden
        className="bg-hue-surface text-hue-text inline-flex h-5 shrink-0 items-center rounded-[0.25rem] px-1.5 text-[0.6875rem] font-semibold"
        dir="ltr"
      >
        {project.code}
      </span>
      {showName && project.name ? <span className="truncate">{project.name}</span> : null}
    </span>
  )
}
