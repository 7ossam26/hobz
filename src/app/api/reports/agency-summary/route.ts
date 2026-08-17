import type { NextRequest, NextResponse } from 'next/server'

import { getMonthlyAgencySummary } from '@/modules/report/queries'
import { buildMonthlyAgencySummaryWorkbook } from '@/modules/report/xlsx'

import { reportErrorResponse, xlsxResponse } from '../respond'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const month = request.nextUrl.searchParams.get('month') ?? undefined
    const report = await getMonthlyAgencySummary(month)
    return xlsxResponse(buildMonthlyAgencySummaryWorkbook(report), 'agency-summary.xlsx')
  } catch (error) {
    return reportErrorResponse(error)
  }
}
