import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { scopeTasks } from '@/lib/rbac'

import { listExtensionsSchema, type ListExtensionsInput } from './schema'
import { listExtensions } from './service'
import type { ExtensionPageDto } from './types'

/**
 * Extension requests are visible exactly where their task is (CLAUDE.md
 * invariant 3): the scope comes from `scopeTasks`, so a منفّذ sees the
 * requests on their own tasks and nobody else's, by the same rule that decides
 * whether they can open the task at all.
 */
export async function getExtensionList(raw: unknown): Promise<ExtensionPageDto> {
  const actor = await requireActor()
  const filters: ListExtensionsInput = listExtensionsSchema.parse(raw ?? {})
  return listExtensions(prisma, { filters, taskScope: scopeTasks(actor) })
}
