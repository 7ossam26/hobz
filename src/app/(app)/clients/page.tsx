import type { Metadata } from 'next'

import { fromNextSearchParams } from '@/components/shared/data-table/next-search-params'
import { parseTableState } from '@/components/shared/data-table/state'
import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/rbac'
import { getClients } from '@/modules/client/queries'

import { ClientsClient } from './clients-client'

export const metadata: Metadata = { title: ar.clients.title }

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requireActor()
  // `getClients()` asserts `client.view` itself (CLAUDE.md invariant 3).
  // Reaching this line without it is impossible.
  const state = parseTableState(fromNextSearchParams(await searchParams))

  const page = await getClients({
    search: state.search || undefined,
    page: state.page,
    pageSize: state.pageSize,
  })

  return (
    <ClientsClient state={state} page={page} canManage={can(actor, 'client.manage')} />
  )
}
