import { ar } from '@/i18n/ar'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { buildWorkbook, INTEGER_FORMAT, MONEY_FORMAT, PERCENT_FORMAT } from '@/lib/xlsx'
import type { DeductionsReportDto } from '@/modules/penalty/register'

import type {
  MonthlyVirallapSummaryDto,
  PayoutStatementReportDto,
  ProjectSummaryReportDto,
  WorkerPerformanceReportDto,
} from './types'

/**
 * modules/report/xlsx.ts — turns each report DTO into an `.xlsx` buffer via
 * `lib/xlsx` (phase brief item 5: "Arabic headers, RTL sheet direction,
 * Western numerals, correct column widths").
 *
 * A money-typed DTO field is a 2dp string (CLAUDE.md invariant 2); this is the
 * one place it becomes a JS `number` again, specifically so Excel's own
 * `#,##0.00` format renders it — never so it re-enters arithmetic.
 */

const EM_DASH = '—'

export function buildPayoutStatementWorkbook(report: PayoutStatementReportDto): Buffer {
  const c = ar.reports.payoutStatement.columns
  const rows = report.rows.map((payout) => [
    payout.user?.fullName ?? EM_DASH,
    payout.user?.username ?? EM_DASH,
    Number(payout.carriedForward),
    Number(payout.gross),
    Number(payout.penalties),
    Number(payout.bonuses),
    Number(payout.advances),
    Number(payout.adjustments),
    Number(payout.net),
    Number(payout.paidAmount),
    Number(payout.outstanding),
    ar.enums.payoutStatus[payout.status],
    payout.method ?? EM_DASH,
    payout.paidAt ? formatDateTime(payout.paidAt) : EM_DASH,
  ])

  return buildWorkbook([
    {
      name: ar.reports.payoutStatement.sheetName,
      columns: [
        { header: c.worker, width: 24 },
        { header: c.username, width: 16 },
        { header: c.carriedForward, width: 16, numberFormat: MONEY_FORMAT },
        { header: c.gross, width: 14, numberFormat: MONEY_FORMAT },
        { header: c.penalties, width: 14, numberFormat: MONEY_FORMAT },
        { header: c.bonuses, width: 14, numberFormat: MONEY_FORMAT },
        { header: c.advances, width: 14, numberFormat: MONEY_FORMAT },
        { header: c.adjustments, width: 14, numberFormat: MONEY_FORMAT },
        { header: c.net, width: 14, numberFormat: MONEY_FORMAT },
        { header: c.paid, width: 14, numberFormat: MONEY_FORMAT },
        { header: c.outstanding, width: 14, numberFormat: MONEY_FORMAT },
        { header: c.status, width: 12 },
        { header: c.method, width: 16 },
        { header: c.paidAt, width: 18 },
      ],
      rows,
    },
  ])
}

export function buildProjectSummaryWorkbook(report: ProjectSummaryReportDto): Buffer {
  const c = ar.reports.projectSummary.columns
  const rows = report.rows.map((row) => [
    row.code,
    row.name,
    ar.enums.projectStatus[row.status as keyof typeof ar.enums.projectStatus] ??
      row.status,
    ar.health[row.health as keyof typeof ar.health] ?? row.health,
    row.totalTasks,
    row.completedTasks,
    row.overdueTasks,
    row.completionPercent,
  ])

  return buildWorkbook([
    {
      name: ar.reports.projectSummary.sheetName,
      columns: [
        { header: c.code, width: 14 },
        { header: c.name, width: 28 },
        { header: c.status, width: 14 },
        { header: c.health, width: 14 },
        { header: c.totalTasks, width: 14, numberFormat: INTEGER_FORMAT },
        { header: c.completedTasks, width: 16, numberFormat: INTEGER_FORMAT },
        { header: c.overdueTasks, width: 16, numberFormat: INTEGER_FORMAT },
        { header: c.completionPercent, width: 14, numberFormat: PERCENT_FORMAT },
      ],
      rows,
    },
  ])
}

