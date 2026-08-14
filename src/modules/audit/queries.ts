import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { assertCan } from '@/lib/rbac'

import { auditFilterSchema, type AuditFilterInput } from './schema'
import { auditFacets, getAuditEntry, listAuditEntries } from './service'
import type { AuditEntryDto, AuditFacetsDto, AuditPageDto } from './types'

/**
 * The audit log is the record of who did what to whose money. `audit.view` is
 * checked on every read path here, including the facets — the list of who has
 * ever acted in the system is itself information an unprivileged user should
 * not be able to enumerate.
 */

export async function getAuditEntries(
  raw: Partial<AuditFilterInput> = {},
): Promise<AuditPageDto> {
  const actor = await requireActor()
  assertCan(actor, 'audit.view')
  return listAuditEntries(prisma, auditFilterSchema.parse(raw))
}

export async function getAuditEntryById(id: string): Promise<AuditEntryDto> {
  const actor = await requireActor()
  assertCan(actor, 'audit.view')
  return getAuditEntry(prisma, id)
}

export async function getAuditFacets(): Promise<AuditFacetsDto> {
  const actor = await requireActor()
  assertCan(actor, 'audit.view')
  return auditFacets(prisma)
}
