import type * as React from 'react'

import type { Hue } from '@/lib/palette'

/**
 * DataTable types.
 *
 * Kept in their own module because two very different consumers need them: the
 * client table that renders, and the **server** page that parses the request
 * into a query. Sharing the shape is what makes the table server-driven rather
 * than a client-side filter pretending to be one.
 */

export type SortDirection = 'asc' | 'desc'

export interface ColumnDef<Row> {
  /** Stable key. Appears in the URL as the sort target, so it must not drift. */
  id: string
  header: string
  cell: (row: Row) => React.ReactNode
  /** Sorting is executed by the server; this only draws the control. */
  sortable?: boolean
  /** Default true. A column the user must always see (the name) sets false. */
  hideable?: boolean
  /** Off by default, on from the column menu. */
  defaultHidden?: boolean
  /** `end` right-aligns in LTR and left-aligns in RTL — money and counts. */
  align?: 'start' | 'end'
  /** Any CSS width. Unset columns share what is left. */
  width?: string
  /** Accessible header for an icon-only column. */
  srHeader?: string
}

export interface FacetOption {
  value: string
  label: string
  /** Renders the option's dot in the datum's own colour, matching the cell. */
  hue?: Hue
  /** Server-computed. Omitted rather than guessed client-side. */
  count?: number
}

export interface FacetDef {
  /** Appears in the URL as `f_<id>`. */
  id: string
  label: string
  options: FacetOption[]
}

export interface TableState {
  page: number
  pageSize: number
  /** A `ColumnDef.id`, or null for the query's natural order. */
  sort: string | null
  dir: SortDirection
  /** Facet id → selected values. Empty arrays are dropped. */
  filters: Record<string, string[]>
  search: string
  /** Column ids the user has hidden. */
  hidden: string[]
}

/** A named `TableState`, stored per browser (see `saved-views.ts`). */
export interface SavedView {
  id: string
  name: string
  state: TableState
}
