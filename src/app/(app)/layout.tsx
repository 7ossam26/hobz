import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/layout/app-header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { CommandPaletteProvider } from '@/components/layout/command-palette'
import { ImpersonationBanner } from '@/components/layout/impersonation-banner'
import { ar } from '@/i18n/ar'
import { getSessionState } from '@/lib/auth/session'
import { visibleNavItems } from '@/lib/navigation'

/**
 * The app shell.
 *
 * A Server Component. The navigation it renders is filtered here against
 * permissions re-read from the database — not against the JWT's copy, and not
 * in the browser. The middleware has already redirected an unauthenticated
 * request; the `redirect` below covers the case where the session was
 * invalidated *between* the middleware and this render, which is exactly what
 * happens when an admin deactivates someone mid-session.
 *
 * The same filtered list feeds three things — the sidebar, the breadcrumb and
 * the command palette — so a route a user cannot reach cannot appear in any of
 * them. That is convenience, not security: the enforcement is `assertCan` in
 * the query layer (CLAUDE.md invariant 3).
 *
 * **RTL.** The sidebar is the first child of a flex row, so the browser puts it
 * at the inline start — the right-hand side — with no direction-specific code.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await getSessionState()
  if (!actor) redirect('/login')

  const items = visibleNavItems(actor)

  return (
    <CommandPaletteProvider navItems={items}>
      <a
        href="#main"
        className="bg-accent-solid text-accent-on-solid sr-only z-[80] rounded-md px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:start-2 focus:top-2"
      >
        {ar.a11y.skipToContent}
      </a>

      <div className="flex min-h-dvh flex-col">
        {actor.impersonatorId ? (
          <ImpersonationBanner impersonatedName={actor.fullName} />
        ) : null}

        <div className="flex flex-1">
          <AppSidebar items={items} />

          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader
              user={{
                id: actor.id,
                fullName: actor.fullName,
                username: actor.username,
              }}
            />

            <main id="main" className="density-stack flex flex-1 flex-col p-4 md:p-6">
              {children}
            </main>
          </div>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}
