import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Container healthcheck for Docker/Dokploy. Touches the database, because an
 * app process that cannot reach Postgres is not healthy however well it serves
 * HTML. Returns no schema or version detail — it is reachable unauthenticated.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch {
    return NextResponse.json({ status: 'degraded' }, { status: 503 })
  }
}
