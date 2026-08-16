'use client'

import { Bell, KeyRound, LogOut } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'

import { Avatar } from '@/components/data/user-chip'
import { AppearanceControls } from '@/components/layout/appearance-toggles'
import {
  Popover,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
} from '@/components/shared/popover'
import { ar } from '@/i18n/ar'
import { logoutAction } from '@/modules/auth/actions'

/**
 * Identity, the two things you can do with it, and the appearance controls.
 *
 * Theme and density live here rather than in the header strip because they are
 * settings a person changes twice a year. Two permanent icon buttons in the
 * header would spend prime real estate on that, next to a notification bell
 * people actually use.
 */
export function UserMenu({
  user,
}: {
  user: { id: string; fullName: string; username: string }
}) {
  const [pending, startTransition] = React.useTransition()

  return (
    <Popover
      align="end"
      label={ar.shell.userMenu}
      className="w-64"
      trigger={({ toggle, ...triggerProps }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={ar.shell.userMenu}
          className="hover:bg-accent flex items-center gap-2 rounded-md p-1 transition-colors focus-visible:outline-none"
          {...triggerProps}
        >
          <Avatar user={user} size="sm" />
          <span className="hidden text-sm font-medium sm:inline">{user.fullName}</span>
        </button>
      )}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <Avatar user={user} size="md" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium">{user.fullName}</span>
          <span className="text-fg-subtle truncate text-xs" dir="ltr">
            {user.username}
          </span>
        </div>
      </div>

      <PopoverSeparator />

      <PopoverLabel>{ar.shell.appearance}</PopoverLabel>
      <AppearanceControls />

      <PopoverSeparator />

      <PopoverItem asChild>
        <Link href="/notifications/preferences">
          <Bell className="size-4 shrink-0" aria-hidden />
          {ar.notifications.preferencesLink}
        </Link>
      </PopoverItem>

      <PopoverItem asChild>
        <Link href="/change-password">
          <KeyRound className="size-4 shrink-0" aria-hidden />
          {ar.auth.changePassword}
        </Link>
      </PopoverItem>

      <PopoverItem
        disabled={pending}
        onClick={() => startTransition(async () => void (await logoutAction()))}
      >
        <LogOut className="size-4 shrink-0" aria-hidden />
        {ar.auth.signOut}
      </PopoverItem>
    </Popover>
  )
}
