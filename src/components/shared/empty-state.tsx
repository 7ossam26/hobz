import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A real empty state: what is missing, and the one action that fixes it
 * (CLAUDE.md UI rules). No illustration — SPEC §9 bans hero art, and a shrug
 * icon is not information.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center',
        className,
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      ) : null}
      {action}
    </div>
  )
}
