import { WifiOff } from 'lucide-react'
import type { Metadata } from 'next'

import { ar } from '@/i18n/ar'

export const metadata: Metadata = { title: ar.pwa.offlineTitle }

/**
 * The service worker's navigation fallback (`public/sw.js`).
 *
 * Outside `(app)`, and therefore outside the app shell: the shell is a Server
 * Component that reads the session from the database, which is exactly what is
 * unreachable when this page is being shown. It is also outside `(auth)` for
 * the same reason — no session, no queries, no client JS beyond the retry
 * button. Everything it renders is in the HTML the worker cached at install.
 *
 * The copy is honest rather than reassuring. This product has no offline data
 * sync (phase brief), so promising anything beyond "try again when the network
 * is back" would be a lie told to somebody standing in a lift.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="text-fg-subtle" aria-hidden>
        <WifiOff className="size-8" />
      </span>
      <h1 className="text-lg font-semibold">{ar.pwa.offlineTitle}</h1>
      <p className="text-muted-foreground max-w-sm text-sm">{ar.pwa.offlineHint}</p>
    </main>
  )
}
