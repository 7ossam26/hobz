import { Skeleton, SkeletonRegion, TableSkeleton } from '@/components/ui/skeleton'

/**
 * The app segment's loading boundary.
 *
 * It stands in for a *page*, not for the shell: the sidebar, the header and the
 * breadcrumb are rendered by the layout and stay on screen during navigation,
 * so a person moving between screens never loses their place.
 *
 * A title bar and a table, because that is the shape of almost every route in
 * this product (SPEC §9: full pages exist only for lists, dashboards, settings
 * and reports). A skeleton that does not match what follows makes the page jump
 * when the real content lands, which is worse than showing nothing.
 */
export default function AppLoading() {
  return (
    <SkeletonRegion className="density-stack flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <TableSkeleton />
    </SkeletonRegion>
  )
}
