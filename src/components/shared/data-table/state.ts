import type { SortDirection, TableState } from './types'

/**
 * The table's state lives in the URL, and this module is the only thing that
 * knows how.
 *
 * Why the URL and not React state: the table is **server-driven** (SPEC §9
 * bans client-side data waterfalls). Page, sort, facets and search are inputs
 * to a Prisma query that runs in a Server Component, so they have to survive a
 * request. Putting them in the address bar buys three things for free —
 * a filtered list is linkable, the back button steps through filter changes the
 * way a user expects, and a reload does not silently reset someone's view.
 *
 * Everything here is pure, which is what lets the same functions run in the
 * server page (parsing `searchParams`) and in the client toolbar (producing the
 * next URL) with no chance of the two disagreeing.
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const

/** The largest size the URL may ask for. Bounds a hand-edited `?size=`. */
const MAX_PAGE_SIZE = Math.max(...PAGE_SIZES)

export const DEFAULT_TABLE_STATE: TableState = {
  page: 1,
  pageSize: 25,
  sort: null,
  dir: 'asc',
  filters: {},
  search: '',
  hidden: [],
}

/** Facet params are namespaced so they cannot collide with `page` or `q`. */
export const FACET_PREFIX = 'f_'

const clampInt = (
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number => {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

/** Anything unparseable falls back to the default — a hand-edited URL must not 500. */
export function parseTableState(
  params: URLSearchParams,
  defaults: Partial<TableState> = {},
): TableState {
  const base = { ...DEFAULT_TABLE_STATE, ...defaults }

  const filters: Record<string, string[]> = {}
  for (const [key, value] of params.entries()) {
    if (!key.startsWith(FACET_PREFIX)) continue
    const id = key.slice(FACET_PREFIX.length)
    if (!id) continue
    const values = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (values.length > 0) filters[id] = values
  }

  const sort = params.get('sort')
  const dir = params.get('dir')

  return {
    page: clampInt(params.get('page'), base.page, 1, Number.MAX_SAFE_INTEGER),
    // Bounded by the largest offered size: an unbounded `size=100000` in the
    // address bar is a denial-of-service against our own database.
    pageSize: clampInt(params.get('size'), base.pageSize, 1, MAX_PAGE_SIZE),
    sort: sort && sort.length > 0 ? sort : base.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : base.dir,
    filters: Object.keys(filters).length > 0 ? filters : base.filters,
    search: params.get('q')?.trim() ?? base.search,
    hidden:
      params
        .get('hide')
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean) ?? base.hidden,
  }
}

/**
 * Serialise back to query parameters, omitting anything at its default.
 *
 * Short URLs are not cosmetic here: `/users` and `/users?page=1&size=25&dir=asc`
 * would otherwise be different history entries for the same screen, and the
 * back button would appear to do nothing.
 */
export function toSearchParams(
  state: TableState,
  defaults: Partial<TableState> = {},
): URLSearchParams {
  const base = { ...DEFAULT_TABLE_STATE, ...defaults }
  const params = new URLSearchParams()

  if (state.page !== base.page) params.set('page', String(state.page))
  if (state.pageSize !== base.pageSize) params.set('size', String(state.pageSize))
  if (state.sort && state.sort !== base.sort) {
    params.set('sort', state.sort)
    if (state.dir !== base.dir) params.set('dir', state.dir)
  }
  if (state.search) params.set('q', state.search)
  if (state.hidden.length > 0) params.set('hide', state.hidden.join(','))

  // Sorted so that toggling two facets in either order produces one URL, and
  // the browser treats it as one history entry.
  for (const id of Object.keys(state.filters).sort()) {
    const values = state.filters[id]
    if (values && values.length > 0) {
      params.set(`${FACET_PREFIX}${id}`, [...values].sort().join(','))
    }
  }

  return params
}

/** `?a=1&b=2`, or `''` when every value is at its default. */
export function toQueryString(state: TableState, defaults?: Partial<TableState>): string {
  const params = toSearchParams(state, defaults)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * Every mutation returns a **new** state and resets to page 1, because narrowing
 * a result set while sitting on page 7 is the classic way to land on an empty
 * screen and conclude there is no data.
 */
const resetPage = (state: TableState): TableState => ({ ...state, page: 1 })

export function withSearch(state: TableState, search: string): TableState {
  return resetPage({ ...state, search: search.trim() })
}

/**
 * Three-state sort: ascending → descending → unsorted. The third state matters
 * — once a column is sorted there is otherwise no way back to the query's
 * natural order, which for a task list is usually the most useful one.
 */
export function withSort(state: TableState, columnId: string): TableState {
  if (state.sort !== columnId) return { ...state, sort: columnId, dir: 'asc' }
  if (state.dir === 'asc') return { ...state, dir: 'desc' }
  return { ...state, sort: null, dir: 'asc' }
}

export function withSortDirection(state: TableState, dir: SortDirection): TableState {
  return { ...state, dir }
}

export function withFacetValue(
  state: TableState,
  facetId: string,
  value: string,
  selected: boolean,
): TableState {
  const current = state.filters[facetId] ?? []
  const next = selected
    ? current.includes(value)
      ? current
      : [...current, value]
    : current.filter((entry) => entry !== value)

  const filters = { ...state.filters }
  if (next.length > 0) filters[facetId] = next
  else delete filters[facetId]

  return resetPage({ ...state, filters })
}

export function withoutFacet(state: TableState, facetId: string): TableState {
  const filters = { ...state.filters }
  delete filters[facetId]
  return resetPage({ ...state, filters })
}

/** Clears facets and search, and deliberately keeps sort and column visibility:
 *  those are how the user has chosen to *read* the table, not what they asked
 *  it to show. */
export function withoutFilters(state: TableState): TableState {
  return resetPage({ ...state, filters: {}, search: '' })
}

export function withPage(state: TableState, page: number): TableState {
  return { ...state, page: Math.max(1, page) }
}

export function withPageSize(state: TableState, pageSize: number): TableState {
  return resetPage({ ...state, pageSize })
}

export function withColumnVisibility(
  state: TableState,
  columnId: string,
  visible: boolean,
): TableState {
  const hidden = visible
    ? state.hidden.filter((id) => id !== columnId)
    : state.hidden.includes(columnId)
      ? state.hidden
      : [...state.hidden, columnId]
  return { ...state, hidden }
}

export function activeFilterCount(state: TableState): number {
  const facets = Object.values(state.filters).reduce(
    (total, values) => total + values.length,
    0,
  )
  return facets + (state.search ? 1 : 0)
}

export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

/** `عرض 26–50 من 137`. Clamped so an over-long last page never reads `51–75 من 60`. */
export function pageRange(
  state: TableState,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 }
  const from = (state.page - 1) * state.pageSize + 1
  const to = Math.min(state.page * state.pageSize, total)
  return { from: Math.min(from, total), to }
}
