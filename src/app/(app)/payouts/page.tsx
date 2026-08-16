import type { Metadata } from 'next'

import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'
import { getPayoutCycles, getPayouts } from '@/modules/payout/queries'

import { PayoutsClient } from './payouts-client'

export const metadata: Metadata = { title: ar.payouts.title }

/**
 * The finance side of SPEC §5.5: cycles, the payouts each one generated, and
 * the three decisions that move them — close, approve, pay.
 *
 * The phase brief only names the worker-facing page, but the lifecycle it
 * describes ("DRAFT → APPROVED → PAID … also closeable early by permission")
 * has to be reachable by a human for any of it to be real, and
 * docs/TESTING.md §6 flow 5 walks exactly this screen. Kept deliberately
 * plain: one list, one table, two dialogs.
 */
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requireActor()
  const params = await searchParams
  const requested = Array.isArray(params.cycle) ? params.cycle[0] : params.cycle

  // `getPayoutCycles` asserts `payout.view` itself (CLAUDE.md invariant 3).
  const cycles = await getPayoutCycles(24)
  const selected = cycles.find((cycle) => cycle.id === requested) ?? cycles[0] ?? null

  const [payouts, paymentMethods, whatsappTemplates] = await Promise.all([
    selected ? getPayouts({ cycleId: selected.id }) : Promise.resolve([]),
    getSetting('payout.paymentMethods'),
    getSetting('whatsapp.templates'),
  ])

  return (
    <PayoutsClient
      cycles={cycles}
      selectedCycleId={selected?.id ?? null}
      payouts={payouts}
      paymentMethods={[...paymentMethods]}
      whatsappTemplates={whatsappTemplates}
      canGenerate={can(actor, 'payout.generate')}
      canApprove={can(actor, 'payout.approve')}
      canMarkPaid={can(actor, 'payout.markPaid')}
    />
  )
}
