'use client'

import { X } from 'lucide-react'
import * as React from 'react'

import { Sheet, type SheetSize } from '@/components/shared/sheet'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import type { Hue } from '@/lib/palette'
import { cn } from '@/lib/utils'

/**
 * `EntitySheet` — the sheet-first primitive.
 *
 * CLAUDE.md is unambiguous: "everything is edited in a sheet or dialog over the
 * current page — click a task → detail sheet; click a user → profile sheet;
 * assign, approve, penalize, pay, all without navigation. Full pages exist only
 * for lists, dashboards, settings, and reports."
 *
 * So this is not a styling wrapper, it is the shape of the interaction model:
 *
 *  - **The list stays behind it.** Approving one task and moving to the next
 *    never costs a page load, and the row you came from is still on screen —
 *    which is the whole reason a reviewer will actually work through a queue.
 *  - **Identity is colour-coded at the top edge.** A 3px rule in the entity's
 *    hue, so that opening four sheets in a row does not feel like opening the
 *    same empty box four times.
 *  - **Tabs, not sub-pages.** A task's comments and activity are tabs inside
 *    the sheet. The moment they become routes, the model has leaked.
 *  - **`dirty` protects unsaved work** by disabling the click-outside exit.
 *    Escape and the close button still work, because an overlay you cannot
 *    leave is worse than one that lets you lose a draft.
 *
 * Data note (CLAUDE.md): the sheet renders what it is given. It never fetches.
 * A caller that needs a detail record loads it in the server component and
 * passes it down, or opens the sheet in a `pending` state around a server
 * action — never a `useEffect` waterfall.
 */

export interface EntitySheetTab {
  id: string
  label: string
  /** Rendered as a badge beside the label — comment counts, attachment counts. */
  count?: number
  content: React.ReactNode
}

export interface EntitySheetProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  /** The entity's identity colour: status hue, project hue, health hue. */
  hue?: Hue
  /** Chips under the title — status, priority, assignee. */
  meta?: React.ReactNode
  /** Controls beside the close button — an overflow menu, a jump-to-next. */
  headerExtra?: React.ReactNode
  tabs?: EntitySheetTab[]
  defaultTabId?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: SheetSize
  /** A save is in flight: the sheet is locked and says so. */
  busy?: boolean
  /** There are unsaved edits: clicking the page behind will not discard them. */
  dirty?: boolean
}

export function EntitySheet({
  open,
  onClose,
  title,
  subtitle,
  hue,
  meta,
  headerExtra,
  tabs,
  defaultTabId,
  children,
  footer,
  size = 'lg',
  busy = false,
  dirty = false,
}: EntitySheetProps) {
  const [activeId, setActiveId] = React.useState(defaultTabId ?? tabs?.[0]?.id)

  // Reopening on a different entity must not keep the previous entity's tab
  // selection when that tab does not exist here.
  const activeTab = tabs?.find((tab) => tab.id === activeId) ?? tabs?.[0]

  const tablistRef = React.useRef<HTMLDivElement>(null)

  function onTabKeyDown(event: React.KeyboardEvent) {
    if (!tabs || tabs.length < 2) return
    const delta = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0
    if (delta === 0) return

    // Under RTL the *visual* left arrow moves to the next tab in reading order,
    // which is why the mapping above looks inverted next to an LTR tab strip.
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === activeTab?.id)
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    if (!next) return
    setActiveId(next.id)
    tablistRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [tabs.indexOf(next)]?.focus()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      busy={busy}
      bare
      closeOnOverlayClick={!dirty}
      footer={footer}
      header={
        <header
          {...(hue ? { 'data-hue': hue } : {})}
          className="relative shrink-0 border-b px-5 pt-4 pb-0"
        >
          {hue ? (
            <span
              aria-hidden
              className="bg-hue-solid absolute start-0 end-0 top-0 block h-[3px]"
            />
          ) : null}

          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
              {subtitle ? (
                <p className="text-fg-muted truncate text-sm">{subtitle}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerExtra}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                onClick={onClose}
                aria-label={ar.common.close}
              >
                <X />
              </Button>
            </div>
          </div>

          {meta ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>
          ) : null}

          {tabs && tabs.length > 0 ? (
            <div
              ref={tablistRef}
              role="tablist"
              onKeyDown={onTabKeyDown}
              className="mt-3 -mb-px flex items-center gap-1 overflow-x-auto"
            >
              {tabs.map((tab) => {
                const selected = tab.id === activeTab?.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-selected={selected}
                    aria-controls={`tabpanel-${tab.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveId(tab.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
                      'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                      selected
                        ? 'border-accent-solid text-foreground font-medium'
                        : 'text-fg-muted hover:text-foreground border-transparent',
                    )}
                  >
                    {tab.label}
                    {tab.count === undefined ? null : (
                      <span className="bg-muted text-fg-muted rounded-full px-1.5 text-[0.6875rem] tabular-nums">
                        {tab.count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : null}
        </header>
      }
    >
      {/* An indeterminate bar rather than a spinner over the content: the
          reader keeps their place while a save is in flight. */}
      {busy ? (
        <div
          role="progressbar"
          aria-busy="true"
          className="bg-accent-soft h-0.5 shrink-0 overflow-hidden"
        >
          <span className="bg-accent-solid block h-full w-1/3 animate-pulse" />
        </div>
      ) : null}

      <div data-modal-body className="flex-1 overflow-y-auto px-5 py-4">
        {activeTab ? (
          <div
            role="tabpanel"
            id={`tabpanel-${activeTab.id}`}
            aria-labelledby={`tab-${activeTab.id}`}
          >
            {activeTab.content}
          </div>
        ) : (
          children
        )}
      </div>
    </Sheet>
  )
}

/**
 * The footer convention, so that "the confirming action is the violet one on
 * the inline end" does not have to be re-decided per screen.
 */
export function EntitySheetFooter({
  primary,
  secondary,
  destructive,
}: {
  primary?: React.ReactNode
  secondary?: React.ReactNode
  /** Sits alone at the inline start, away from the confirming action. */
  destructive?: React.ReactNode
}) {
  return (
    <div className="flex w-full items-center gap-2">
      {destructive}
      <div className="ms-auto flex items-center gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  )
}
