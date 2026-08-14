import type { Metadata } from 'next'

import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { visibleNavItems } from '@/lib/navigation'

export const metadata: Metadata = { title: ar.nav.dashboard }

/**
 * Phase 1's landing page: proof that the session resolved and that navigation
 * is permission-aware, and nothing more. Phase 10 builds the real manager and
 * worker dashboards — deliberately not sketched here, because a placeholder
 * widget is the fastest way to accidentally set a layout in stone.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>
}) {
  const actor = await requireActor()
  const { denied } = await searchParams
  const items = visibleNavItems(actor)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{ar.nav.dashboard}</h1>
        <p className="text-muted-foreground text-sm">
          {ar.auth.welcome} {actor.fullName}
        </p>
      </header>

      {denied ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {ar.errors.forbidden}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{ar.roles.permissions}</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length <= 1 ? (
            <EmptyState title={ar.common.none} description={ar.errors.forbidden} />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {items.map((item) => (
                <li key={item.href} className="text-muted-foreground">
                  {ar.nav[item.labelKey as keyof typeof ar.nav]}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
