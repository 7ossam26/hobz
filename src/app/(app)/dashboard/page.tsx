import type { Metadata } from 'next'

import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { visibleNavItems } from '@/lib/navigation'
import { isManagerAudience } from '@/modules/dashboard/queries'
import { getOwnProfile } from '@/modules/user/queries'

import { ManagerDashboard } from './manager-dashboard'
import { WorkerDashboard } from './worker-dashboard'

export const metadata: Metadata = { title: ar.nav.dashboard }

/**
 * Phase 10's real dashboards. `isManagerAudience` is the routing signal SPEC
 * §6 already settled in Phase 1 (`docs/SPEC.md`, "in practice such a manager
 * holds `task.view.all`"): holding either whole-company view permission *is*
 * what this product means by "a manager". Everyone else who is a منفّذ gets
 * the worker dashboard; the rare account that is neither (a client-facing
 * viewer role, say) falls back to the permission list Phase 1 shipped —
 * better than a blank page for an account this dashboard was never designed
 * to serve.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>
}) {
  const actor = await requireActor()
  const { denied } = await searchParams
  const profile = await getOwnProfile()
  const isManager = isManagerAudience(actor)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{ar.nav.dashboard}</h1>
        <p className="text-muted-foreground text-sm">
          {ar.dashboard.welcomeBack} {actor.fullName}
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

      {isManager ? (
        <ManagerDashboard />
      ) : profile.isWorker ? (
        <WorkerDashboard />
      ) : (
        <FallbackNav />
      )}
    </div>
  )
}

async function FallbackNav() {
  const actor = await requireActor()
  const items = visibleNavItems(actor)

  return (
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
  )
}
