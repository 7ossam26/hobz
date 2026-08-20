import { DEFAULT_TABLE_STATE } from './state'
import type { SavedView, TableState } from './types'

/**
 * Saved views — a named filter/sort/columns combination a user returns to.
 *
 * **Stored in `localStorage`, per browser.** SPEC §7 is explicit that Settings
 * are global, and this is per-person; there is no per-user preference table in
 * the schema and inventing one for a saved filter would be a migration in a
 * design-system phase. The URL already carries the state (see `state.ts`), so a
 * view is only ever a *shortcut* to a URL the user could have bookmarked — which
 * makes losing one an inconvenience rather than a data loss.
 *
 * Every read is defensive. `localStorage` can be unavailable (private mode,
 * disabled storage, SSR), full, or hold something a previous version wrote. A
 * table must render in all four cases, so anything unparseable is discarded
 * silently rather than thrown at the user.
 */

const KEY_PREFIX = 'virallap.views.'

/** Enough to be useful, few enough that the picker stays a list and not a menu. */
export const MAX_SAVED_VIEWS = 12

const storageKey = (tableId: string): string => `${KEY_PREFIX}${tableId}`

function readStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    // Access itself throws when storage is disabled by policy.
    return null
  }
}

/** Narrow unknown JSON to a `TableState`, filling anything missing or wrong. */
function coerceState(raw: unknown): TableState {
  const value = (raw ?? {}) as Partial<TableState>
  const filters: Record<string, string[]> = {}

  if (value.filters && typeof value.filters === 'object') {
    for (const [id, values] of Object.entries(value.filters)) {
      if (Array.isArray(values)) {
        const strings = values.filter(
          (entry): entry is string => typeof entry === 'string',
        )
        if (strings.length > 0) filters[id] = strings
      }
    }
  }

  return {
    page: typeof value.page === 'number' && value.page > 0 ? value.page : 1,
    pageSize:
      typeof value.pageSize === 'number' && value.pageSize > 0
        ? value.pageSize
        : DEFAULT_TABLE_STATE.pageSize,
    sort: typeof value.sort === 'string' ? value.sort : null,
    dir: value.dir === 'desc' ? 'desc' : 'asc',
    filters,
    search: typeof value.search === 'string' ? value.search : '',
    hidden: Array.isArray(value.hidden)
      ? value.hidden.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

export function loadViews(tableId: string): SavedView[] {
  const storage = readStorage()
  if (!storage) return []

  try {
    const raw = storage.getItem(storageKey(tableId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter(
        (entry): entry is { id: unknown; name: unknown; state: unknown } =>
          typeof entry === 'object' && entry !== null,
      )
      .filter((entry) => typeof entry.id === 'string' && typeof entry.name === 'string')
      .map((entry) => ({
        id: entry.id as string,
        name: entry.name as string,
        state: coerceState(entry.state),
      }))
      .slice(0, MAX_SAVED_VIEWS)
  } catch {
    return []
  }
}

function persist(tableId: string, views: SavedView[]): SavedView[] {
  const storage = readStorage()
  if (!storage) return views
  try {
    storage.setItem(storageKey(tableId), JSON.stringify(views))
  } catch {
    // Quota exceeded, or storage went read-only. The in-memory list is still
    // correct for this session; refusing to render because a convenience
    // feature could not be saved would be the wrong trade.
  }
  return views
}

export function saveView(tableId: string, name: string, state: TableState): SavedView[] {
  const trimmed = name.trim()
  if (!trimmed) return loadViews(tableId)

  const existing = loadViews(tableId)
  // Saving under a name that already exists replaces it — the user is updating
  // their view, not accumulating three called "متأخرة".
  const withoutDuplicate = existing.filter((view) => view.name !== trimmed)
  const view: SavedView = {
    id: `${Date.now().toString(36)}-${withoutDuplicate.length}`,
    name: trimmed,
    // Always start a saved view at page 1: the page number is where the user
    // happened to be, never part of what the view means.
    state: { ...state, page: 1 },
  }

  return persist(tableId, [...withoutDuplicate, view].slice(-MAX_SAVED_VIEWS))
}

export function deleteView(tableId: string, viewId: string): SavedView[] {
  return persist(
    tableId,
    loadViews(tableId).filter((view) => view.id !== viewId),
  )
}
