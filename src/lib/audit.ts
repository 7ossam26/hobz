import type { Db } from '@/lib/db'
import type { Actor } from '@/lib/rbac'

/**
 * lib/audit — CLAUDE.md invariant 7: everything that touches money, permissions,
 * assignment, or status writes an audit row.
 *
 * Writes take the caller's `Db`, which may be a transaction client. That is the
 * point: the audit row and the change it describes commit together or not at all.
 */

/** Verb-ish, dot-namespaced, past tense: `user.created`, `penalty.reversed`. */
export type AuditAction = string

/**
 * Everything the writer needs from an identity. Structurally satisfied by
 * `Actor`, but deliberately narrower so that a caller holding only a user row —
 * the credentials provider, which has no session yet — can still write a row.
 */
export type AuditActorRef = Pick<Actor, 'id'> & { impersonatorId?: string }

export interface AuditInput {
  /** Null for scheduler/system actions. */
  actor: AuditActorRef | null
  action: AuditAction
  entity: string
  entityId: string
  before?: unknown
  after?: unknown
  reason?: string
  ip?: string
}

/**
 * Values that must never reach the audit table even if a caller passes a whole
 * entity through. Redacted rather than rejected, so adding a sensitive field to
 * a model can't retroactively turn an audit write into a leak.
 */
const REDACTED_FIELDS = new Set(['passwordHash', 'password', 'token', 'secret'])
const REDACTED = '[redacted]'

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redact)
  if (value instanceof Date) return value.toISOString()

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_FIELDS.has(key) ? REDACTED : redact(v)
  }
  return out
}

/**
 * Append one audit row. There is no update or delete counterpart, by design.
 *
 * When a SUPER_ADMIN is impersonating, the acting identity is recorded as the
 * impersonated user and the real identity lands in `impersonatorId`, so the
 * viewer can show "root acting as ahmed" and both people are answerable for the
 * change (SPEC Phase 1 §5).
 */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actor?.id ?? null,
      impersonatorId: input.actor?.impersonatorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: input.before === undefined ? undefined : (redact(input.before) as never),
      after: input.after === undefined ? undefined : (redact(input.after) as never),
      reason: input.reason ?? null,
      ip: input.ip ?? null,
    },
  })
}
