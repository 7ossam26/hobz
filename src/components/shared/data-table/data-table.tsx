'use client'

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import * as React from 'react'

import { EmptyState } from '@/components/shared/empty-state'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'

import { DataTablePagination } from './pagination'
import {
  activeFilterCount,
  toQueryString,
  withColumnVisibility,
  withPage,
  withPageSize,
  withSearch,
  withSort,
  withoutFilters,
} from './state'
import { DataTableToolbar } from './toolbar'
import type { ColumnDef, FacetDef, TableState } from './types'
import { useVirtualRows } from './use-virtual-rows'

/**
 * The list surface for the whole product.
 *
 * **Server-driven.** `rows` and `total` are already the answer to `state` — the
 * page ran the query in a Server Component and passed the result down. This
 * component never fetches, never filters and never sorts; it renders, and it
 * turns an interaction into a new URL. That is what CLAUDE.md means by "never
 * fetch data in a client component waterfall", and it is why pagination is
 * honest about a 4 000-row table instead of quietly loading all of it.
 *
 * The round trip: click → `withSort(state, id)` → `router.replace(url)` →
 * Server Component re-queries → new `rows`. `useTransition` keeps the old rows
 * on screen and dims them while that happens, because replacing a correct table
 * with a skeleton on every sort is how a fast app comes to feel slow
 * (CLAUDE.md: "skeletons on first load only").
 *
 * **RTL.** Every cell is `text-start`; `align: 'end'` puts money and counts on
 * the inline end. Nothing here refers to left or right.
 */

/**
 * The `hidden` list a page should start from, so that `defaultHidden` columns
 * are off until the user turns them on. Pass it as `parseTableState`'s
 * `defaults.hidden` in the Server Component.
 */
export function defaultHiddenColumns<Row>(columns: ColumnDef<Row>[]): string[] {
  return columns.filter((column) => column.defaultHidden).map((column) => column.id)
}

export interface DataTableProps<Row> {
  /** Namespaces this table's saved views. Unique per screen. */
  id: string
  columns: ColumnDef<Row>[]
  rows: Row[]
  /** Row count for the whole filtered set, not this page. */
  total: number
  state: TableState
  rowKey: (row: Row) => string
  facets?: FacetDef[]
  /** Opens the entity's sheet. Rows become buttons when set. */
  onRowClick?: (row: Row) => void
  searchPlaceholder?: string
  /** Shown when the unfiltered set is genuinely empty. */
  empty?: React.ReactNode
  /** Rendered at the inline end of the toolbar — usually the create button. */
  toolbarActions?: React.ReactNode
  className?: string
}

