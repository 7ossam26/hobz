import type { NextRequest, NextResponse } from 'next/server'

import {
  assertCanExportReports,
  getMonthlyVirallapSummary,
} from '@/modules/report/queries'
import { buildMonthlyVirallapSummaryWorkbook } from '@/modules/report/xlsx'

import { reportErrorResponse, xlsxResponse } from '../respond'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await assertCanExportReports()
    const month = request.nextUrl.searchParams.get('month') ?? undefined
    const report = await getMonthlyVirallapSummary(month)
    return xlsxResponse(
      buildMonthlyVirallapSummaryWorkbook(report),
      'virallap-summary.xlsx',
    )
  } catch (error) {
    return reportErrorResponse(error)
  }
}
