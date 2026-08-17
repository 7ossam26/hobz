import { Download } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { MoneyText } from '@/components/data/money-text'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { cairoParts } from '@/lib/calendar/cairo'
import { formatDate } from '@/lib/datetime'
import { getMonthlyAgencySummary } from '@/modules/report/queries'

export const metadata: Metadata = { title: ar.reports.agencySummary.title }

function shiftMonthKey(monthKey: string, delta: number): string {
  const [yearPart, monthPart] = monthKey.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  const zeroBased = month - 1 + delta
  const shiftedYear = year + Math.floor(zeroBased / 12)
  const shiftedMonth = ((zeroBased % 12) + 12) % 12
  return `${shiftedYear}-${String(shiftedMonth + 1).padStart(2, '0')}`
}

export default async function AgencySummaryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const now = new Date()
  const { year, month } = cairoParts(now)
  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`
  const monthParam = params.month
  const monthKey = typeof monthParam === 'string' ? monthParam : currentMonthKey

  const report = await getMonthlyAgencySummary(monthKey, now)
  const a = ar.reports.agencySummary

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{a.title}</h1>
          <p className="text-muted-foreground text-sm">
            {formatDate(report.from)} — {formatDate(report.to)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/reports/agency-summary?month=${shiftMonthKey(monthKey, -1)}`}
            className="border-border rounded-md border px-3 py-1.5 text-sm"
          >
            {ar.common.previous}
          </Link>
          {monthKey !== currentMonthKey ? (
            <Link
              href={`/reports/agency-summary?month=${shiftMonthKey(monthKey, 1)}`}
              className="border-border rounded-md border px-3 py-1.5 text-sm"
            >
              {ar.common.next}
            </Link>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <a href={`/api/reports/agency-summary?month=${monthKey}`} download>
              <Download className="size-4" aria-hidden />
              {ar.reports.export}
            </a>
          </Button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {a.completedTasks}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="numeric-latn text-2xl font-semibold">{report.completedTasks}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {a.onTimeRate}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="numeric-latn text-2xl font-semibold" dir="ltr">
              {report.onTimeRate}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {a.totalPaid}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText value={report.totalPaid} withCurrency className="text-2xl" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {a.totalDeductions}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyText value={report.totalDeductions} withCurrency className="text-2xl" />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
