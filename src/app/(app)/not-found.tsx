import { FileQuestion } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'

/**
 * Reached two ways: an unknown URL, and a `notFound()` thrown by a query for a
 * record that is soft-deleted or outside the actor's scope (CLAUDE.md
 * invariants 3 and 8).
 *
 * Both say the same thing, deliberately. Distinguishing "does not exist" from
 * "exists but is not yours" would confirm the existence of a project to someone
 * who is not on it.
 */
export default function AppNotFound() {
  return (
    <EmptyState
      icon={<FileQuestion />}
      title={ar.errors.notFound}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">{ar.nav.dashboard}</Link>
        </Button>
      }
    />
  )
}
