import { NotImplementedError, UnauthenticatedError } from '@/lib/errors'
import type { Actor } from '@/lib/rbac'

/**
 * lib/auth — Auth.js v5 Credentials provider lands in Phase 1.
 *
 * Phase 0 fixes only the seam every server action opens with:
 *
 *   const actor = await requireActor()   // session
 *   assertCan(actor, 'settings.edit')    // permission
 *   const input = schema.parse(raw)      // zod
 *   await service.update(prisma, ...)    // service
 *
 * Stubbed loudly rather than returning a fake super-admin: a permissive stub
 * here would make every permission test in Phase 1 pass for the wrong reason.
 */

export async function getActor(): Promise<Actor | null> {
  throw new NotImplementedError('auth.getActor', 'Phase 1')
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) throw new UnauthenticatedError()
  return actor
}
