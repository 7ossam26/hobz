import { NextResponse } from 'next/server'

import { getImportTemplate } from '@/modules/import/queries'
import { IMPORT_ENTITIES } from '@/modules/import/schema'

// Generic `.xlsx`-download + `AppError` → `NextResponse` helpers — nothing
// about either is report-specific, and Phase 10 already built exactly what
// this route needs.
import { reportErrorResponse, xlsxResponse } from '../../../reports/respond'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entity: string }> },
): Promise<NextResponse> {
  const { entity } = await params
  if (!IMPORT_ENTITIES.includes(entity as (typeof IMPORT_ENTITIES)[number])) {
    return NextResponse.json({ error: 'errors.notFound' }, { status: 404 })
  }

  try {
    const buffer = await getImportTemplate(entity as (typeof IMPORT_ENTITIES)[number])
    return xlsxResponse(buffer, `import-template-${entity}.xlsx`)
  } catch (error) {
    return reportErrorResponse(error)
  }
}
