import type { Metadata } from 'next'

import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { can } from '@/lib/rbac'
import { listHolidays } from '@/modules/holiday/service'
import { getSettingsByGroup } from '@/modules/setting/queries'

import { HolidaysSection } from './holidays-section'
import { SettingsClient } from './settings-client'

export const metadata: Metadata = { title: ar.settings.title }

/**
 * The one Settings page (SPEC §7).
 *
 * A Server Component. `getSettingsByGroup` carries the `settings.view` check
 * itself, so this file cannot render for someone who lacks it however it is
 * reached — the nav item and the middleware are the courtesy, that query is the
 * enforcement (CLAUDE.md invariant 3). `settings.edit` is read separately and
 * only decides whether the controls are interactive; the write path checks it
 * again in `updateSettingsAction`.
 *
 * Holidays are fetched here rather than by the client component, so the page
 * has no data waterfall: one server render, everything present.
 */
export default async function SettingsPage() {
  const actor = await requireActor()

  const [groups, holidays] = await Promise.all([
    getSettingsByGroup(),
    // Reads are ungated by design (`modules/holiday/actions.ts`): which days
    // the agency is closed is not confidential. `calendar.manage` gates writes.
    listHolidays(prisma),
  ])

  const canEdit = can(actor, 'settings.edit')
  const canManageCalendar = can(actor, 'calendar.manage')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{ar.settings.title}</h1>
        <p className="text-muted-foreground text-sm">{ar.settings.subtitle}</p>
      </header>

      <SettingsClient
        groups={groups}
        canEdit={canEdit}
        holidaysSlot={
          <HolidaysSection holidays={holidays} canManage={canManageCalendar} />
        }
      />
    </div>
  )
}
