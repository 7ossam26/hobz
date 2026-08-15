'use client'

import {
  Building2,
  FolderKanban,
  ListTodo,
  Loader2,
  Moon,
  PanelRight,
  Plus,
  Rows2,
  Rows3,
  ScrollText,
  Search,
  Settings,
  Shield,
  Sun,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { usePreferences } from '@/components/layout/preferences-provider'
import { useModalBehaviour } from '@/components/shared/use-modal'
import { ar } from '@/i18n/ar'
import type { NavItem } from '@/lib/navigation'
import { rankMatches } from '@/lib/search'
import { cn } from '@/lib/utils'
import { loadCommandDirectoryAction } from '@/modules/search/actions'
import type { CommandDirectory } from '@/modules/search/types'

/**
 * The `Ctrl+K` palette (SPEC §9).
 *
 * ## Arabic search is the point
 *
 * Every candidate is matched through `lib/search`, so typing `احمد` finds
 * **أحمد**, `فاطمه` finds **فاطمة**, and `يحيي` finds **يحيى**. Without that
 * fold table a palette in Arabic is worse than no palette: a manager types a
 * name they can see on the screen behind, gets nothing, and never opens it
 * again. Results are ranked rather than merely filtered — an exact prefix beats
 * a mid-word hit — so the thing you meant is under the cursor when you press
 * Enter.
 *
 * ## Data
 *
 * Navigation comes from the already permission-filtered list the server passed
 * to the shell. Entities are fetched **once**, on first open, through a server
 * action that runs its own permission checks (`modules/search/queries.ts`).
 * There is no request per keystroke and no permission decision in the browser.
 *
 * ## Keyboard
 *
 * `Ctrl/⌘+K` toggles, arrows move, `Enter` runs, `Escape` closes. The arrows
 * are vertical, so RTL never enters into it — the only direction-sensitive part
 * is the layout, and that is CSS.
 */

interface CommandPaletteApi {
  open: boolean
  setOpen: (open: boolean) => void
}

const CommandPaletteContext = React.createContext<CommandPaletteApi | null>(null)

export function useCommandPalette(): CommandPaletteApi {
  const context = React.useContext(CommandPaletteContext)
  if (!context) {
    throw new Error('useCommandPalette must be used inside <CommandPaletteProvider>.')
  }
  return context
}

/**
 * Owns the open state and the global shortcut, and renders the dialog at the
 * root of the shell. The trigger in the header talks to it through context
 * rather than through a synthetic keyboard event.
 */
export function CommandPaletteProvider({
  navItems,
  children,
}: {
  navItems: NavItem[]
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      setOpen((value) => !value)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const api = React.useMemo<CommandPaletteApi>(() => ({ open, setOpen }), [open])

  return (
    <CommandPaletteContext.Provider value={api}>
      {children}
      <CommandPaletteDialog
        navItems={navItems}
        open={open}
        onClose={() => setOpen(false)}
      />
    </CommandPaletteContext.Provider>
  )
}

interface CommandItem {
  id: string
  group: string
  label: string
  sublabel?: string
  keywords?: string[]
  icon: LucideIcon
  run: () => void
}

const NAV_ICONS: Record<string, LucideIcon> = {
  'layout-dashboard': PanelRight,
  'folder-kanban': FolderKanban,
  'list-todo': ListTodo,
  'building-2': Building2,
  users: Users,
  shield: Shield,
  settings: Settings,
  'scroll-text': ScrollText,
}

function CommandPaletteDialog({
  navItems,
  open,
  onClose,
}: {
  navItems: NavItem[]
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const preferences = usePreferences()

  const [query, setQuery] = React.useState('')
  const [cursor, setCursor] = React.useState(0)
  const [directory, setDirectory] = React.useState<CommandDirectory | null>(null)
  const [loading, setLoading] = React.useState(false)

  const panelRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const { entered } = useModalBehaviour({ open, onClose, panelRef })

  // Fetched once. A palette that re-queries every time it opens is a palette
  // people wait for.
  React.useEffect(() => {
    if (!open || directory || loading) return
    setLoading(true)
    loadCommandDirectoryAction()
      .then(setDirectory)
      .catch(() => setDirectory({ users: [], roles: [] }))
      .finally(() => setLoading(false))
  }, [open, directory, loading])

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  const items = React.useMemo<CommandItem[]>(() => {
    const navigation: CommandItem[] = navItems.map((item) => ({
      id: `nav:${item.href}`,
      group: ar.command.groups.navigation,
      label: ar.nav[item.labelKey as keyof typeof ar.nav],
      icon: NAV_ICONS[item.icon] ?? PanelRight,
      run: () => router.push(item.href),
    }))

    // Quick-create task (Phase 5). Gated on the same nav visibility as the
    // /tasks route itself (task.view.*) — the page re-checks `task.create`
    // before honouring the deep link, so an actor who can see tasks but not
    // create them lands on the board with the dialog silently withheld
    // rather than a client-only permission decision here.
    const quickActions: CommandItem[] = navItems.some((item) => item.href === '/tasks')
      ? [
          {
            id: 'action:new-task',
            group: ar.command.groups.actions,
            label: ar.tasks.create,
            icon: Plus,
            run: () => router.push('/tasks?new=1'),
          },
        ]
      : []

    const appearance: CommandItem[] = [
      {
        id: 'action:theme',
        group: ar.command.groups.appearance,
        label: `${ar.common.theme}: ${
          preferences.theme === 'dark' ? ar.common.themeLight : ar.common.themeDark
        }`,
        icon: preferences.theme === 'dark' ? Sun : Moon,
        run: preferences.toggleTheme,
      },
      {
        id: 'action:density',
        group: ar.command.groups.appearance,
        label: `${ar.common.density}: ${
          preferences.density === 'compact'
            ? ar.common.densityComfortable
            : ar.common.densityCompact
        }`,
        icon: preferences.density === 'compact' ? Rows2 : Rows3,
        run: preferences.toggleDensity,
      },
      {
        id: 'action:sidebar',
        group: ar.command.groups.appearance,
        label: `${ar.shell.navigation}: ${
          preferences.sidebar === 'collapsed' ? ar.common.expand : ar.common.collapse
        }`,
        icon: PanelRight,
        run: preferences.toggleSidebar,
      },
    ]

    const entities: CommandItem[] = [
      ...(directory?.users ?? []).map((entity) => ({
        id: `user:${entity.id}`,
        group: ar.command.groups.users,
        label: entity.label,
        ...(entity.sublabel === undefined ? {} : { sublabel: entity.sublabel }),
        ...(entity.keywords === undefined ? {} : { keywords: entity.keywords }),
        icon: User,
        run: () => router.push(entity.href),
      })),
      ...(directory?.roles ?? []).map((entity) => ({
        id: `role:${entity.id}`,
        group: ar.command.groups.roles,
        label: entity.label,
        ...(entity.sublabel === undefined ? {} : { sublabel: entity.sublabel }),
        icon: Shield,
        run: () => router.push(entity.href),
      })),
    ]

    return [...navigation, ...quickActions, ...appearance, ...entities]
  }, [navItems, router, preferences, directory])

  const results = React.useMemo(
    () =>
      rankMatches(items, query, {
        fields: (item) => [item.label, item.sublabel, ...(item.keywords ?? [])],
        limit: 40,
      }),
    [items, query],
  )

  // Ranking reorders on every keystroke, so the cursor comes home — otherwise
  // it points at whatever happens to occupy that slot now.
  React.useEffect(() => setCursor(0), [query])

  const activeId = results[cursor]?.id

  React.useEffect(() => {
    if (!activeId) return
    listRef.current
      ?.querySelector(`[data-command-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const runItem = (item: CommandItem) => {
    onClose()
    item.run()
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => (results.length === 0 ? 0 : (value + 1) % results.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) =>
        results.length === 0 ? 0 : (value - 1 + results.length) % results.length,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = results[cursor]
      if (item) runItem(item)
    }
  }

  if (!open) return null

  // Groups are rebuilt from the ranked order, so the best match's group comes
  // first. A fixed group order would bury the answer under "التنقل".
  const grouped: Array<{ group: string; items: CommandItem[] }> = []
  for (const item of results) {
    const last = grouped[grouped.length - 1]
    if (last?.group === item.group) last.items.push(item)
    else grouped.push({ group: item.group, items: [item] })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-zinc-950/50 transition-opacity duration-150',
          entered ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ar.command.title}
        className={cn(
          'bg-popover shadow-overlay relative flex w-full max-w-xl flex-col overflow-hidden rounded-xl border',
          'transition-all duration-150 ease-out',
          entered ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0',
        )}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-fg-subtle size-4 shrink-0" aria-hidden />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={activeId ? `command-${activeId}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={ar.command.placeholder}
            aria-label={ar.command.placeholder}
            className="placeholder:text-fg-subtle h-12 w-full bg-transparent text-sm outline-none"
          />
          {loading ? (
            <Loader2
              className="text-fg-subtle size-4 shrink-0 animate-spin"
              aria-hidden
            />
          ) : null}
        </div>

        <div
          ref={listRef}
          id="command-results"
          role="listbox"
          aria-label={ar.command.title}
          className="max-h-80 overflow-y-auto p-1"
        >
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
              <p className="text-sm font-medium">{ar.command.empty}</p>
              <p className="text-fg-muted text-xs">{ar.command.emptyHint}</p>
            </div>
          ) : (
            grouped.map((section, sectionIndex) => (
              <div key={`${section.group}-${sectionIndex}`}>
                <p className="text-fg-subtle px-2 py-1.5 text-xs font-medium">
                  {section.group}
                </p>
                {section.items.map((item) => {
                  const index = results.indexOf(item)
                  const active = index === cursor
                  const Icon = item.icon

                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      id={`command-${item.id}`}
                      data-command-id={item.id}
                      aria-selected={active}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => runItem(item)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-start text-sm transition-colors',
                        active ? 'bg-accent-soft text-accent-on-soft' : 'hover:bg-accent',
                      )}
                    >
                      <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.sublabel ? (
                        <span className="text-fg-subtle truncate text-xs" dir="ltr">
                          {item.sublabel}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="text-fg-subtle bg-surface-sunken flex items-center gap-3 border-t px-3 py-2 text-[0.6875rem]">
          <KeyHint keys="↑↓" label={ar.command.hints.navigate} />
          <KeyHint keys="Enter" label={ar.command.hints.select} />
          <KeyHint keys="Esc" label={ar.command.hints.close} />
        </div>
      </div>
    </div>
  )
}

function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="bg-card rounded border px-1 py-0.5 font-sans text-[0.625rem]">
        {keys}
      </kbd>
      {label}
    </span>
  )
}

/** The header button that says the palette exists — discoverability for `Ctrl+K`. */
export function CommandPaletteTrigger() {
  const { setOpen } = useCommandPalette()

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={ar.shell.openCommandPalette}
      className="text-fg-subtle hover:bg-accent hover:text-foreground hidden h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors sm:flex"
    >
      <Search className="size-3.5 shrink-0" aria-hidden />
      <span>{ar.common.search}</span>
      <kbd className="bg-surface-sunken rounded border px-1 py-0.5 font-sans text-[0.625rem]">
        {ar.shell.commandShortcut}
      </kbd>
    </button>
  )
}
