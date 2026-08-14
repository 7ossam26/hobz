'use client'

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'

import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'

/**
 * Toasts, and the conventions attached to them.
 *
 * CLAUDE.md: "optimistic updates + toast". The optimistic update is what the
 * user sees; the toast is only the receipt. So:
 *
 *  - **One line, one fact.** `تم حفظ المستخدم` — not a paragraph explaining
 *    what saving means. If it needs a paragraph it is not a toast.
 *  - **Success auto-dismisses, failure does not.** A confirmation nobody reads
 *    is harmless. An error that vanishes after four seconds is a bug report
 *    that never gets filed, so `error` stays until it is dismissed.
 *  - **At most one action**, and it must be the inverse of what just happened
 *    (undo, or "view the thing"). A toast is not a menu.
 *  - **Never for validation.** A field error belongs on the field, where the
 *    correction happens. Toasts are for things that already left the screen.
 *
 * Announced through a live region: `polite` for success and info, `assertive`
 * for errors, because "the deduction was not reversed" must interrupt.
 */

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  action?: ToastAction
  /** Overrides the tone default. `0` pins the toast until dismissed. */
  durationMs?: number
}

interface ToastRecord extends Required<Pick<ToastInput, 'title' | 'tone'>> {
  id: string
  description?: string
  action?: ToastAction
  durationMs: number
}

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 4000,
  info: 6000,
  // Pinned. See the note above: an error that disappears never gets reported.
  error: 0,
}

const TONE_HUE: Record<ToastTone, string> = {
  success: 'emerald',
  error: 'red',
  info: 'sky',
}

const TONE_ICON = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
} as const

interface ToastApi {
  toast: (input: ToastInput) => string
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastApi | null>(null)

/**
 * Wraps the app shell. Safe to mount from a Server Component: only this file is
 * `'use client'`, and `children` arrive already rendered.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([])
  const counter = React.useRef(0)

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const toast = React.useCallback((input: ToastInput) => {
    const tone = input.tone ?? 'success'
    counter.current += 1
    const id = `toast-${counter.current}`

    setToasts((current) => [
      ...current,
      {
        id,
        title: input.title,
        tone,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.action === undefined ? {} : { action: input.action }),
        durationMs: input.durationMs ?? DEFAULT_DURATION[tone],
      },
    ])
    return id
  }, [])

  const api = React.useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error(
      'useToast must be used inside <ToastProvider> (mounted in the app shell).',
    )
  }
  return context
}

function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[]
  onDismiss: (id: string) => void
}) {
  // Portalled to <body> so a toast is never clipped by an `overflow: hidden`
  // ancestor or trapped under a sheet's stacking context.
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <div
      role="region"
      aria-label={ar.toast.region}
      className="pointer-events-none fixed start-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((entry) => (
        <ToastItem key={entry.id} toast={entry} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  )
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord
  onDismiss: (id: string) => void
}) {
  const Icon = TONE_ICON[toast.tone]

  React.useEffect(() => {
    if (toast.durationMs <= 0) return
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs)
    return () => clearTimeout(timer)
  }, [toast.durationMs, toast.id, onDismiss])

  return (
    <div
      data-slot="toast"
      data-hue={TONE_HUE[toast.tone]}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'bg-card shadow-overlay pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3',
      )}
    >
      <Icon className="text-hue-solid mt-0.5 size-4 shrink-0" aria-hidden />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description ? (
          <p className="text-fg-muted text-xs">{toast.description}</p>
        ) : null}
      </div>

      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick()
            onDismiss(toast.id)
          }}
          className="text-accent-solid hover:text-accent-on-soft shrink-0 text-xs font-medium underline-offset-4 hover:underline"
        >
          {toast.action.label}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={ar.toast.dismiss}
        className="text-fg-subtle hover:text-foreground -me-1 shrink-0 rounded-md p-0.5 transition-colors"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
