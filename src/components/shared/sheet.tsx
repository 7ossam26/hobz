'use client'

import { X } from 'lucide-react'
import * as React from 'react'

import { useModalBehaviour } from '@/components/shared/use-modal'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'

/**
 * `Sheet` — the overlay mechanics. `EntitySheet` (same folder) is the thing
 * feature code actually uses; this is the layer underneath it, kept separate
 * so that a dialog, a filter panel and an entity editor share one focus trap
 * rather than three.
 *
 * CLAUDE.md's interaction model: "entities open in a side sheet or dialog over
 * the current page. Users should almost never navigate away to edit
 * something." Everything below exists to make that safe rather than merely
 * possible.
 *
 * Hand-written rather than Radix Dialog for the reason Phase 0 recorded:
 * the `radix-ui` umbrella measured ~77 kB of client JS, which alone consumed
 * the SPEC §9 route budget. The behaviours that actually matter — focus trap,
 * focus restore, scroll lock, Escape, `aria-modal`, inert background — are
 * about eighty lines, and they are all here.
 *
 * It slides from the inline **end**, which under RTL is the left edge, because
 * the sidebar occupies the inline start. `end-0` is what makes that mirror
 * correctly instead of being nailed to one side of the screen.
 */

const SHEET_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-3xl',
} as const

export type SheetSize = keyof typeof SHEET_SIZES

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  size?: SheetSize
  /**
   * Rendered between the title block and the close button — chips, a status,
   * an overflow menu.
   */
  headerExtra?: React.ReactNode
  /**
   * Replaces the whole default header.
   *
   * The function form receives `titleId`, and a custom header **must** put it
   * on the element carrying the title. The panel is `aria-labelledby={titleId}`;
   * a header that does not stamp the id leaves every sheet in the product with
   * no accessible name at all — which is invisible on screen, invisible in
   * review, and immediately visible to a screen reader. Found in Phase 12 by a
   * Playwright locator that could not name the project sheet.
   */
  header?: React.ReactNode | ((ids: { titleId: string }) => React.ReactNode)
  /**
   * A form with unsaved edits passes `false` so a stray click on the page
   * behind cannot discard typing. Escape and the close button still work: an
   * overlay that swallows every exit is a trap, not a safeguard.
   */
  closeOnOverlayClick?: boolean
  /** Blocks Escape and the close button — for an in-flight save. */
  busy?: boolean
  /**
   * Skip the default padded scroll region and render `children` straight into
   * the panel. `EntitySheet` uses this because it owns its own tab strip and
   * scroll container.
   */
  bare?: boolean
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
  header,
  headerExtra,
  closeOnOverlayClick = true,
  busy = false,
  bare = false,
}: SheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const descriptionId = React.useId()

  const { entered, requestClose } = useModalBehaviour({
    open,
    onClose,
    panelRef,
    closeDisabled: busy,
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" data-slot="sheet">
      {/* Decorative for assistive technology: it duplicates the close
          button's job, and announcing two controls called "إغلاق" is noise.
          Escape and the header button are the real exits. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        data-slot="sheet-overlay"
        className={cn(
          'absolute inset-0 bg-scrim transition-opacity duration-200',
          entered ? 'opacity-100' : 'opacity-0',
        )}
        onClick={closeOnOverlayClick ? requestClose : undefined}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-slot="sheet-panel"
        className={cn(
          'bg-surface-overlay shadow-overlay absolute end-0 top-0 bottom-0 flex h-full w-full flex-col border-s',
          'transition-transform duration-200 ease-out',
          entered ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full',
          SHEET_SIZES[size],
          className,
        )}
      >
        {(typeof header === 'function' ? header({ titleId }) : header) ?? (
          <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2
                id={titleId}
                className="truncate text-base font-semibold tracking-tight"
              >
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="text-fg-muted text-sm">
                  {description}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {headerExtra}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                onClick={requestClose}
                aria-label={ar.common.close}
              >
                <X />
              </Button>
            </div>
          </header>
        )}

        {bare ? (
          children
        ) : (
          <div data-modal-body className="flex-1 overflow-y-auto px-5 py-4">
            {children}
          </div>
        )}

        {footer ? (
          <footer className="bg-surface-sunken flex items-center justify-end gap-2 border-t px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
