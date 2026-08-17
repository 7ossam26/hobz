import { Download } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { MoneyText } from '@/components/data/money-text'
import { UserChip } from '@/components/data/user-chip'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ar } from '@/i18n/ar'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { getPayoutCycles } from '@/modules/payout/queries'
import { getPayoutStatementReport } from '@/modules/report/queries'

export const metadata: Metadata = { title: ar.reports.payoutStatement.title }

export default async function PayoutStatementReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const cycleIdParam = params.cycleId
  const cycleId = typeof cycleIdParam === 'string' ? cycleIdParam : undefined

  const [report, cycles] = await Promise.all([
    getPayoutStatementReport(cycleId),
    getPayoutCycles(24),
  ])

  const c = ar.reports.payoutStatement.columns

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{ar.reports.payoutStatement.title}</h1>
          {report.cycle ? (
            <p className="text-muted-foreground text-sm">
              {formatDate(report.cycle.periodStart)} — {formatDate(report.cycle.periodEnd)}
            </p>
          ) : null}
        </div>
        {report.cycle ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/api/reports/payout-statement?cycleId=${report.cycle.id}`} download>
              <Download className="size-4" aria-hidden />
              {ar.reports.export}
            </a>
          </Button>
        ) : null}
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={ar.reports.payoutStatement.selectCycle}>
        {cycles.map((cycle) => (
          <Link
            key={cycle.id}
            href={`/reports/payout-statement?cycleId=${cycle.id}`}
            data-active={cycle.id === report.cycle?.id}
            className="border-border data-[active=true]:bg-accent data-[active=true]:text-accent-foreground rounded-md border px-3 py-1.5 text-sm whitespace-nowrap"
          >
            {formatDate(cycle.periodStart)} — {formatDate(cycle.periodEnd)}
          </Link>
        ))}
      </nav>

      {report.rows.length === 0 ? (
        <EmptyState title={ar.reports.payoutStatement.empty} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{c.worker}</TableHead>
                <TableHead className="text-end">{c.carriedForward}</TableHead>
                <TableHead className="text-end">{c.gross}</TableHead>
                <TableHead className="text-end">{c.penalties}</TableHead>
                <TableHead className="text-end">{c.bonuses}</TableHead>
                <TableHead className="text-end">{c.advances}</TableHead>
                <TableHead className="text-end">{c.adjustments}</TableHead>
                <TableHead className="text-end">{c.net}</TableHead>
                <TableHead className="text-end">{c.paid}</TableHead>
                <TableHead className="text-end">{c.outstanding}</TableHead>
                <TableHead>{c.status}</TableHead>
                <TableHead>{c.paidAt}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell>
                    {payout.user ? (
                      <UserChip user={payout.user} size="sm" showWhatsapp={false} />
                    ) : (
                      ar.common.unknown
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.carriedForward} />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.gross} />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.penalties} />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.bonuses} />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.advances} />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.adjustments} />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.net} />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.paidAmount} />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText value={payout.outstanding} />
                  </TableCell>
                  <TableCell>{ar.enums.payoutStatus[payout.status]}</TableCell>
                  <TableCell className="text-fg-subtle text-xs whitespace-nowrap">
                    {payout.paidAt ? formatDateTime(payout.paidAt) : ar.common.none}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
