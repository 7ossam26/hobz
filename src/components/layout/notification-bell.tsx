'use client'

import { Bell } from 'lucide-react'
import * as React from 'react'

import { EmptyState } from '@/components/shared/empty-state'
import { Popover } from '@/components/shared/popover'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'

/**
 * The notification bell — a placeholder, and deliberately an *honest* one.
 *
 * Phase 9 builds notifications: the events, the per-user preferences, the two
 * that cannot be disabled, and the 30-second poll (SPEC §8). What this phase
 * owes that phase is the shape it will land in — the bell's position in the
 * header, the unread badge's geometry, the drawer's width — so that Phase 9 is
 * a data change rather than a layout change.
 *
 * What it must not do is fake it. There is no invented count and no sample
 * notification: a placeholder that looks like real data is how a demo becomes a
 * bug report. It opens, and it says there is nothing yet.
 */
export function NotificationBell({ unreadCount = 0 }: { unreadCount?: number }) {
  const hasUnread = unreadCount > 0

  return (
    <Popover
      align="end"
      label={ar.shell.notifications}
      className="w-80"
      trigger={({ toggle, ...triggerProps }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          aria-label={
            hasUnread
              ? `${ar.shell.notifications} — ${ar.shell.unreadCount.replace(
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
      <div className="p-1">
        <EmptyState
          className="border-0 px-2 py-8"
          title={ar.shell.notificationsEmpty}
          description={ar.shell.notificationsHint}
        />
      </div>
    </Popover>
  )
}