export function buildWorkerPerformanceWorkbook(
  report: WorkerPerformanceReportDto,
): Buffer {
  const c = ar.reports.workerPerformance.columns
  const rows = report.rows.map((row) => [
    row.fullName,
    row.username,
    row.score !== null ? Number(row.score) : ar.reports.workerPerformance.neverComputed,
    row.onTimeRate !== null ? Number(row.onTimeRate) : EM_DASH,
    row.qualityScore !== null ? Number(row.qualityScore) : EM_DASH,
    row.volumeScore !== null ? Number(row.volumeScore) : EM_DASH,
    row.estimateAccuracy !== null ? Number(row.estimateAccuracy) : EM_DASH,
    row.taskCount ?? 0,
    row.computedAt ? formatDateTime(row.computedAt) : EM_DASH,
  ])

  return buildWorkbook([
    {
      name: ar.reports.workerPerformance.sheetName,
      columns: [
        { header: c.worker, width: 24 },
        { header: c.username, width: 16 },
        { header: c.score, width: 12, numberFormat: PERCENT_FORMAT },
        { header: c.onTimeRate, width: 14, numberFormat: PERCENT_FORMAT },
        { header: c.qualityScore, width: 14, numberFormat: PERCENT_FORMAT },
        { header: c.volumeScore, width: 14, numberFormat: PERCENT_FORMAT },
        { header: c.estimateAccuracy, width: 14, numberFormat: PERCENT_FORMAT },
        { header: c.taskCount, width: 16, numberFormat: INTEGER_FORMAT },
        { header: c.computedAt, width: 18 },
      ],
      rows,
    },
  ])
}

/**
 * One row, five columns — deliberately not a "metric: value" pair list.
 * `lib/xlsx` formats a *column*, so a wide, single-row layout is what lets
 * the count, the two percentages and the two money figures each keep their
 * own Excel number format instead of falling back to plain digits.
 */
export function buildMonthlyVirallapSummaryWorkbook(
  report: MonthlyVirallapSummaryDto,
): Buffer {
  const a = ar.reports.virallapSummary
  const rows = [
    [
      `${formatDate(report.from)} — ${formatDate(report.to)}`,
      report.completedTasks,
      report.onTimeRate,
      Number(report.totalPaid),
      Number(report.totalDeductions),
    ],
  ]

  return buildWorkbook([
    {
      name: a.sheetName,
      columns: [
        { header: a.month, width: 26 },
        { header: a.completedTasks, width: 16, numberFormat: INTEGER_FORMAT },
        { header: a.onTimeRate, width: 16, numberFormat: PERCENT_FORMAT },
        { header: a.totalPaid, width: 16, numberFormat: MONEY_FORMAT },
        { header: a.totalDeductions, width: 18, numberFormat: MONEY_FORMAT },
      ],
      rows,
    },
  ])
}

/**
 * SPEC R4's pre-existing report (`/penalties/report`), the fifth export: the
 * phase brief's "Reports, all permission-gated and all exportable to .xlsx"
 * reads as every report screen, not only the four this phase adds.
 */
export function buildDeductionsWorkbook(report: DeductionsReportDto): Buffer {
  const r = ar.reports
  const rows = report.rows.map((row) => [
    row.label,
    Number(row.penalties),
    Number(row.reversed),
    Number(row.net),
    row.count,
  ])

  return buildWorkbook([
    {
      name: r.deductions,
      columns: [
        { header: r.groups[report.groupBy], width: 20 },
        { header: r.grossPenalties, width: 16, numberFormat: MONEY_FORMAT },
        { header: r.reversedPenalties, width: 16, numberFormat: MONEY_FORMAT },
        { header: r.netPenalties, width: 16, numberFormat: MONEY_FORMAT },
        { header: r.entryCount, width: 14, numberFormat: INTEGER_FORMAT },
      ],
      rows,
    },
  ])
}
