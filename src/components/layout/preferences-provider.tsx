'use client'

import * as React from 'react'

import {
  DENSITY_COOKIE,
  SIDEBAR_COOKIE,
  THEME_COOKIE,
  preferenceCookie,
  type Density,
  type ShellPreferences,
  type SidebarState,
  type Theme,
} from '@/lib/preferences'

/**
 * The live copy of the shell preferences.
 *
 * Seeded from the server, which read the cookies while rendering `<html>` — so
 * the first paint is already the right theme and the right density. There is no
 * `useEffect` that corrects the page after the fact, and therefore no flash of
 * the wrong theme, which is the entire reason this is a provider seeded from
 * props rather than a hook that reads `document`.
 *
 * A toggle does three things, in this order:
 *   1. sets the attribute on `<html>` — the change is visible in the same frame;
 *   2. writes the cookie — the *next* server render agrees;
 *   3. updates React state — so any control showing the current value follows.
 *
 * No server action, no revalidation, no round trip. Changing a theme is not a
 * mutation of business data and should not cost a request.
 */

interface PreferencesApi extends ShellPreferences {
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setDensity: (density: Density) => void
  toggleDensity: () => void
  setSidebar: (state: SidebarState) => void
  toggleSidebar: () => void
}

const PreferencesContext = React.createContext<PreferencesApi | null>(null)

export function PreferencesProvider({
  initial,
  children,
}: {
  initial: ShellPreferences
  children: React.ReactNode
}) {
  const [preferences, setPreferences] = React.useState<ShellPreferences>(initial)

  const write = React.useCallback((name: string, value: string) => {
    document.cookie = preferenceCookie(name, value)
  }, [])

  const setTheme = React.useCallback(
    (theme: Theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark')
      write(THEME_COOKIE, theme)
      setPreferences((current) => ({ ...current, theme }))
    },
    [write],
  )

  const setDensity = React.useCallback(
    (density: Density) => {
      document.documentElement.dataset.density = density
      write(DENSITY_COOKIE, density)
      setPreferences((current) => ({ ...current, density }))
    },
    [write],
  )

  const setSidebar = React.useCallback(
    (sidebar: SidebarState) => {
      write(SIDEBAR_COOKIE, sidebar)
      setPreferences((current) => ({ ...current, sidebar }))
    },
    [write],
  )

  const api = React.useMemo<PreferencesApi>(
    () => ({
      ...preferences,
      setTheme,
      toggleTheme: () => setTheme(preferences.theme === 'dark' ? 'light' : 'dark'),
      setDensity,
      toggleDensity: () =>
        setDensity(preferences.density === 'compact' ? 'comfortable' : 'compact'),
      setSidebar,
      toggleSidebar: () =>
        setSidebar(preferences.sidebar === 'collapsed' ? 'expanded' : 'collapsed'),
    }),
    [preferences, setTheme, setDensity, setSidebar],
  )

  return <PreferencesContext.Provider value={api}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesApi {
  const context = React.useContext(PreferencesContext)
  if (!context) {
    throw new Error(
      'usePreferences must be used inside <PreferencesProvider> (mounted in the root layout).',
    )
  }
  return context
}
