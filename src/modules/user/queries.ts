import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { assertCan, can } from '@/lib/rbac'
import { activeHoursByUserId } from '@/modules/workload/queries'
import { computeUtilisation } from '@/modules/workload/service'

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

export interface UserOptionDto {
  id: string
  fullName: string
  username: string
  /**
   * Workload/capacity (phase brief §"Workload/capacity"): utilisation from
   * their *currently* active tasks, before whichever assignment this picker is
   * for. Carried on the option itself — rather than fetched separately by
   * every screen that assigns work — so the over-capacity warning on the
   * assignment screen needs no extra round trip per selection.
   */
  utilisationPercent: number
  overCapacity: boolean
}

/**
 * The lean picker list a project's owner/team fields need. Mirrors the
 * command palette's "the whole directory, once" reasoning
 * (`modules/search/queries.ts`, SPEC §2's ~100-user cap) but degrades instead
 * of dead-ending: a `project.create` holder without `user.view` can still
 * always name *themselves* the owner — the alternative is a required field
 * with nothing to put in it.
 */
export async function getUserOptions(): Promise<UserOptionDto[]> {
  const actor = await requireActor()

  if (!can(actor, 'user.view')) {
    const activeHours = await activeHoursByUserId(prisma, [actor.id])
    return [
      {
        id: actor.id,
        fullName: actor.fullName,
        username: actor.username,
        ...computeUtilisation({
          activeEstimatedHours: activeHours.get(actor.id) ?? 0,
          // Not on the resolved `Actor` — a capacity-less fallback (no
          // over-capacity warning for a self-assignment) beats a second query
          // for the one caller that reaches this branch.
          weeklyCapacityHours: 40,
        }),
      },
    ]
  }

  // A direct, minimal select rather than `listUsers` (which pages, and whose
  // `UserSummaryDto` does not carry `weeklyCapacityHours` — a detail-only
  // field the list screen has no column for). `take: 100` mirrors the
  // pre-Phase-10 pageSize-100 read this replaces, at SPEC §2's ~100-user cap.
  const users = await prisma.user.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, fullName: true, username: true, weeklyCapacityHours: true },
    orderBy: { fullName: 'asc' },
    take: 100,
  })
  const activeHours = await activeHoursByUserId(
    prisma,
    users.map((user) => user.id),
  )

  return users.map((user) => ({
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    ...computeUtilisation({
      activeEstimatedHours: activeHours.get(user.id) ?? 0,
      weeklyCapacityHours: user.weeklyCapacityHours,
    }),
  }))
}
