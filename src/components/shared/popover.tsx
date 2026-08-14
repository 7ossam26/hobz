'use client'

import { Slot } from '@radix-ui/react-slot'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A small anchored popover: the column menu, a facet's option list, the user
 * menu.
 *
 * Not a modal — no focus trap, no scroll lock, no `aria-modal`. A menu that
 * locks the page is heavier than the decision it is asking for. It closes on
 * Escape, on a click outside, and on losing focus to anything beyond it, which
 * are the three ways a person actually leaves a menu.
 *
 * Positioning is CSS, not JavaScript: the panel is absolutely positioned
 * against a `relative` wrapper, anchored to the inline start or end so it
 * mirrors correctly under RTL without measuring anything. A floating-element
 * library would handle collision detection, which none of these menus need —
 * they all sit in the page chrome, well inside the viewport.
 */

export interface PopoverProps {
  /** Receives `open` so the trigger can render its own state. */
  trigger: (props: {
    open: boolean
    toggle: () => void
    'aria-expanded': boolean
    'aria-haspopup': 'menu'
  }) => React.ReactNode
  children: React.ReactNode | ((props: { close: () => void }) => React.ReactNode)
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end'
  className?: string
  label?: string
}

export function Popover({
  trigger,
  children,
  align = 'start',
  className,
  label,
}: PopoverProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const close = React.useCallback(() => setOpen(false), [])
  const toggle = React.useCallback(() => setOpen((value) => !value), [])

  React.useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
      // Return the keyboard to the trigger, not to the top of the document.
      rootRef.current?.querySelector<HTMLElement>('button')?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return (
    <div ref={rootRef} className="relative" data-slot="popover">
      {trigger({ open, toggle, 'aria-expanded': open, 'aria-haspopup': 'menu' })}

      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            'bg-popover shadow-overlay absolute top-[calc(100%+0.25rem)] z-40 min-w-56 rounded-lg border p-1',
            align === 'start' ? 'start-0' : 'end-0',
            className,
          )}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A row inside a popover. `asChild` lets it render as a `<Link>` — a menu entry
 * that navigates must be a real anchor, so that middle-click and "open in new
 * tab" work the way every other link in the app does.
 */
export function PopoverItem({
  className,
  role = 'menuitem',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & {
  role?: 'menuitem' | 'menuitemcheckbox'
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      {...(asChild ? {} : { type: 'button' as const })}
      role={role}
      className={cn(
        'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors',
        'focus-visible:bg-accent focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function PopoverSeparator() {
  return <div role="separator" className="bg-border my-1 h-px" />
}

export function PopoverLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-fg-subtle px-2 py-1.5 text-xs font-medium">{children}</p>
}
