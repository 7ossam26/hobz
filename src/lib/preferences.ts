/**
 * lib/preferences — theme, density and sidebar state.
 *
 * ## Why cookies and not the database
 *
 * SPEC §7 is explicit that Settings are **global**, so these three do not
 * belong there. They are also not business data: nothing about a payout
 * changes because someone prefers compact rows.
 *
 * A cookie is what makes them free. The server reads them while rendering the
 * root layout, so `<html>` arrives with the right class already on it — no
 * flash of the wrong theme, no `useEffect`, and no client JS at all on the
 * initial paint. A `User.theme` column would cost a migration, a write on
 * every toggle, and a round trip before the screen could change.
 *
 * The trade is real and worth naming: the preference lives per browser, so
 * signing in on a second machine starts from the default. For a toggle a user
 * flips once, that is the correct side of the trade.
 *
 * This module is pure — it parses and serialises, and never touches
 * `next/headers` or `document`. That is what lets it be unit tested and shared
 * between the server layout and the client toggle.
 */

export const THEME_COOKIE = 'agency_theme'
export const DENSITY_COOKIE = 'agency_density'
export const SIDEBAR_COOKIE = 'agency_sidebar'
/**
 * Phase 5: which of the task views (board/list/calendar) a person last used.
 *
 * Following the same cookie precedent as theme/density/sidebar above, and for
 * the same reason: it is not business data (nothing about a task changes
 * because someone prefers the board), there is no per-user preference table in
 * the schema, and the trade named above — per browser, not per account — is
 * the correct side of it for a view toggle. See docs/DECISIONS.md (Phase 5).
 */
export const TASK_VIEW_COOKIE = 'agency_task_view'

/** One year. A preference the user set is not a session. */
export const PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export const THEMES = ['light', 'dark'] as const
export const DENSITIES = ['comfortable', 'compact'] as const
export const SIDEBAR_STATES = ['expanded', 'collapsed'] as const
export const TASK_VIEWS = ['board', 'list', 'calendar'] as const

export type Theme = (typeof THEMES)[number]
export type Density = (typeof DENSITIES)[number]
export type SidebarState = (typeof SIDEBAR_STATES)[number]
export type TaskView = (typeof TASK_VIEWS)[number]

export interface ShellPreferences {
  theme: Theme
  density: Density
  sidebar: SidebarState
}

/**
 * Light and comfortable, per SPEC §9 ("Light default, full dark mode"). The
 * sidebar starts expanded because a first-time user cannot learn the icons
 * before they have seen the labels.
 */
export const DEFAULT_PREFERENCES: ShellPreferences = {
  theme: 'light',
  density: 'comfortable',
  sidebar: 'expanded',
}

const parseOneOf = <T extends string>(
  allowed: readonly T[],
  fallback: T,
  raw: string | null | undefined,
): T => (allowed.includes(raw as T) ? (raw as T) : fallback)

export const parseTheme = (raw: string | null | undefined): Theme =>
  parseOneOf(THEMES, DEFAULT_PREFERENCES.theme, raw)

export const parseDensity = (raw: string | null | undefined): Density =>
  parseOneOf(DENSITIES, DEFAULT_PREFERENCES.density, raw)

export const parseSidebar = (raw: string | null | undefined): SidebarState =>
  parseOneOf(SIDEBAR_STATES, DEFAULT_PREFERENCES.sidebar, raw)

export const parseTaskView = (raw: string | null | undefined): TaskView =>
  parseOneOf(TASK_VIEWS, 'board', raw)

/**
 * Build the preference set from whatever cookie source the caller has —
 * `next/headers` on the server, `document.cookie` in the browser. An unknown
 * or tampered value falls back to the default rather than throwing: a bad
 * cookie must never be able to take the whole app down.
 */
export function readPreferences(
  getCookie: (name: string) => string | null | undefined,
): ShellPreferences {
  return {
    theme: parseTheme(getCookie(THEME_COOKIE)),
    density: parseDensity(getCookie(DENSITY_COOKIE)),
    sidebar: parseSidebar(getCookie(SIDEBAR_COOKIE)),
  }
}

/**
 * A `document.cookie` assignment string.
 *
 * Not `HttpOnly` — deliberately. The toggle flips the class on `<html>`
 * immediately and writes the cookie so the *next* server render agrees; making
 * it server-only would mean a round trip before the theme changed. Nothing
 * here is a credential, and `SameSite=Lax` keeps it off cross-site requests.
 */
export function preferenceCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; path=/; max-age=${PREFERENCE_MAX_AGE_SECONDS}; samesite=lax`
}

/** Parse a raw `document.cookie` string into a lookup function. */
export function cookieReader(raw: string): (name: string) => string | undefined {
  const jar = new Map<string, string>()
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    const key = pair.slice(0, index).trim()
    if (key) jar.set(key, decodeURIComponent(pair.slice(index + 1).trim()))
  }
  return (name) => jar.get(name)
}

/** The class and attributes `<html>` carries for a given preference set. */
export function htmlPreferenceAttributes(preferences: ShellPreferences): {
  className: string
  'data-density': Density
} {
  return {
    className: preferences.theme === 'dark' ? 'dark' : '',
    'data-density': preferences.density,
  }
}
