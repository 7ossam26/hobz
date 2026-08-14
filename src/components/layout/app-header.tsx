import * as React from 'react'

import { Breadcrumb } from '@/components/layout/breadcrumb'
import { CommandPaletteTrigger } from '@/components/layout/command-palette'
import { HEADER_SLOT_IDS } from '@/components/layout/header-slot-ids'
import { NotificationBell } from '@/components/layout/notification-bell'
import { UserMenu } from '@/components/layout/user-menu'
import { ar } from '@/i18n/ar'

/**
 * The sticky contextual header (SPEC §9).
 *
 * A Server Component that composes four client islands, which is the split that
 * keeps the route budget honest: the header's structure, its Arabic labels and
 * its layout ship as HTML, and only the four things that genuinely react to a
 * click carry JavaScript.
 *
 * Layout, from the inline start: the breadcrumb says where you are; the page's
 * primary action, the palette, the bell and the account menu sit at the inline
 * end. The action anchor is a portal target — see `header-slots.tsx` for why
 * the page fills it rather than the layout.
 *
 * Opaque, not translucent. A blurred bar over scrolling content is the
 * glassmorphism SPEC §9 bans, and it costs a compositor layer on every scroll
 * frame for the privilege of making the text underneath harder to read.
 */
export function AppHeader({
  user,
}: {
  user: { id: string; fullName: string; username: string }
}) {
  return (
    <header className="bg-background sticky top-0 z-30 flex h-(--shell-header-h) shrink-0 items-center gap-3 border-b px-4 md:px-6">
      <Breadcrumb />

      <div className="ms-auto flex shrink-0 items-center gap-2">
        <div
          id={HEADER_SLOT_IDS.actions}
          aria-label={ar.shell.pageActions}
          className="flex items-center gap-2"
        />
        <CommandPaletteTrigger />
        <NotificationBell />
        <UserMenu user={user} />
      </div>
    </header>
  )
}
