import type { Metadata } from 'next'

import { MoneyText } from '@/components/data/money-text'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { getMyLedgerPage, getMyLedgerSummary } from '@/modules/ledger/queries'
import { getMyStatements } from '@/modules/payout/queries'

import { EarningsClient } from './earnings-client'

export const metadata: Metadata = { title: ar.ledger.myEarnings }

/**
 * مستحقاتي — SPEC §2's B6-vs-J3 decision, made concrete:
 *
 *   > **B6 vs J3 — worker earnings.** Not on the worker dashboard (per J3), but
 *   > on a separate `مستحقاتي` page showing their own ledger (per B6).
 *
 * Everything on it is the caller's own. The page passes no user id anywhere —
 * `getMyLedgerSummary` and `getMyStatements` resolve the actor themselves and
 * `getLedgerPage` scopes to `ledger.view.own` — so there is no parameter here
 * that could be tampered with into somebody else's money (CLAUDE.md invariant
 * 3).
 *
 * A Server Component with one client island for the statement sheet: three
 * indexed queries on the server, no data waterfall, nothing about a منفّذ's pay
 * shipped to the browser except their own.
 */
export default async function MyEarningsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const page = Number(Array.isArray(params.page) ? params.page[0] : (params.page ?? 1))

  const [summary, ledger, statements] = await Promise.all([
    getMyLedgerSummary(),
    getMyLedgerPage({ page: Number.isFinite(page) && page > 0 ? page : 1, pageSize: 25 }),
    getMyStatements(12),
  ])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{ar.ledger.myEarnings}</h1>
        <p className="text-muted-foreground text-sm">{ar.ledger.subtitle}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.ledger.balance}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <MoneyText
              value={summary.balance}
              withCurrency
              tone="ledger"
              className="text-2xl"
            />
            <p className="text-muted-foreground text-xs">{ar.ledger.balanceHint}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.ledger.currentCycle}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.currentCycle ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{ar.payouts.gross}</dt>
                <dd className="text-end">
                  <MoneyText value={summary.currentCycle.gross} />
                </dd>
                <dt className="text-muted-foreground">{ar.payouts.penalties}</dt>
                <dd className="text-end">
                  <MoneyText value={summary.currentCycle.penalties} />
                </dd>
                <dt className="text-muted-foreground">{ar.payouts.advances}</dt>
                <dd className="text-end">
                  <MoneyText value={summary.currentCycle.advances} />
                </dd>
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">{ar.payouts.emptyHint}</p>
            )}
            <p className="text-muted-foreground text-xs">{ar.ledger.currentCycleHint}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.ledger.outstanding}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText
              value={summary.outstandingPayouts}
              withCurrency
              className="text-2xl"
            />
          </CardContent>
        </Card>
      </section>

      <EarningsClient ledger={ledger} statements={statements} />
    </div>
  )
}
