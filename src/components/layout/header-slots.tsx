'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'

import { HEADER_SLOT_IDS } from './header-slot-ids'

/**
 * How a page puts its own controls into the layout's sticky header.
 *
 * The App Router gives a layout no way to read its child page's props, and the
 * header has to be layout-owned so it survives `loading.tsx` and `error.tsx`.
 * A portal is the seam: the header renders two empty anchors, and a page
 * renders `<PageActions>` wherever it likes in its own tree.
 *
 * The cost is honest and small — the button paints one frame after hydration
 * rather than in the server HTML. Every route in this app is behind auth and
 * therefore already dynamic, and the alternative (a parallel route per page, or
 * a second sticky bar owned by each page) buys that frame at a much higher
 * price in structure.
 */

function HeaderSlot({ id, children }: { id: string; children: React.ReactNode }) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    setTarget(document.getElementById(id))
  }, [id])

  return target ? createPortal(children, target) : null
}

/** The page's primary action — one button, at the inline end of the header. */
export function PageActions({ children }: { children: React.ReactNode }) {
  return <HeaderSlot id={HEADER_SLOT_IDS.actions}>{children}</HeaderSlot>
}

/**
 * A trailing breadcrumb the route cannot know: an entity's name on a detail
 * page. Appends to the crumbs the header already derived from the path.
 */
export function PageBreadcrumb({ children }: { children: React.ReactNode }) {
  return <HeaderSlot id={HEADER_SLOT_IDS.breadcrumb}>{children}</HeaderSlot>
}
