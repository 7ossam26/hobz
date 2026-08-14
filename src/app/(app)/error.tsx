'use client'

import { useEffect } from 'react'

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
 * production, and reconstructing "you lack payout.approve" client-side would
 * mean shipping the permission map to the browser.
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
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed px-6 py-14">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{ar.errors.unexpected}</p>
        <p className="text-muted-foreground text-sm">{ar.errors.forbidden}</p>
      </div>
      <Button variant="outline" size="sm" onClick={reset}>
        {ar.common.next}
      </Button>
    </div>
  )
}
