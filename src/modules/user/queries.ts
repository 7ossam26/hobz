import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { assertCan } from '@/lib/rbac'

import { listUsersSchema, type ListUsersInput } from './schema'
import { getUser, listUsers } from './service'
import type { UserDetailDto, UserPageDto } from './types'

/**
 * Read paths for users, permission-checked here rather than in the page
 * (CLAUDE.md invariant 3).
 *
 * There is no `user.view.assigned` in the SPEC §6 catalog — `user.view` is
 * all-or-nothing — so there is no row-level scope helper to spread in. Soft
 * delete is still filtered in the service's `where`, on every path.
 */

export async function getUsers(raw: Partial<ListUsersInput> = {}): Promise<UserPageDto> {
  const actor = await requireActor()
  assertCan(actor, 'user.view')
  return listUsers(prisma, listUsersSchema.parse(raw))
}

export async function getUserById(id: string): Promise<UserDetailDto> {
  const actor = await requireActor()
  assertCan(actor, 'user.view')
  return getUser(prisma, id)
}

/**
 * The signed-in user's own profile. Deliberately ungated: reading your own
 * record is not a privilege, and requiring `user.view` for it would mean a
 * worker cannot see their own name in the header.
 */
export async function getOwnProfile(): Promise<UserDetailDto> {
  const actor = await requireActor()
  return getUser(prisma, actor.id)
}
