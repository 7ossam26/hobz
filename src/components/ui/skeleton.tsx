import * as React from 'react'

import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'

/**
 * Skeletons, and the rule attached to them (CLAUDE.md UI rules): **first load
 * only.** A refetch, a filter change, a page step — none of those replace
 * content that is already correct with grey bars. Data that is one second
 * stale is more useful than data that is missing, and a list that dissolves
 * every time a facet is toggled feels broken even when it is fast.
 *
 * They also have to be the right *shape*. A skeleton that does not match the
 * layout it precedes causes the page to jump when the real thing arrives,
 * which is worse than a plain spinner — hence `TableSkeleton` and
 * `SheetSkeleton` rather than a single generic box.
 */

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

/**
 * A single live region wrapping a skeleton block, so a screen reader is told
 * "loading" once instead of hearing nothing at all while forty grey bars
 * render.
 */
export function SkeletonRegion({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div role="status" aria-live="polite" className={className} {...props}>
      <span className="sr-only">{ar.a11y.loading}</span>
      {children}
    </div>
  )
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
}: {
  rows?: number
  columns?: number
}) {
  return (
    <SkeletonRegion className="flex flex-col">
      <div className="bg-surface-sunken flex items-center gap-4 rounded-t-lg border px-3 py-2.5">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      <div className="flex flex-col border-x border-b">
        {Array.from({ length: rows }).map((_, row) => (
          <div
            key={row}
            className="density-row density-cell flex items-center gap-4 border-b last:border-b-0"
          >
            {Array.from({ length: columns }).map((_, column) => (
              <Skeleton
                key={column}
                className={cn('h-3.5 flex-1', column === 0 && 'max-w-40')}
              />
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

export function SheetSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    </SkeletonRegion>
  )
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <SkeletonRegion className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-lg border p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </SkeletonRegion>
  )
}
