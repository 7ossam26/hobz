import { Download } from 'lucide-react'
import type { Metadata } from 'next'

import { HealthBadge } from '@/components/data/health-badge'
import { ProjectStatusChip } from '@/components/data/status-chip'
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
import { getProjectSummaryReport } from '@/modules/report/queries'

export const metadata: Metadata = { title: ar.reports.projectSummary.title }

export default async function ProjectSummaryReportPage() {
  const report = await getProjectSummaryReport()
  const c = ar.reports.projectSummary.columns

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">{ar.reports.projectSummary.title}</h1>
        <Button asChild variant="outline" size="sm">
          <a href="/api/reports/project-summary" download>
            <Download className="size-4" aria-hidden />
            {ar.reports.export}
          </a>
        </Button>
      </header>

      {report.rows.length === 0 ? (
        <EmptyState title={ar.reports.projectSummary.empty} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{c.code}</TableHead>
                <TableHead>{c.name}</TableHead>
                <TableHead>{c.status}</TableHead>
                <TableHead>{c.health}</TableHead>
                <TableHead className="text-end">{c.totalTasks}</TableHead>
                <TableHead className="text-end">{c.completedTasks}</TableHead>
                <TableHead className="text-end">{c.overdueTasks}</TableHead>
                <TableHead className="text-end">{c.completionPercent}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.projectId}>
                  <TableCell className="numeric-latn">{row.code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    <ProjectStatusChip status={row.status} size="sm" />
                  </TableCell>
                  <TableCell>
                    <HealthBadge health={row.health} />
                  </TableCell>
                  <TableCell className="numeric-latn text-end">{row.totalTasks}</TableCell>
                  <TableCell className="numeric-latn text-end">{row.completedTasks}</TableCell>
                  <TableCell className="numeric-latn text-end">{row.overdueTasks}</TableCell>
                  <TableCell className="numeric-latn text-end" dir="ltr">
                    {row.completionPercent}%
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
