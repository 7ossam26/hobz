import type { NextResponse } from 'next/server'

import {
  assertCanExportReports,
  getWorkerPerformanceReport,
} from '@/modules/report/queries'
import { buildWorkerPerformanceWorkbook } from '@/modules/report/xlsx'

import { reportErrorResponse, xlsxResponse } from '../respond'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  try {
    await assertCanExportReports()
    const report = await getWorkerPerformanceReport()
    return xlsxResponse(buildWorkerPerformanceWorkbook(report), 'worker-performance.xlsx')
  } catch (error) {
    return reportErrorResponse(error)
  }
}
