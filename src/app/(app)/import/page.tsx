import type { Metadata } from 'next'

import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { assertCan } from '@/lib/rbac'

import { ImportWizard } from './import-wizard'

export const metadata: Metadata = { title: ar.import.title }

/**
 * `/import` — SPEC §10. A full page rather than a sheet, alongside
 * `/reports` and `/settings`: the flow is template → upload → a preview
 * table that can run to hundreds of rows → confirm, which is exactly the
 * "list/dashboard/report/settings" shape SPEC §9 already reserves a full
 * page for, not an entity being edited.
 */
export default async function ImportPage() {
  const actor = await requireActor()
  assertCan(actor, 'import.run')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{ar.import.title}</h1>
        <p className="text-muted-foreground text-sm">{ar.import.subtitle}</p>
      </header>

      <ImportWizard />
    </div>
  )
}
