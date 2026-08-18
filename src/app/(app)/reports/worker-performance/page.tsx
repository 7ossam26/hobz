import { Download } from 'lucide-react'
import type { Metadata } from 'next'

import { RelativeTime } from '@/components/data/relative-time'
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
import { getWorkerPerformanceReport } from '@/modules/report/queries'

export const metadata: Metadata = { title: ar.reports.workerPerformance.title }

export default async function WorkerPerformanceReportPage() {
  const report = await getWorkerPerformanceReport()
  const c = ar.reports.workerPerformance.columns

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">{ar.reports.workerPerformance.title}</h1>
        <Button asChild variant="outline" size="sm">
          <a href="/api/reports/worker-performance" download>
            <Download className="size-4" aria-hidden />
            {ar.reports.export}
          </a>
        </Button>
      </header>

      {report.rows.length === 0 ? (
        <EmptyState title={ar.reports.workerPerformance.empty} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{c.worker}</TableHead>
                <TableHead className="text-end">{c.score}</TableHead>
                <TableHead className="text-end">{c.onTimeRate}</TableHead>
                <TableHead className="text-end">{c.qualityScore}</TableHead>
                <TableHead className="text-end">{c.volumeScore}</TableHead>
                <TableHead className="text-end">{c.estimateAccuracy}</TableHead>
                <TableHead className="text-end">{c.taskCount}</TableHead>
                <TableHead>{c.computedAt}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell>
                    <UserChip
                      user={{
                        id: row.userId,
                        fullName: row.fullName,
                        username: row.username,
                      }}
                      size="sm"
                      showWhatsapp={false}
                    />
                  </TableCell>
                  <TableCell className="numeric-latn text-end font-medium" dir="ltr">
                    {row.score ?? ar.reports.workerPerformance.neverComputed}
                  </TableCell>
                  <TableCell className="numeric-latn text-end" dir="ltr">
                    {row.onTimeRate ?? ar.common.none}
                  </TableCell>
                  <TableCell className="numeric-latn text-end" dir="ltr">
                    {row.qualityScore ?? ar.common.none}
                  </TableCell>
                  <TableCell className="numeric-latn text-end" dir="ltr">
                    {row.volumeScore ?? ar.common.none}
                  </TableCell>
                  <TableCell className="numeric-latn text-end" dir="ltr">
                    {row.estimateAccuracy ?? ar.common.none}
                  </TableCell>
                  <TableCell className="numeric-latn text-end">
                    {row.taskCount ?? 0}
                  </TableCell>
                  <TableCell className="text-fg-subtle text-xs">
                    {row.computedAt ? (
                      <RelativeTime value={row.computedAt} />
                    ) : (
                      ar.common.none
                    )}
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