export function DataTable<Row>({
  id,
  columns,
  rows,
  total,
  state,
  rowKey,
  facets = [],
  onRowClick,
  searchPlaceholder,
  empty,
  toolbarActions,
  className,
}: DataTableProps<Row>) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = React.useTransition()

  const apply = React.useCallback(
    (next: TableState) => {
      startTransition(() => {
        // `replace`, not `push`: a sort click is a change of view, not a
        // navigation, and forty of them should not bury the previous page
        // forty entries deep in the back stack.
        router.replace(`${pathname}${toQueryString(next)}`, { scroll: false })
      })
    },
    [pathname, router],
  )

  // `state.hidden` is the whole truth about visibility. `defaultHidden` is
  // seeded into it by the page (see `defaultHiddenColumns`) rather than being a
  // second, competing source — two places deciding whether a column is on
  // screen is exactly how a column becomes impossible to switch back on.
  const visibleColumns = React.useMemo(() => {
    const hidden = new Set(state.hidden)
    return columns.filter((column) => !hidden.has(column.id))
  }, [columns, state.hidden])

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const firstRowRef = React.useRef<HTMLTableRowElement>(null)
  const virtual = useVirtualRows({ count: rows.length, scrollRef, rowRef: firstRowRef })

  const windowedRows = virtual.enabled
    ? rows.slice(virtual.startIndex, virtual.endIndex)
    : rows

  const filtersActive = activeFilterCount(state) > 0
  const columnCount = visibleColumns.length

  return (
    <div className={cn('flex flex-col gap-3', className)} data-slot="data-table">
      <DataTableToolbar
        tableId={id}
        state={state}
        columns={columns}
        facets={facets}
        searchPlaceholder={searchPlaceholder}
        actions={toolbarActions}
        onSearch={(value) => apply(withSearch(state, value))}
        onChange={apply}
        onToggleColumn={(columnId, visible) =>
          apply(withColumnVisibility(state, columnId, visible))
        }
      />

      <div
        ref={scrollRef}
        className={cn(
          'bg-card relative max-h-[70vh] overflow-auto rounded-lg border transition-opacity',
          pending && 'opacity-60',
        )}
        aria-busy={pending}
      >
        <table className="w-full border-collapse text-start">
          {/* Sticky header: on a 100-row page the column a value belongs to
              must still be readable at row 80. */}
          <thead className="bg-surface-sunken sticky top-0 z-10">
            <tr>
              {visibleColumns.map((column) => (
                <HeaderCell
                  key={column.id}
                  column={column}
                  state={state}
                  onSort={() => apply(withSort(state, column.id))}
                />
              ))}
            </tr>
          </thead>

          <tbody>
            {virtual.paddingTop > 0 ? (
              <tr aria-hidden style={{ height: virtual.paddingTop }} />
            ) : null}

            {windowedRows.map((row, index) => {
              const key = rowKey(row)
              const interactive = Boolean(onRowClick)

              return (
                <tr
                  key={key}
                  ref={index === 0 ? firstRowRef : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  // A row that opens a sheet has to be reachable by keyboard.
                  // `<tr>` cannot be a button, so it takes the button's
                  // semantics explicitly rather than being mouse-only.
                  {...(interactive
                    ? {
                        tabIndex: 0,
                        role: 'button',
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          onRowClick?.(row)
                        },
                      }
                    : {})}
                  className={cn(
                    'density-row hover:bg-accent/60 border-b transition-colors last:border-b-0',
                    interactive &&
                      'focus-visible:bg-accent cursor-pointer focus-visible:outline-none',
                  )}
                >
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        'density-cell density-text align-middle',
                        column.align === 'end' ? 'text-end' : 'text-start',
                      )}
                      style={column.width ? { width: column.width } : undefined}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}

            {virtual.paddingBottom > 0 ? (
              <tr aria-hidden style={{ height: virtual.paddingBottom }} />
            ) : null}

            {rows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="p-0">
                  {/* Two different empty states, because they need two
                      different actions (see `EmptyState`). */}
                  {filtersActive ? (
                    <EmptyState
                      variant="filtered"
                      className="rounded-none border-0"
                      title={ar.table.emptyFiltered}
                      action={
                        <button
                          type="button"
                          onClick={() => apply(withoutFilters(state))}
                          className="text-accent-solid text-sm font-medium underline-offset-4 hover:underline"
                        >
                          {ar.table.clearFilters}
                        </button>
                      }
                    />
                  ) : (
                    (empty ?? (
                      <EmptyState
                        className="rounded-none border-0"
                        title={ar.table.empty}
                      />
                    ))
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <DataTablePagination
        state={state}
        total={total}
        onPage={(page) => apply(withPage(state, page))}
        onPageSize={(size) => apply(withPageSize(state, size))}
      />
    </div>
  )
}

function HeaderCell<Row>({
  column,
  state,
  onSort,
}: {
  column: ColumnDef<Row>
  state: TableState
  onSort: () => void
}) {
  const sorted = state.sort === column.id
  const Icon = !sorted ? ChevronsUpDown : state.dir === 'asc' ? ArrowUp : ArrowDown

  const label = column.srHeader ? (
    <span className="sr-only">{column.srHeader}</span>
  ) : (
    column.header
  )

  return (
    <th
      scope="col"
      // Announces the current sort to assistive technology, which the arrow
      // glyph alone does not.
      aria-sort={sorted ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={column.width ? { width: column.width } : undefined}
      className={cn(
        'text-fg-muted h-9 border-b px-3 text-xs font-medium whitespace-nowrap',
        column.align === 'end' ? 'text-end' : 'text-start',
      )}
    >
      {column.sortable ? (
        <button
          type="button"
          onClick={onSort}
          title={
            !sorted
              ? ar.table.sortAscending
              : state.dir === 'asc'
                ? ar.table.sortDescending
                : ar.table.sortClear
          }
          className={cn(
            'hover:text-foreground inline-flex items-center gap-1 transition-colors',
            'focus-visible:ring-ring/50 rounded focus-visible:ring-[3px] focus-visible:outline-none',
            sorted && 'text-foreground',
          )}
        >
          {label}
          <Icon className="size-3 shrink-0 opacity-70" aria-hidden />
        </button>
      ) : (
        label
      )}
    </th>
  )
}
