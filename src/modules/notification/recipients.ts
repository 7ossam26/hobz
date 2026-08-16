import type { Db } from '@/lib/db'
import { SUPER_ADMIN_ROLE, type Permission } from '@/lib/rbac'

/**
 * modules/notification/recipients.ts — turning an event's *subject* (a task,
 * a project) into the set of people who should hear about it.
 *
 * **A decision made on your behalf, flagged per CLAUDE.md.** Neither SPEC §8
 * nor the permission catalog (SPEC §6) names a "manager" role — §8 only says
 * managers get the daily digest and, per the phase brief, task escalation at
 * ADMIN level. This module reads "manager" as *whoever holds
 * `project.view.all`* — the one permission that means "sees the whole
 * agency's work", which is exactly the audience a digest of overdue tasks,
 * approvals and at-risk projects is for. Override in `docs/SPEC.md` §8 if the
 * agency wants a narrower or role-based definition instead.
 */

/** Active, non-deleted users holding `permission` — directly, or via SUPER_ADMIN. */
export async function usersWithPermission(
  db: Db,
  permission: Permission,
): Promise<string[]> {
  const rows = await db.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      roles: {
        some: {
          role: {
            deletedAt: null,
            OR: [
              { nameEn: SUPER_ADMIN_ROLE },
              { permissions: { some: { permissionKey: permission } } },
            ],
          },
        },
      },
    },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/** SPEC §8's daily-digest and ADMIN-escalation audience. */
export async function managerIds(db: Db): Promise<string[]> {
  return usersWithPermission(db, 'project.view.all')
}

/**
 * The project's owner — the PM-level escalation and submission/extension
 * audience. `null` when the owner has left: a soft-deleted or deactivated
 * user is excluded here for the same reason `usersWithPermission` excludes
 * one from the manager set above — a departed employee's inbox is not where
 * a live project's notifications should keep landing. The project itself
 * still names them as owner (that is historical fact); only *new*
 * notifications stop reaching an account nobody can act from.
 */
export async function projectOwnerId(db: Db, projectId: string): Promise<string | null> {
  const project = await db.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      owner: { deletedAt: null, isActive: true },
    },
    select: { ownerId: true },
  })
  return project?.ownerId ?? null
}

/** Every watcher on a task (SPEC §8: watchers "are notified about it"). */
export async function taskWatcherIds(db: Db, taskId: string): Promise<string[]> {
  const rows = await db.taskWatcher.findMany({ where: { taskId }, select: { userId: true } })
  return rows.map((r) => r.userId)
}

/** De-duplicate and drop `null`/the actor who caused the event. */
export function recipientSet(
  ids: ReadonlyArray<string | null | undefined>,
  exclude?: string | null,
): string[] {
  const set = new Set<string>()
  for (const id of ids) {
    if (id && id !== exclude) set.add(id)
  }
  return [...set]
}
