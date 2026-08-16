import type { Metadata } from 'next'

import { MoneyText } from '@/components/data/money-text'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { can } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'
import { getMoneyRegister, getPenaltyProfiles } from '@/modules/penalty/queries'

import { PenaltiesClient } from './penalties-client'

export const metadata: Metadata = { title: ar.penalties.title }

/**
 * The manager's register (phase brief item 9).
 *
 * A Server Component: three indexed queries, no client-side data waterfall, and
 * nothing about anybody's pay shipped to the browser beyond the page being
 * looked at. The filters live in the URL (SPEC §9), so a filtered register is
 * linkable and the back button steps through filter changes.
 *
 * The header's three figures are deliberately *three* and not one. A month with
 * 10,000 deducted and 9,000 reversed is a very different month from one with
 * 1,000 deducted, and a single net number would make them look identical —
 * which is exactly the kind of summary that stops a manager noticing that the
 * engine and the humans are pulling in opposite directions.
 */
export default async function PenaltiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (key: string): string | undefined => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }

  const actor = await requireActor()
  const register = await getMoneyRegister({
    kind: one('kind'),
    userId: one('user'),
    automatic: one('automatic'),
    reversed: one('reversed'),
    page: one('page') ?? 1,
    pageSize: 50,
  })

  // SPEC R2's named formulas, loaded here so the sheet is not a second round
  // trip after first paint. Null for a caller without `settings.view` — the
  // agency's rules are not every manager's to read, and `getPenaltyProfiles`
  // enforces that server-side regardless of what this page renders.
  const profiles = can(actor, 'settings.view') ? await getPenaltyProfiles() : null

  // Every منفّذ with money history, for the filter. Soft-delete respected
  // (CLAUDE.md invariant 8), and read here rather than in the client so the
  // list is not a second round trip after first paint.
  const workers = await prisma.user.findMany({
    where: { deletedAt: null, isWorker: true },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true },
    take: 200,
  })

  const whatsappTemplates = await getSetting('whatsapp.templates')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{ar.penalties.title}</h1>
        <p className="text-muted-foreground text-sm">{ar.penalties.subtitle}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.penalties.penalties}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText
              value={register.totalPenalties}
              withCurrency
              className="text-2xl"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.ledger.reversed}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText value={register.totalReversed} withCurrency className="text-2xl" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.penalties.fields.amount}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <MoneyText value={register.netPenalties} withCurrency className="text-2xl" />
            {/* SPEC R4: deductions are agency income. No margin, no ratio. */}
            <p className="text-muted-foreground text-xs">
              {ar.reports.deductionsAsIncome}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.bonuses.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText value={register.totalBonuses} withCurrency className="text-2xl" />
          </CardContent>
        </Card>
      </section>

      <PenaltiesClient
        register={register}
        workers={workers}
        canReversePenalty={can(actor, 'penalty.reverse')}
        canReverseBonus={can(actor, 'bonus.reverse')}
        canCreatePenalty={can(actor, 'penalty.create')}
        canCreateBonus={can(actor, 'bonus.create')}
        profiles={profiles}
        canEditProfiles={can(actor, 'settings.edit')}
        whatsappTemplates={whatsappTemplates}
      />
    </div>
  )
}
