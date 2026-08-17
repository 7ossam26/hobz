import type { NextRequest, NextResponse } from 'next/server'

import { getPayoutStatementReport } from '@/modules/report/queries'
import { buildPayoutStatementWorkbook } from '@/modules/report/xlsx'

import { reportErrorResponse, xlsxResponse } from '../respond'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const cycleId = request.nextUrl.searchParams.get('cycleId') ?? undefined
    const report = await getPayoutStatementReport(cycleId)
    return xlsxResponse(buildPayoutStatementWorkbook(report), 'payout-statement.xlsx')
  } catch (error) {
    return reportErrorResponse(error)
  }
}
