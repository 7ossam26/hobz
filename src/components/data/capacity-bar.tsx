import * as React from 'react'

import { ar } from '@/i18n/ar'
import { capacityHue } from '@/lib/palette'
import { cn } from '@/lib/utils'

/**
 * The workload/capacity bar (phase brief §"Workload/capacity") — one small
 * component shared by the manager dashboard's heatmap and the task
 * assignment screen's over-capacity warning, so "what does 118% look like"
 * never has two different answers.
 *
 * A plain presentational component (no hooks, no `'use client'`): it renders
 * identically inside the dynamically-imported heatmap island and inside a
 * Server Component assignment dialog, and CLAUDE.md's "colour encodes data"
 * rule is a lookup (`capacityHue`), never a literal here.
 */
export function CapacityBar({
  utilisationPercent,
  className,
}: {
  utilisationPercent: number
  className?: string
}) {
  const hue = capacityHue(utilisationPercent)
  const fillPercent = Math.min(100, Math.max(0, utilisationPercent))

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div
        className="bg-muted h-1.5 min-w-16 flex-1 overflow-hidden rounded-full"
        role="img"
        aria-label={`${ar.workload.utilisation} ${utilisationPercent}%`}
      >
        <div
          data-hue={hue}
          className="bg-hue-solid h-full rounded-full transition-[width]"
          style={{ width: `${fillPercent}%` }}
        />
      </div>
      <span
        data-hue={hue}
        className="text-hue-text numeric-latn shrink-0 text-xs font-medium tabular-nums"
        dir="ltr"
      >
        {utilisationPercent}%
      </span>
    </div>
  )
}
