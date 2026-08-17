import { NextResponse } from 'next/server'

import { isAppError, type AppErrorCode } from '@/lib/errors'

/**
 * Shared by every `/api/reports/*` route. Not a `route.ts` itself — Next.js
 * only treats that exact filename as a route handler, so this file is a plain
 * module the five routes import.
 */

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  DOMAIN: 422,
  NOT_IMPLEMENTED: 501,
}

/**
 * The `.xlsx` bytes, as a download. `filename` is ASCII-only on purpose —
 * `Content-Disposition`'s quoted-string form is not reliably Arabic-safe
 * across browsers, and the report's own title is already inside the workbook
 * as its Arabic sheet name.
 */
export function xlsxResponse(buffer: Buffer, filename: string): NextResponse {
  // A Node `Buffer`'s `.buffer` is typed `ArrayBufferLike` (it admits
  // `SharedArrayBuffer`), which satisfies neither `BodyInit` nor `BlobPart`
  // under this TS/Node combination. Copying into a plain `Uint8Array` gives
  // one backed by a real, non-shared `ArrayBuffer`, which both accept.
  const body = new Uint8Array(buffer)
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  })
}

/**
 * Every route catches into this rather than letting Next's default error
 * page render — an export button that 500s into an HTML page is a confusing
 * download, and `report.view`'s denial should read as a real 403.
 */
export function reportErrorResponse(error: unknown): NextResponse {
  if (isAppError(error)) {
    return NextResponse.json({ error: error.messageKey }, { status: STATUS_BY_CODE[error.code] })
  }
  console.error('[api/reports] unexpected error', error)
  return NextResponse.json({ error: 'errors.unexpected' }, { status: 500 })
}
