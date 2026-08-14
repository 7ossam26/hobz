import { redirect } from 'next/navigation'

import { ImpersonationBanner } from '@/components/layout/impersonation-banner'
import { SidebarNav } from '@/components/layout/sidebar-nav'
import { UserMenu } from '@/components/layout/user-menu'
import { ar } from '@/i18n/ar'
import { getSessionState } from '@/lib/auth/session'
import { visibleNavItems } from '@/lib/navigation'

/**
 * The app shell.
 *
 * A Server Component, and the navigation it renders is filtered here against
 * permissions re-read from the database — not against the JWT's copy, and not
 * in the browser. The middleware has already redirected an unauthenticated
 * request; the `redirect` below covers the case where the session was
 * invalidated *between* the middleware and this render, which is exactly what
 * happens when an admin deactivates someone mid-session.
 *
 * Phase 2 replaces this chrome with the real shell (collapsible sidebar,
 * command palette, density toggle). The structure it needs is here: sidebar on
 * the inline start, which under RTL is the right-hand side.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await getSessionState()
  if (!actor) redirect('/login')

  const items = visibleNavItems(actor)

  return (
    <div className="flex min-h-dvh flex-col">
      {actor.impersonatorId ? (
        <ImpersonationBanner impersonatedName={actor.fullName} />
      ) : null}

      <div className="flex flex-1">
        {/* `border-e`, not `border-s`. The sidebar sits at the inline START
            (the right, under RTL), so the divider between it and the content
            beside it is on its inline END. `border-s` would draw a line down
            the outer edge of the screen and leave the two panes touching. */}
        <aside className="bg-card hidden w-60 shrink-0 border-e md:flex md:flex-col">
          <div className="flex h-14 items-center gap-2 border-b px-4">
            <span className="text-sm font-semibold tracking-tight">{ar.app.name}</span>
          </div>
          <SidebarNav items={items} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b px-4 backdrop-blur md:px-6">
            <span className="text-sm font-medium md:hidden">{ar.app.name}</span>
            <div className="flex-1" />
            <UserMenu fullName={actor.fullName} username={actor.username} />
          </header>

          <main className="flex-1 px-4 py-6 md:px-6">{children}</main>
        </div>
      </div>
    </div>
  )
}
