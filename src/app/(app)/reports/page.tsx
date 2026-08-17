import type { Metadata } from 'next'
import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { assertCan } from '@/lib/rbac'

export const metadata: Metadata = { title: ar.reports.title }

const REPORT_LINKS = [
  {
    href: '/reports/payout-statement',
    title: ar.reports.hub.payoutStatement,
    hint: ar.reports.hub.payoutStatementHint,
  },
  {
    href: '/reports/project-summary',
    title: ar.reports.hub.projectSummary,
    hint: ar.reports.hub.projectSummaryHint,
  },
  {
    href: '/reports/worker-performance',
    title: ar.reports.hub.workerPerformance,
    hint: ar.reports.hub.workerPerformanceHint,
  },
  {
    href: '/reports/agency-summary',
    title: ar.reports.hub.agencySummary,
    hint: ar.reports.hub.agencySummaryHint,
  },
  {
    href: '/penalties/report',
    title: ar.reports.hub.deductions,
    hint: ar.reports.hub.deductionsHint,
  },
] as const

/** The `/reports` hub — one card per report, each permission-gated on open. */
export default async function ReportsHubPage() {
  const actor = await requireActor()
  assertCan(actor, 'report.view')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{ar.reports.title}</h1>
        <p className="text-muted-foreground text-sm">{ar.reports.subtitle}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_LINKS.map((report) => (
          <Link key={report.href} href={report.href}>
            <Card className="h-full transition-shadow hover:shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">{report.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">{report.hint}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
