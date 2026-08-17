'use client'

import dynamic from 'next/dynamic'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * The code-split boundary the phase brief asks for: `next/dynamic`'s
 * `ssr: false` is only legal inside a Client Component, so this one-line
 * wrapper is what lets the Server Component dashboard render a lazily-loaded
 * island without becoming a Client Component itself.
 */
export const LazyWorkloadHeatmap = dynamic(
  () => import('./workload-heatmap').then((mod) => mod.WorkloadHeatmap),
  { ssr: false, loading: () => <Skeleton className="h-32 w-full" /> },
)
