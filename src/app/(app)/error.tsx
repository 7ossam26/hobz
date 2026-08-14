'use client'

import { CircleAlert, RotateCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'

/**
 * The error boundary for the app segment.
 *
 * This is where a `ForbiddenError` thrown by the query layer lands when someone
 * reaches a route the middleware let through — a permission revoked since the
 * JWT was minted, or a link followed from a stale page. That the *page* fails
 * here rather than rendering empty is the point: the check that matters runs in
 * the query, and its failure has to be visible.
 *
 * The message is generic on purpose. React strips server error details in
 * production, and reconstructing "you lack `payout.approve`" in the browser
 * would mean shipping the permission map to it.
 *
 * Two ways out, because there are two situations: `reset` re-renders the
 * segment, which fixes a transient failure, and the dashboard link is for when
 * it does not.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app] unhandled error', error)
  }, [error])

  return (
    <EmptyState
      icon={<CircleAlert />}
      title={ar.errors.unexpected}
      description={ar.errors.forbidden}
      action={
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={reset}>
            <RotateCw />
            {ar.common.retry}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">{ar.nav.dashboard}</Link>
          </Button>
        </div>
      }
    />
  )
}
