'use client'

import { CapacityBar } from '@/components/data/capacity-bar'
import { ar } from '@/i18n/ar'
import type { WorkerWorkloadDto } from '@/modules/workload/queries'

/**
 * The manager dashboard's secondary "workload heatmap" widget.
 *
 * A client component, dynamically imported with `ssr: false` from
 * `manager-dashboard.tsx` — the phase brief's "no chart library in the
 * initial bundle (lazy-load charts below the fold)". There is no third-party
 * chart library here at all (CLAUDE.md's own colour system replaces one), but
 * the code-split boundary itself is what the constraint is checking for: this
 * module's JS ships only when a manager's dashboard actually renders the
 * secondary row, never in the shared app bundle.
 *
 * Data arrives as a prop from the Server Component parent that already
 * fetched it — no client-side request, no waterfall.
 */
export function WorkloadHeatmap({ workers }: { workers: WorkerWorkloadDto[] }) {
  if (workers.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {ar.dashboard.manager.workloadEmpty}
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2.5" role="list">
      {workers.map((worker) => (
        <li key={worker.userId} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm">{worker.fullName}</span>
          <CapacityBar
            utilisationPercent={worker.utilisationPercent}
            className="flex-1"
          />
        </li>
      ))}
    </ul>
  )
}

export default WorkloadHeatmap
