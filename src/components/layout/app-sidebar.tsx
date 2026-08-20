'use client'

import {
  Banknote,
  BarChart3,
  CalendarDays,
  Gavel,
  Building2,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  ScrollText,
  Settings,
  Shield,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import * as React from 'react'

import { usePreferences } from '@/components/layout/preferences-provider'
import { ar } from '@/i18n/ar'
import type { NavItem } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/**
 * The sidebar. SPEC §9: "right-side collapsible sidebar (RTL-correct)".
 *
 * Under `dir="rtl"` the inline **start** is the right-hand edge, so the sidebar
 * needs no direction-specific code at all — it is placed first in the flex row
 * and separated by `border-e`, and the browser puts it on the correct side.
 * That is the whole RTL story here, and it is why there is not a single `left`
 * or `right` in this file. (The one exception is the collapse chevron, which
 * points at a physical direction on screen and is therefore chosen by
 * direction, not by logic.)
 *
 * Collapsed it is icon-only, and below `md` it is *always* icon-only: on a
 * phone the labels would take a third of the screen. Nothing is hidden — every
 * destination stays reachable, with its name in the tooltip and in the
 * accessible name.
 *
 * **The filtering is not done here.** This component receives `items` and draws
 * them; deciding which items exist is a permission decision made server-side in
 * the layout (CLAUDE.md invariant 3). A client component filtering by
 * permission would be shipping the permission set to the browser as the basis
 * of a security decision.
 */

const ICONS: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  'folder-kanban': FolderKanban,
  'list-todo': ListTodo,
  'building-2': Building2,
  users: Users,
  shield: Shield,
  settings: Settings,
  'scroll-text': ScrollText,
  wallet: Wallet,
  banknote: Banknote,
  gavel: Gavel,
  'bar-chart-3': BarChart3,
  'calendar-days': CalendarDays,
  upload: Upload,
}

export function AppSidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const { sidebar, toggleSidebar } = usePreferences()
  const collapsed = sidebar === 'collapsed'

  return (
    <aside
      data-collapsed={collapsed}
      aria-label={ar.shell.navigation}
      className={cn(
        'bg-card sticky top-0 flex h-dvh shrink-0 flex-col border-e transition-[width] duration-200 ease-out',
        collapsed
          ? 'w-(--shell-sidebar-w-collapsed)'
          : 'w-(--shell-sidebar-w-collapsed) md:w-(--shell-sidebar-w)',
      )}
    >
      <div className="flex h-(--shell-header-h) shrink-0 items-center gap-2 border-b px-3">
        <Image
          src="/logo.png"
          alt={ar.app.shortName}
          width={28}
          height={28}
          className="shrink-0 rounded-md"
        />
        <span
          className={cn(
            'truncate text-sm font-semibold tracking-tight',
            collapsed ? 'sr-only' : 'sr-only md:not-sr-only',
          )}
        >
          {ar.app.name}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {items.map((item) => {
          const Icon = ICONS[item.icon] ?? LayoutDashboard
          const label = ar.nav[item.labelKey as keyof typeof ar.nav]
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              title={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
                active
                  ? 'bg-accent-soft text-accent-on-soft font-medium'
                  : 'text-fg-muted hover:bg-accent hover:text-foreground',
              )}
            >
              {/* The active marker sits on the inline start edge, mirroring
                  with the sidebar rather than being pinned to one side. */}
              {active ? (
                <span
                  aria-hidden
                  className="bg-accent-solid absolute start-0 my-auto h-4 w-0.5 rounded-full"
                />
              ) : null}
              <Icon className="size-4 shrink-0" aria-hidden />
              <span
                className={cn(
                  'truncate',
                  collapsed ? 'sr-only' : 'sr-only md:not-sr-only',
                )}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </nav>

      <div className="hidden shrink-0 border-t p-2 md:block">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          aria-label={collapsed ? ar.shell.expandSidebar : ar.shell.collapseSidebar}
          title={collapsed ? ar.shell.expandSidebar : ar.shell.collapseSidebar}
          className="text-fg-muted hover:bg-accent hover:text-foreground flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none"
        >
          {/* Physical icons on purpose: the sidebar is on the right, so
              collapsing it moves its edge to the right. */}
          {collapsed ? (
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          )}
          <span className={collapsed ? 'sr-only' : 'truncate'}>{ar.common.collapse}</span>
        </button>
      </div>
    </aside>
  )
}
