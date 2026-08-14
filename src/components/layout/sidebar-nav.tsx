'use client'

import {
  LayoutDashboard,
  ScrollText,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { ar } from '@/i18n/ar'
import type { NavItem } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/**
 * The sidebar, rendered from the already-filtered list the server passed down.
 *
 * The filtering is deliberately *not* done here. This component receives
 * `items` and draws them; deciding which items exist is a permission decision
 * and it happens server-side in the layout (CLAUDE.md invariant 3). A client
 * component that filtered by permission would be shipping the permission set to
 * the browser as the basis of a security decision.
 */

const ICONS: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  users: Users,
  shield: Shield,
  settings: Settings,
  'scroll-text': ScrollText,
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav aria-label={ar.a11y.openMenu} className="flex flex-col gap-0.5 p-2">
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`)

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span>{ar.nav[item.labelKey as keyof typeof ar.nav]}</span>
          </Link>
        )
      })}
    </nav>
  )
}
