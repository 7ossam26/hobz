import type { NextRequest, NextResponse } from 'next/server'

import { getDeductionsReport } from '@/modules/penalty/queries'
import { buildDeductionsWorkbook } from '@/modules/report/xlsx'

import { reportErrorResponse, xlsxResponse } from '../respond'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** SPEC R4's report — see `src/app/(app)/penalties/report/page.tsx` for the same defaults. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const params = request.nextUrl.searchParams
    const now = new Date()
    const groupBy = params.get('groupBy') ?? 'month'
    const to = params.get('to') ?? new Date(now.getTime() + 86_400_000).toISOString()
    const from =
      params.get('from') ??
      new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)).toISOString()

    const report = await getDeductionsReport({ from, to, groupBy })
    return xlsxResponse(buildDeductionsWorkbook(report), 'deductions.xlsx')
  } catch (error) {
    return reportErrorResponse(error)
  }
}
