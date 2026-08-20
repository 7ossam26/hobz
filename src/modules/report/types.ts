import type { PayoutCycleDto, PayoutDto } from '@/modules/payout/types'

/**
 * modules/report/types.ts — DTOs for the four Phase 10 reports (phase brief
 * item 5). Money stays a string everywhere (CLAUDE.md invariant 2); the
 * `.xlsx` builders in `xlsx.ts` are the one place a string is turned back into
 * a numeric cell, deliberately, for Excel's own number formatting.
 */

export interface PayoutStatementReportDto {
  cycle: PayoutCycleDto | null
  rows: PayoutDto[]
}

export interface ProjectSummaryReportRow {
  projectId: string
  code: string
  name: string
  status: string
  health: string
  totalTasks: number
  completedTasks: number
  overdueTasks: number
  /** 0–100, 1dp. `0` when the project has no tasks yet. */
  completionPercent: number
}

export interface ProjectSummaryReportDto {
  rows: ProjectSummaryReportRow[]
}

export interface WorkerPerformanceReportRow {
  userId: string
  fullName: string
  username: string
  /** `null` — never scored yet (no nightly sweep has run for this worker). */
  score: string | null
  onTimeRate: string | null
  qualityScore: string | null
  volumeScore: string | null
  estimateAccuracy: string | null
  taskCount: number | null
  computedAt: Date | null
}

export interface WorkerPerformanceReportDto {
  rows: WorkerPerformanceReportRow[]
}

export interface MonthlyVirallapSummaryDto {
  from: Date
  to: Date
  completedTasks: number
  /** 0–100, 1dp. */
  onTimeRate: number
  totalPaid: string
  /** SPEC §1/R4: deductions reported as organization income, nowhere else. */
  totalDeductions: string
}
