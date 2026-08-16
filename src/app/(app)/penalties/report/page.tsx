import type { Metadata } from 'next'
import Link from 'next/link'

import { MoneyText } from '@/components/data/money-text'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ar } from '@/i18n/ar'
import { formatDate } from '@/lib/datetime'
import { getDeductionsReport } from '@/modules/penalty/queries'

export const metadata: Metadata = { title: ar.reports.deductions }

/**
 * SPEC R4 — "Deductions are reported as agency income in reports only."
 *
 * ── What this page deliberately does not have ─────────────────────────────
 *
 * SPEC §1 finishes that sentence with "**No profit/margin math anywhere**",
 * and the constraint is kept by omission rather than by a comment in a service:
 * there is no revenue figure on this page, no cost figure, no ratio, no
 * percentage of anything. It answers one question — how much was deducted in
 * this period, and how much of that was given back — and gives the reader
 * nothing to divide.
 *
 * The gross and the reversed are shown **beside** the net, never folded into
 * it. A month with 10,000 deducted and 9,000 reversed is a completely different
 * month from one with 1,000 deducted, and a single net figure makes those two
 * look identical — which is precisely the summary that would stop somebody
 * noticing that the engine and the managers are pulling in opposite directions.
 *
 * A full page rather than a sheet, per SPEC §9: "Full pages exist only for
 * lists, dashboards, settings, and reports."
 */
export default async function DeductionsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (key: string): string | undefined => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }

  const groupBy = one('groupBy') ?? 'month'
  // Defaults to the last twelve Cairo months, which is the span a manager
  // actually asks about. Both ends stay in the URL so the view is linkable.
  const now = new Date()
  const to = one('to') ?? new Date(now.getTime() + 86_400_000).toISOString()
  const from =
    one('from') ??
    new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)).toISOString()

  const report = await getDeductionsReport({ from, to, groupBy })

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{ar.reports.deductions}</h1>
          <p className="text-muted-foreground text-sm">{ar.reports.deductionsAsIncome}</p>
        </div>
        <Link
          href="/penalties"
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
        >
          {ar.penalties.register}
        </Link>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={ar.reports.groupBy}>
        {(['month', 'cycle', 'project', 'worker'] as const).map((group) => (
          <Link
            key={group}
            href={`/penalties/report?groupBy=${group}`}
            data-active={group === report.groupBy}
            className="border-border data-[active=true]:bg-accent data-[active=true]:text-accent-foreground rounded-md border px-3 py-1.5 text-sm"
          >
            {ar.reports.groups[group]}
          </Link>
        ))}
      </nav>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.reports.grossPenalties}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText value={report.totalPenalties} withCurrency className="text-2xl" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.reports.reversedPenalties}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText value={report.totalReversed} withCurrency className="text-2xl" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {ar.reports.netPenalties}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText value={report.totalNet} withCurrency className="text-2xl" />
          </CardContent>
        </Card>
      </section>

      <p className="text-muted-foreground text-xs">
        {ar.reports.period}: {formatDate(report.from)} — {formatDate(report.to)}
      </p>

      {report.rows.length === 0 ? (
        <EmptyState title={ar.reports.empty} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{ar.reports.groups[report.groupBy]}</TableHead>
              <TableHead className="text-end">{ar.reports.grossPenalties}</TableHead>
              <TableHead className="text-end">{ar.reports.reversedPenalties}</TableHead>
              <TableHead className="text-end">{ar.reports.netPenalties}</TableHead>
              <TableHead className="text-end">{ar.reports.entryCount}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="numeric-latn">{row.label}</TableCell>
                <TableCell className="text-end">
                  <MoneyText value={row.penalties} />
                </TableCell>
                <TableCell className="text-end">
                  <MoneyText value={row.reversed} />
                </TableCell>
                <TableCell className="text-end">
                  <MoneyText value={row.net} />
                </TableCell>
                <TableCell className="numeric-latn text-end">{row.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
