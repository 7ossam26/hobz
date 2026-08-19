'use client'

import * as React from 'react'

/**
 * The behaviours a modal surface owes its user, in one place.
 *
 * Both overlay primitives in this app — the side `Sheet` and the centred
 * `Dialog` — need identical focus, keyboard and scroll semantics and differ
 * only in where they sit on screen. Sharing the mechanics is what stops one of
 * them quietly losing its focus trap during a later phase.
 *
 * What it guarantees while `open`:
 *
 *  - **Tab is trapped** inside the panel. Without it, tabbing walks into the
 *    page behind — which a screen-reader user cannot tell is still there.
 *  - **Focus enters** the first control on open and **returns** to whatever was
 *    focused before on close. A keyboard user who opens a row's sheet and
 *    closes it lands back on that row, not at the top of the document.
 *  - **The page behind cannot scroll**, and the scrollbar's width is padded
 *    back so the layout does not lurch sideways at the moment of opening.
 *    `padding-inline-end` is correct in both directions: the vertical scrollbar
 *    always sits at the inline end.
 *  - **Escape closes**, unless the caller is mid-save.
 *
 * Returns `entered`, which flips one frame after mount so a CSS transition has
 * a starting position to animate away from.
 */

export const MODAL_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The same selectors, scoped to the surface's scrolling body region. */
const BODY_FOCUSABLE = MODAL_FOCUSABLE.split(', ')
  .map((selector) => `[data-modal-body] ${selector}`)
  .join(', ')

export function useModalBehaviour({
  open,
  onClose,
  panelRef,
  closeDisabled = false,
}: {
  open: boolean
  onClose: () => void
  panelRef: React.RefObject<HTMLElement | null>
  /** True while a save is in flight: Escape stops closing the surface. */
  closeDisabled?: boolean
}): { entered: boolean; requestClose: () => void } {
  const returnFocusRef = React.useRef<HTMLElement | null>(null)

  const requestClose = React.useCallback(() => {
    if (!closeDisabled) onClose()
  }, [closeDisabled, onClose])

  // A caller that owns its own draft state (most `EntitySheet` forms) tends to
  // pass an inline `onClose={() => ...}`, which is a new function every
  // keystroke. Reading `requestClose` through a ref — instead of listing it as
  // a dependency below — keeps the focus/scroll-lock effect from re-running on
  // every re-render that merely hands it a fresh closure. Without this, typing
  // in the second field re-fires the effect and yanks focus back to the first.
  const requestCloseRef = React.useRef(requestClose)
  React.useEffect(() => {
    requestCloseRef.current = requestClose
  }, [requestClose])

  React.useEffect(() => {
    if (!open) return

    returnFocusRef.current = document.activeElement as HTMLElement | null

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Stop the event before an outer surface also treats it as "close me".
        event.stopPropagation()
        requestCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE)
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

    const { body } = document
    const previousOverflow = body.style.overflow
    const previousPadding = body.style.paddingInlineEnd
    const scrollbar = window.innerWidth - body.clientWidth
    body.style.overflow = 'hidden'
    if (scrollbar > 0) body.style.paddingInlineEnd = `${scrollbar}px`

    // Focus the first control in the *body*, not the first in the DOM — which
    // is the close button in the header. Landing a keyboard user on "close" is
    // the opposite of the intent: the sheet opened because they want to read or
    // edit what is inside it. `data-autofocus` lets a caller override.
    const panel = panelRef.current
    const initial =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(BODY_FOCUSABLE) ??
      panel?.querySelector<HTMLElement>(MODAL_FOCUSABLE)

    initial?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      body.style.overflow = previousOverflow
      body.style.paddingInlineEnd = previousPadding
      returnFocusRef.current?.focus?.()
    }
  }, [open, panelRef])

  const [entered, setEntered] = React.useState(false)
  React.useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  return { entered, requestClose }
}
