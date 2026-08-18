'use client'

import { Download, X } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'

/**
 * Service-worker registration and the "add to home screen" prompt.
 *
 * ── Registration ───────────────────────────────────────────────────────────
 *
 * Deferred to `load`, so the worker's install (which pre-fetches the offline
 * page and two fonts) never competes with the first paint it is supposed to be
 * making faster. Development is skipped entirely: a worker caching `/_next/
 * static` across HMR rebuilds produces stale-chunk failures that look like
 * application bugs.
 *
 * ── The prompt ─────────────────────────────────────────────────────────────
 *
 * Chrome fires `beforeinstallprompt` when it decides the app is installable;
 * the event is captured and the browser's own banner suppressed, because an
 * interruption fired at an arbitrary moment is exactly the pattern SPEC §9's
 * anti-slop rule is about. Instead a quiet bar appears at the bottom, it can be
 * dismissed, and a dismissal is remembered in `localStorage` — losing that on a
 * new browser is an inconvenience, not data loss, which is the same trade
 * `lib/preferences` already makes for theme and density.
 *
 * Nothing renders on iOS/Safari, which has no `beforeinstallprompt`. Writing an
 * "open the share sheet and tap Add to Home Screen" tutorial for a browser that
 * cannot confirm the app is installable is how a bar becomes permanent noise.
 */

const DISMISSED_KEY = 'agency_pwa_prompt_dismissed'

/** The slice of `BeforeInstallPromptEvent` actually used; it is not in lib.dom. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaProvider() {
  const [promptEvent, setPromptEvent] = React.useState<InstallPromptEvent | null>(null)

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // An unregistrable worker costs the offline fallback and nothing else.
        // The app is fully functional without it, so this is not worth a toast.
      })
    }

    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })

    return () => window.removeEventListener('load', register)
  }, [])

  React.useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      try {
        if (window.localStorage.getItem(DISMISSED_KEY) === '1') return
      } catch {
        // Private mode or blocked storage: show the bar rather than crash.
      }
      setPromptEvent(event as InstallPromptEvent)
    }

    const onInstalled = () => setPromptEvent(null)

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!promptEvent) return null

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Nothing to do — the bar simply reappears next session.
    }
    setPromptEvent(null)
  }

  function install() {
    const event = promptEvent
    if (!event) return
    setPromptEvent(null)
    void event.prompt().then(
      () => undefined,
      () => undefined,
    )
  }

  return (
    <div
      role="region"
      aria-label={ar.pwa.installTitle}
      className="bg-card fixed inset-x-3 bottom-3 z-40 flex items-center gap-3 rounded-lg border p-3 shadow-lg sm:inset-x-auto sm:start-3 sm:max-w-sm"
    >
      <span className="text-accent-on-soft bg-accent-soft rounded-md p-2" aria-hidden>
        <Download className="size-4" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-sm font-medium">{ar.pwa.installTitle}</p>
        <p className="text-muted-foreground text-xs">{ar.pwa.installHint}</p>
      </div>

      <Button type="button" size="sm" onClick={install}>
        {ar.pwa.install}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={ar.pwa.later}
        onClick={dismiss}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}
