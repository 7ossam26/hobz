'use client'

import { Check, Columns3, ListFilter, Plus, Search, Trash2, X } from 'lucide-react'
import * as React from 'react'

import { Dot } from '@/components/data/chip'
import { Popover, PopoverItem, PopoverLabel, PopoverSeparator } from '@/components/shared/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'

import { deleteView, loadViews, saveView } from './saved-views'
import { activeFilterCount, withFacetValue, withoutFilters } from './state'
import type { ColumnDef, FacetDef, SavedView, TableState } from './types'

/**
 * Everything above the table: search, facets, saved views, column visibility.
 *
 * The search box is **debounced and locally controlled**. Every keystroke is a
 * server round trip otherwise, and — worse — a controlled input whose value
 * comes back from the server lags behind the typist and eats characters. So the
 * input owns its text, and the URL catches up 300 ms after the typing stops.
 */

const SEARCH_DEBOUNCE_MS = 300

export function DataTableToolbar<Row>({
  tableId,
  state,
  columns,
  facets,
  searchPlaceholder,
  actions,
  onSearch,
  onChange,
  onToggleColumn,
}: {
  tableId: string
  state: TableState
  columns: ColumnDef<Row>[]
  facets: FacetDef[]
  searchPlaceholder?: string
  actions?: React.ReactNode
  onSearch: (value: string) => void
  onChange: (next: TableState) => void
  onToggleColumn: (columnId: string, visible: boolean) => void
}) {
  const filterCount = activeFilterCount(state)

  return (
    <div className="density-gap flex flex-wrap items-center">
      <SearchBox value={state.search} placeholder={searchPlaceholder} onSearch={onSearch} />

      {facets.map((facet) => (
        <FacetFilter
          key={facet.id}
          facet={facet}
          selected={state.filters[facet.id] ?? []}
          onToggle={(value, selected) =>
            onChange(withFacetValue(state, facet.id, value, selected))
          }
        />
      ))}

      {filterCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(withoutFilters(state))}
        >
          <X />
          {ar.table.clearFilters}
        </Button>
      ) : null}

      <div className="ms-auto flex items-center gap-2">
        <SavedViewsMenu tableId={tableId} state={state} onApply={onChange} />
        <ColumnsMenu columns={columns} hidden={state.hidden} onToggle={onToggleColumn} />
        {actions}
      </div>
    </div>
  )
}

function SearchBox({
  value,
  placeholder,
  onSearch,
}: {
  value: string
  placeholder?: string
  onSearch: (value: string) => void
}) {
  const [text, setText] = React.useState(value)

  // Adopt an externally changed value — clearing all filters, or restoring a
  // saved view — without fighting the user mid-word.
  React.useEffect(() => setText(value), [value])

  // Held in a ref so the debounce depends only on the text. The parent rebuilds
  // `onSearch` on every render, and depending on it would restart the timer
  // each time the table re-renders — including the pending re-render the
  // previous search just caused, which fires the same search twice.
  const latestOnSearch = React.useRef(onSearch)
  React.useEffect(() => {
    latestOnSearch.current = onSearch
  })

  React.useEffect(() => {
    if (text === value) return
    const timer = setTimeout(() => latestOnSearch.current(text), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, value])

  return (
    <div className="relative w-full sm:w-64">
      <Search
        className="text-fg-subtle pointer-events-none absolute start-2.5 top-0 bottom-0 my-auto size-3.5"
        aria-hidden
      />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder ?? ar.common.search}
        aria-label={ar.common.search}
        className="density-control ps-8"
      />
    </div>
  )
}

function FacetFilter({
  facet,
  selected,
  onToggle,
}: {
  facet: FacetDef
  selected: string[]
  onToggle: (value: string, selected: boolean) => void
}) {
  return (
    <Popover
      label={facet.label}
      trigger={({ toggle, ...triggerProps }) => (
        <Button type="button" variant="outline" size="sm" onClick={toggle} {...triggerProps}>
          <ListFilter />
          {facet.label}
          {selected.length > 0 ? (
            <span className="bg-accent-soft text-accent-on-soft rounded px-1.5 text-[0.6875rem] tabular-nums">
              {selected.length}
            </span>
          ) : null}
        </Button>
      )}
    >
      <PopoverLabel>{facet.label}</PopoverLabel>
      {facet.options.map((option) => {
        const checked = selected.includes(option.value)
        return (
          <PopoverItem
            key={option.value}
            role="menuitemcheckbox"
            aria-checked={checked}
            onClick={() => onToggle(option.value, !checked)}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded border',
                checked ? 'bg-accent-solid border-transparent' : 'border-input',
              )}
            >
              {checked ? <Check className="size-3 text-white" /> : null}
            </span>
            {option.hue ? <Dot hue={option.hue} /> : null}
            <span className="flex-1">{option.label}</span>
            {option.count === undefined ? null : (
              <span className="text-fg-subtle text-xs tabular-nums">{option.count}</span>
            )}
          </PopoverItem>
        )
      })}
    </Popover>
  )
}

