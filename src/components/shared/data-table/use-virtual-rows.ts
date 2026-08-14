'use client'

import * as React from 'react'

/**
 * Row windowing for lists past `VIRTUALIZE_THRESHOLD` (SPEC §9: "virtualize any
 * list over 100 rows").
 *
 * Hand-written rather than `@tanstack/react-virtual`, for the reason Phase 0
 * recorded about Radix: the route budget is 180 kB gzip and this table is on
 * every list screen in the product. A fixed-row-height window is about fifty
 * lines, and fixed row height is not an assumption here — it is a design token.
 * Every row is exactly `--density-row-h` tall, so the arithmetic that a general
 * virtualizer has to discover by measurement is something this table already
 * knows.
 *
 * Below the threshold nothing runs: no listeners, no measurement, no spacer
 * rows. A twenty-row table pays nothing for a feature it does not need.
 */

export const VIRTUALIZE_THRESHOLD = 100

/** Rendered beyond the viewport on each side, so a fast scroll finds paint. */
const OVERSCAN = 12

export interface VirtualWindow {
  enabled: boolean
  startIndex: number
  endIndex: number
  /** Height of the spacer row before the window, in pixels. */
  paddingTop: number
  /** Height of the spacer row after the window, in pixels. */
  paddingBottom: number
}

export function useVirtualRows({
  count,
  scrollRef,
  rowRef,
  enabled = true,
}: {
  count: number
  /** The scrolling container. `null` means the window scrolls. */
  scrollRef: React.RefObject<HTMLElement | null>
  /** Any rendered row, measured once to learn the current density's height. */
  rowRef: React.RefObject<HTMLElement | null>
  enabled?: boolean
}): VirtualWindow {
  const active = enabled && count > VIRTUALIZE_THRESHOLD

  // Fallback until the first row is measured. Wrong by a few pixels for one
  // frame is harmless; the effect corrects it before the user can scroll.
  const [rowHeight, setRowHeight] = React.useState(44)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewportHeight, setViewportHeight] = React.useState(0)

  React.useEffect(() => {
    if (!active) return

    const measure = () => {
      const height = rowRef.current?.getBoundingClientRect().height
      if (height && height > 0) setRowHeight(height)

      const container = scrollRef.current
      setViewportHeight(container ? container.clientHeight : window.innerHeight)
      setScrollTop(container ? container.scrollTop : window.scrollY)
    }

    measure()

    const target: HTMLElement | Window = scrollRef.current ?? window
    target.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)

    // The density toggle changes `--density-row-h` without a scroll or a
    // resize, so the row has to be watched directly.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (rowRef.current) observer?.observe(rowRef.current)

    return () => {
      target.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [active, scrollRef, rowRef])

  return React.useMemo<VirtualWindow>(() => {
    if (!active) {
      return {
        enabled: false,
        startIndex: 0,
        endIndex: count,
        paddingTop: 0,
        paddingBottom: 0,
      }
    }

    const visible = Math.ceil((viewportHeight || 600) / rowHeight)
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
    const endIndex = Math.min(count, startIndex + visible + OVERSCAN * 2)

    return {
      enabled: true,
      startIndex,
      endIndex,
      paddingTop: startIndex * rowHeight,
      paddingBottom: Math.max(0, (count - endIndex) * rowHeight),
    }
  }, [active, count, rowHeight, scrollTop, viewportHeight])
}
