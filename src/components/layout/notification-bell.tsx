'use client'

import { Bell, Check, Settings2 } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'

import { RelativeTime } from '@/components/data/relative-time'
import { EmptyState } from '@/components/shared/empty-state'
import { Popover, PopoverSeparator } from '@/components/shared/popover'
import { useAutoRefresh } from '@/components/shared/use-auto-refresh'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/modules/notification/actions'
import type { NotificationDto } from '@/modules/notification/types'

/**
 * The notification bell — SPEC §8: "Bell + drawer + unread count." Phase 2
 * shipped the honest placeholder ("no invented count and no sample
 * notification"); this is the data it was waiting for.
 *
 * A Server Component (`AppHeader`) fetches the first page and the unread
 * count once per render, so opening the drawer is instant rather than a
 * client-side fetch — the same "no client waterfall" rule every other list in
 * the app follows. `useAutoRefresh` is what keeps it live after that: SPEC
 * §2's "polling every 30s (configurable)" calls `router.refresh()`, which
 * re-runs `AppHeader` on the server and streams new props down here.
 */
export function NotificationBell({
  notifications,
  unreadCount,
  pollingIntervalSeconds,
}: {
  notifications: NotificationDto[]
  unreadCount: number
  pollingIntervalSeconds: number
}) {
  useAutoRefresh(pollingIntervalSeconds)

  const [pending, startTransition] = React.useTransition()
  const hasUnread = unreadCount > 0

  function markOneRead(id: string) {
    startTransition(async () => {
      await markNotificationReadAction({ id })
    })
  }

  function markAllRead() {
    startTransition(async () => {
      await markAllNotificationsReadAction()
    })
  }

  return (
    <Popover
      align="end"
      label={ar.shell.notifications}
      className="w-96 p-0"
      trigger={({ toggle, ...triggerProps }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          aria-label={
            hasUnread
              ? `${ar.shell.notifications} — ${ar.notifications.unreadCount.replace(
                  '{count}',
                  String(unreadCount),
                )}`
              : ar.shell.notifications
          }
          className="relative"
          {...triggerProps}
        >
          <Bell />
          {hasUnread ? (
            <span
              data-hue="red"
              aria-hidden
              className="bg-hue-solid absolute end-1 top-1 size-2 rounded-full ring-2 ring-(--card)"
            />
          ) : null}
        </Button>
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <p className="text-sm font-semibold">{ar.notifications.title}</p>
        {hasUnread ? (
          <button
            type="button"
            disabled={pending}
            onClick={markAllRead}
            className="text-accent-solid text-xs font-medium hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {ar.notifications.markAllRead}
          </button>
        ) : null}
      </div>

      <PopoverSeparator />

      {notifications.length === 0 ? (
        <EmptyState
          className="border-0 px-2 py-8"
          title={ar.notifications.empty}
          description={ar.notifications.emptyHint}
        />
      ) : (
        <ul className="max-h-96 overflow-y-auto py-1" role="list">
          {notifications.map((n) => (
            <li key={n.id}>
              <NotificationRow
                notification={n}
                pending={pending}
                onMarkRead={markOneRead}
              />
            </li>
          ))}
        </ul>
      )}

      <PopoverSeparator />

      <div className="p-1">
        <Link
          href="/notifications/preferences"
          className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
        >
          <Settings2 className="size-4 shrink-0" aria-hidden />
          {ar.notifications.preferencesLink}
        </Link>
      </div>
    </Popover>
  )
}

function NotificationRow({
  notification,
  pending,
  onMarkRead,
}: {
  notification: NotificationDto
  pending: boolean
  onMarkRead: (id: string) => void
}) {
  const content = (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2.5',
        !notification.isRead && 'bg-surface-selected',
      )}
    >
      <span
        data-hue={notification.isRead ? undefined : 'red'}
        aria-hidden
        className={cn(
          'mt-1.5 size-1.5 shrink-0 rounded-full',
          notification.isRead ? 'bg-transparent' : 'bg-hue-solid',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{notification.title}</p>
        <p className="text-fg-muted line-clamp-2 text-xs">{notification.body}</p>
        <div className="mt-1 flex items-center gap-2">
          <RelativeTime
            value={notification.createdAt}
            className="text-fg-subtle text-[0.6875rem]"
          />
          {!notification.dismissable ? (
            <span className="text-fg-subtle text-[0.6875rem]">
              · {ar.notifications.nonDismissable}
            </span>
          ) : null}
        </div>
      </div>
      {!notification.isRead ? (
        <button
          type="button"
          disabled={pending}
          aria-label={ar.notifications.markRead}
          title={ar.notifications.markRead}
          onClick={(event) => {
            event.preventDefault()
            onMarkRead(notification.id)
          }}
          className="hover:bg-accent shrink-0 rounded-md p-1 disabled:pointer-events-none disabled:opacity-50"
        >
          <Check className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  )

  if (!notification.href) return content

  return (
    <Link
      href={notification.href}
      // Same reason as the calendar grid: opening the bell would otherwise
      // prefetch a detail page per notification, and the reader clicks at
      // most one of them.
      prefetch={false}
      onClick={() => {
        if (!notification.isRead) onMarkRead(notification.id)
      }}
      className="hover:bg-accent block transition-colors"
    >
      {content}
    </Link>
  )
}
