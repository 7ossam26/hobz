'use client'

import { X } from 'lucide-react'
import * as React from 'react'

import { useModalBehaviour } from '@/components/shared/use-modal'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'

/**
 * The centred modal, for decisions rather than for editing.
 *
 * The division of labour with `Sheet` is deliberate and worth keeping: a sheet
 * is *beside* the work and leaves the list visible, a dialog is *in front of*
 * it and interrupts. Anything the user should be able to reference while
 * typing belongs in a sheet; anything they must answer before continuing
 * belongs here.
 */

const DIALOG_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
} as const

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: keyof typeof DIALOG_SIZES
  busy?: boolean
  /** Hue rule along the top edge — `red` for destructive confirmations. */
  hue?: 'red' | 'amber' | 'emerald'
  className?: string
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  busy = false,
  hue,
  className,
}: DialogProps) {
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-slot="dialog"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className={cn(
          'absolute inset-0 bg-zinc-950/40 transition-opacity duration-150',
          entered ? 'opacity-100' : 'opacity-0',
        )}
        onClick={requestClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-slot="dialog-panel"
        {...(hue ? { 'data-hue': hue } : {})}
        className={cn(
          'bg-card shadow-overlay relative flex w-full flex-col overflow-hidden rounded-xl border',
          'transition-all duration-150 ease-out',
          entered ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0',
          DIALOG_SIZES[size],
          className,
        )}
      >
        {hue ? (
          <span aria-hidden className="bg-hue-solid block h-[3px] shrink-0" />
        ) : null}

        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-fg-muted text-sm">
                {description}
              </p>
            ) : null}
          </div>
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
        </header>

        {children ? (
          <div data-modal-body className="px-5 py-4">
            {children}
          </div>
        ) : (
          <div className="h-4" />
        )}

        {footer ? (
          <footer className="bg-surface-sunken flex items-center justify-end gap-2 border-t px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