function ColumnsMenu<Row>({
  columns,
  hidden,
  onToggle,
}: {
  columns: ColumnDef<Row>[]
  hidden: string[]
  onToggle: (columnId: string, visible: boolean) => void
}) {
  const hideable = columns.filter((column) => column.hideable !== false)
  if (hideable.length === 0) return null

  return (
    <Popover
      align="end"
      label={ar.table.columns}
      trigger={({ toggle, ...triggerProps }) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggle}
          title={ar.table.columnsHint}
          {...triggerProps}
        >
          <Columns3 />
          {ar.table.columns}
        </Button>
      )}
    >
      <PopoverLabel>{ar.table.columnsHint}</PopoverLabel>
      {hideable.map((column) => {
        const visible = !hidden.includes(column.id)
        return (
          <PopoverItem
            key={column.id}
            role="menuitemcheckbox"
            aria-checked={visible}
            onClick={() => onToggle(column.id, !visible)}
          >
            <Check className={cn('size-3.5 shrink-0', visible ? 'opacity-100' : 'opacity-0')} />
            {column.srHeader ?? column.header}
          </PopoverItem>
        )
      })}
    </Popover>
  )
}

function SavedViewsMenu({
  tableId,
  state,
  onApply,
}: {
  tableId: string
  state: TableState
  onApply: (next: TableState) => void
}) {
  // `localStorage` does not exist during SSR, so views load after mount. The
  // menu is chrome, not content: rendering the trigger with an empty list for
  // one frame costs nothing, and reading storage during render would break
  // hydration.
  const [views, setViews] = React.useState<SavedView[]>([])
  const [naming, setNaming] = React.useState(false)
  const [name, setName] = React.useState('')

  React.useEffect(() => setViews(loadViews(tableId)), [tableId])

  return (
    <Popover
      align="end"
      label={ar.table.savedViews}
      trigger={({ toggle, ...triggerProps }) => (
        <Button type="button" variant="outline" size="sm" onClick={toggle} {...triggerProps}>
          {ar.table.savedViews}
          {views.length > 0 ? (
            <span className="text-fg-subtle text-[0.6875rem] tabular-nums">{views.length}</span>
          ) : null}
        </Button>
      )}
    >
      {({ close }) => (
        <>
          {views.length === 0 ? (
            <PopoverLabel>{ar.table.saveViewHint}</PopoverLabel>
          ) : (
            views.map((view) => (
              <div key={view.id} className="flex items-center gap-1">
                <PopoverItem
                  className="flex-1"
                  onClick={() => {
                    onApply(view.state)
                    close()
                  }}
                >
                  {view.name}
                </PopoverItem>
                <button
                  type="button"
                  aria-label={ar.table.deleteView}
                  title={ar.table.deleteView}
                  onClick={() => setViews(deleteView(tableId, view.id))}
                  className="text-fg-subtle hover:text-destructive rounded-md p-1.5 transition-colors"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            ))
          )}

          <PopoverSeparator />

          {naming ? (
            <form
              className="flex items-center gap-1 p-1"
              onSubmit={(event) => {
                event.preventDefault()
                setViews(saveView(tableId, name, state))
                setName('')
                setNaming(false)
              }}
            >
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={ar.table.viewName}
                aria-label={ar.table.viewName}
                className="h-8"
              />
              <Button type="submit" size="sm" disabled={!name.trim()}>
                {ar.common.save}
              </Button>
            </form>
          ) : (
            <PopoverItem onClick={() => setNaming(true)}>
              <Plus className="size-3.5" aria-hidden />
              {ar.table.saveView}
            </PopoverItem>
          )}
        </>
      )}
    </Popover>
  )
}
