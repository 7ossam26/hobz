'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

/**
 * Polling, the way SPEC §2 means it: "Polling every 30s (configurable). No
 * websockets."
 *
 * `router.refresh()` re-runs the Server Component that owns this route and
 * streams the new props down — the exact mechanism `DataTable` already uses
 * for its own sort/filter changes (`router.replace` + a transition), so a
 * poll tick is indistinguishable from any other server-driven update: no
 * parallel client-side fetch, no waterfall (CLAUDE.md: "never fetch data in a
 * client component waterfall"). Local client state that lives *above* the
 * refreshed subtree — which sheet is open, a pending drag, a bulk selection —
 * is untouched, because it is not part of what the server re-renders.
 *
 * Pauses while the tab is hidden (Phase 5 constraint): a background tab
 * polling every 30s buys nothing and only wastes the query.
 */
export function useAutoRefresh(intervalSeconds: number, enabled = true): void {
  const router = useRouter()

  React.useEffect(() => {
    if (!enabled || intervalSeconds <= 0) return

    let timer: ReturnType<typeof setInterval> | null = null

    function start() {
      if (timer) return
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') router.refresh()
      }, intervalSeconds * 1000)
    }

    function stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, intervalSeconds, router])
}
