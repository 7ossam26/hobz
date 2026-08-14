import type { Db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'

import type { AuditFilterInput } from './schema'
import type {
  AuditDiffRow,
  AuditEntryDto,
  AuditFacetsDto,
  AuditPageDto,
} from './types'

/**
 * modules/audit/service — reads only.
 *
 * There is deliberately no create, update or delete here. Rows are appended by
 * `lib/audit.recordAudit`, inside the same transaction as the change they
 * describe, and never touched again (CLAUDE.md invariant 7). A `deleteAuditLog`
 * in this file would be the bug, not the missing feature.
 */

/**
 * Africa/Cairo, fixed. Egypt reintroduced DST in 2023 (last Friday of April to
 * last Thursday of October), so the offset is +02:00 or +03:00 depending on the
 * date — which is exactly why this resolves the boundary through `Intl` against
 * the specific instant rather than adding a constant.
 */
const CAIRO = 'Africa/Cairo'

/**
 * Turn a Cairo-local `YYYY-MM-DD` into the UTC instant that begins (or ends)
 * that day.
 *
 * Written out rather than delegated to `lib/calendar` on purpose: `lib/calendar`
 * is Phase 6 and is about *working* days — weekends, holidays, leave. This is a
 * display-timezone conversion for a filter box, and coupling a log viewer to
 * the penalty engine's calendar would be the wrong dependency in the wrong
 * direction.
 */
export function cairoDayBoundary(isoDate: string, edge: 'start' | 'end'): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) throw new RangeError(`Not an ISO date: ${isoDate}`)

  const wallClock =
    edge === 'start'
      ? Date.UTC(y, m - 1, d, 0, 0, 0, 0)
      : Date.UTC(y, m - 1, d, 23, 59, 59, 999)

  // Two passes. The first uses Cairo's offset at the naive instant; the second
  // re-reads it at the corrected instant, which is what makes the answer right
  // for a day that sits on the far side of a DST transition from its own
  // midnight. Converging further is unnecessary — offsets change by an hour,
  // never by enough for a third pass to move the result.
  const firstPass = wallClock - cairoOffsetMs(new Date(wallClock))
  return new Date(wallClock - cairoOffsetMs(new Date(firstPass)))
}

/**
 * Cairo's UTC offset in milliseconds at a given instant.
 *
 * `Intl` reports whole seconds and silently drops the millisecond component of
 * `at`. Comparing its answer against the raw timestamp therefore folds those
 * milliseconds into the "offset" — which made the end-of-day boundary land at
 * 00:00:00.997 the *next* day, quietly widening every audit date filter by a
 * second. Both sides are truncated to whole seconds so only the real offset
 * survives the subtraction.
 */
function cairoOffsetMs(at: Date): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)

  const part = (type: string): number =>
    Number(formatted.find((p) => p.type === type)?.value ?? '0')

  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    // Some ICU versions render midnight as hour 24 under `hour12: false`.
    part('hour') % 24,
    part('minute'),
    part('second'),
  )
  const atWholeSeconds = Math.floor(at.getTime() / 1000) * 1000
  return asUtc - atWholeSeconds
}

const ACTOR_SELECT = { id: true, fullName: true, username: true } as const

const ENTRY_SELECT = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  before: true,
  after: true,
  reason: true,
  ip: true,
  createdAt: true,
  actor: { select: ACTOR_SELECT },
  impersonator: { select: ACTOR_SELECT },
} as const

type EntryRow = {
  id: string
  action: string
  entity: string
  entityId: string
  before: unknown
  after: unknown
  reason: string | null
  ip: string | null
  createdAt: Date
  actor: { id: string; fullName: string; username: string } | null
  impersonator: { id: string; fullName: string; username: string } | null
}

function toEntry(row: EntryRow): AuditEntryDto {
  return {
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    actor: row.actor,
    impersonator: row.impersonator,
    before: row.before,
    after: row.after,
    reason: row.reason,
    ip: row.ip,
    createdAt: row.createdAt,
  }
}

export function buildAuditWhere(input: AuditFilterInput): Record<string, unknown> {
  const createdAt: Record<string, Date> = {}
  if (input.from) createdAt.gte = cairoDayBoundary(input.from, 'start')
  if (input.to) createdAt.lte = cairoDayBoundary(input.to, 'end')

  return {
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.entity ? { entity: input.entity } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
  }
}

export async function listAuditEntries(
  db: Db,
  input: AuditFilterInput,
): Promise<AuditPageDto> {
  const where = buildAuditWhere(input)

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      select: ENTRY_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.auditLog.count({ where }),
  ])

  return {
    items: rows.map(toEntry),
    total,
    page: input.page,
    pageSize: input.pageSize,
  }
}

export async function getAuditEntry(db: Db, id: string): Promise<AuditEntryDto> {
  const row = await db.auditLog.findUnique({ where: { id }, select: ENTRY_SELECT })
  if (!row) throw new NotFoundError('AuditLog', id)
  return toEntry(row)
}

/**
 * Distinct values for the filter dropdowns.
 *
 * `distinct` over an indexed column rather than a `GROUP BY` with counts: the
 * viewer needs the options, not the histogram, and the log is the one table
 * that only ever grows.
 */
export async function auditFacets(db: Db): Promise<AuditFacetsDto> {
  const [entities, actions, actorRows] = await Promise.all([
    db.auditLog.findMany({
      distinct: ['entity'],
      select: { entity: true },
      orderBy: { entity: 'asc' },
      take: 100,
    }),
    db.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200,
    }),
    db.user.findMany({
      where: { auditEvents: { some: {} } },
      select: ACTOR_SELECT,
      orderBy: { fullName: 'asc' },
      take: 200,
    }),
  ])

  return {
    actors: actorRows,
    entities: entities.map((e) => e.entity),
    actions: actions.map((a) => a.action),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The diff view
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Structural equality, good enough for the JSON shapes `recordAudit` writes. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((k) => sameValue(a[k], b[k]))
  }
  return false
}

/**
 * Field-by-field difference between an entry's `before` and `after`.
 *
 * Only changed fields are returned. An audit row for "edited a user" typically
 * carries a dozen unchanged fields alongside the one that moved, and a viewer
 * that renders all twelve makes the reader hunt for the change — which defeats
 * the purpose of having the log at all.
 */
export function diffAuditEntry(entry: {
  before: unknown
  after: unknown
}): AuditDiffRow[] {
  const before = isPlainObject(entry.before) ? entry.before : {}
  const after = isPlainObject(entry.after) ? entry.after : {}

  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  const rows: AuditDiffRow[] = []

  for (const field of fields) {
    const hadBefore = field in before
    const hasAfter = field in after
    const b = before[field]
    const a = after[field]

    if (hadBefore && hasAfter) {
      if (!sameValue(b, a)) rows.push({ field, kind: 'changed', before: b, after: a })
    } else if (hasAfter) {
      rows.push({ field, kind: 'added', before: undefined, after: a })
    } else {
      rows.push({ field, kind: 'removed', before: b, after: undefined })
    }
  }

  return rows
}
