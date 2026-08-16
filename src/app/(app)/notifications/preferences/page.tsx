import type { Metadata } from 'next'

import { ar } from '@/i18n/ar'
import { getMyNotificationPreferences } from '@/modules/notification/queries'

import { NotificationPreferencesClient } from './preferences-client'

export const metadata: Metadata = { title: ar.notifications.preferences.title }

/**
 * The per-user notification preferences page (phase brief item 3).
 *
 * Unlisted in `lib/navigation.ts`'s `NAV_ITEMS`/`ROUTE_PERMISSIONS`, matching
 * `/change-password`: any signed-in user may reach it, because it is their
 * own preference, not agency configuration (that lives in Settings, gated by
 * `settings.edit`, and is a different page entirely — SPEC §8's WhatsApp
 * templates and escalation thresholds, not this).
 */
export default async function NotificationPreferencesPage() {
  const preferences = await getMyNotificationPreferences()

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{ar.notifications.preferences.title}</h1>
        <p className="text-muted-foreground text-sm">
          {ar.notifications.preferences.subtitle}
        </p>
      </header>

      <NotificationPreferencesClient initialPreferences={preferences} />
    </div>
  )
}
