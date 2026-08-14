'use client'

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'

import { HEADER_SLOT_IDS } from '@/components/layout/header-slot-ids'
import { ar } from '@/i18n/ar'
import { NAV_ITEMS } from '@/lib/navigation'

/**
 * The breadcrumb, derived from the path.
 *
 * Built from `NAV_ITEMS` — the same table the sidebar draws from and the
 * middleware guards with — so a route can never appear here under a name it
 * does not have in the navigation.
 *
 * Segments the table does not recognise (an entity id, for instance) are
 * dropped rather than printed raw: `لوحة التحكم / المستخدمون / clv8x2k…` tells
 * the reader nothing. A detail page that knows the entity's name appends it
 * through `<PageBreadcrumb>`, which lands in the anchor at the end.
 *
 * The separator is a left-pointing chevron: under RTL the trail runs right to
 * left, so "deeper" is to the left. This is one of the few places where the
 * physical icon name is the correct choice.
 */

const LABEL_BY_HREF = new Map(
  NAV_ITEMS.map((item) => [item.href, ar.nav[item.labelKey as keyof typeof ar.nav]]),
)

/** Routes that exist but are deliberately not in the navigation. */
const EXTRA_LABELS: Record<string, string> = {
  '/change-password': ar.auth.changePassword,
  '/design-system': ar.designSystem.title,
}

const HOME = { href: '/dashboard', label: ar.nav.dashboard }

export function Breadcrumb() {
  const pathname = usePathname()

  const crumbs = React.useMemo(() => {
    const trail: Array<{ href: string; label: string }> = []
    const segments = pathname.split('/').filter(Boolean)

    let href = ''
    for (const segment of segments) {
      href += `/${segment}`
      const label = LABEL_BY_HREF.get(href) ?? EXTRA_LABELS[href]
      if (label) trail.push({ href, label })
    }

    // The dashboard is the root of every trail, and never repeated.
    return trail[0]?.href === HOME.href ? trail : [HOME, ...trail]
  }, [pathname])

  return (
    <nav aria-label={ar.shell.breadcrumb} className="flex min-w-0 items-center">
      <ol className="text-fg-muted flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronLeft className="size-3.5 shrink-0 opacity-50" aria-hidden />
              ) : null}
              {last ? (
                <span
                  className="text-foreground truncate font-medium"
                  aria-current="page"
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hover:text-foreground truncate transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}

        {/* Filled by `<PageBreadcrumb>` on detail screens; empty otherwise. */}
        <li id={HEADER_SLOT_IDS.breadcrumb} className="contents" />
      </ol>
    </nav>
  )
}
