import type { NextResponse } from 'next/server'

import { getProjectSummaryReport } from '@/modules/report/queries'
import { buildProjectSummaryWorkbook } from '@/modules/report/xlsx'

import { reportErrorResponse, xlsxResponse } from '../respond'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  try {
    const report = await getProjectSummaryReport()
    return xlsxResponse(buildProjectSummaryWorkbook(report), 'project-summary.xlsx')
  } catch (error) {
    return reportErrorResponse(error)
  }
}
