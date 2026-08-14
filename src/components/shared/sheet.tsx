'use client'

import { X } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'

/**
 * The sheet-first primitive (CLAUDE.md UI rules: "entities open in a side sheet
 * over the current page. Users should almost never navigate away to edit
 * something").
 *
 * Hand-written rather than Radix Dialog, for the same reason the button avoids
 * the umbrella package: Phase 0 measured `radix-ui` at ~77 kB of client JS,
 * which alone consumed the SPEC §9 route budget. Phase 2 owns the real
 * `EntitySheet`; this is the working subset that phase can grow into.
 *
 * It slides from the inline **end** — the left edge under RTL — because the
 * sidebar occupies the start edge. `end-0` is what makes that mirror correctly
 * rather than being hardcoded to one side.
 */

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: SheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return

      // Minimal focus trap. Without it, tabbing walks out of the sheet and into
      // the page behind it, which a screen-reader user cannot see is still there.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Move focus in, so the keyboard lands where the eye already is.
    panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label={ar.common.close}
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'bg-background absolute inset-block-0 end-0 flex h-full w-full max-w-md flex-col border-s shadow-lg',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="text-muted-foreground text-sm">{description}</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={ar.common.close}
          >
            <X />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
