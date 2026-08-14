import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A real empty state: what is missing, and **the one action** that fixes it
 * (CLAUDE.md UI rules).
 *
 * No illustration. SPEC §9 bans hero art, and the reason is not taste — a
 * cartoon of an empty box is the same amount of information as blank space,
 * costs a download, and pushes the one useful control below the fold. An icon
 * is allowed, and it is drawn quietly, because its job is to mark the region
 * rather than to fill it.
 *
 * Two variants, and the distinction matters more than it looks:
 *
 *  - `empty` — there is genuinely nothing yet. The action creates the first one.
 *  - `filtered` — there *is* data, the filters excluded it. The action clears
 *    the filters. Offering "create your first user" to someone who has filtered
 *    a list of 200 users down to zero is how a product teaches people not to
 *    trust it.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  variant = 'empty',
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title' | 'children'> & {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ReactNode
  variant?: 'empty' | 'filtered'
}) {
  return (
    <div
      data-slot="empty-state"
      data-variant={variant}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="text-fg-subtle [&_svg]:size-6" aria-hidden>
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-fg-muted max-w-sm text-sm text-balance">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
