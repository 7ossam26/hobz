import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/rbac'
import { getRoles } from '@/modules/role/queries'
import { getUsers } from '@/modules/user/queries'

import type { CommandDirectory } from './types'

/**
 * The command palette's dataset.
 *
 * ## Why the whole directory rather than a query per keystroke
 *
 * SPEC §2 caps this product at ~100 users, and roles are a handful. The entire
 * searchable directory is a few kilobytes, so it is fetched **once** when the
 * palette first opens and every keystroke after that is matched in the browser
 * by `lib/search`.
 *
 * That is not a shortcut, it is the only way the Arabic matching can work at
 * all. `أحمد` and `احمد` are different strings to Postgres; finding one by
 * typing the other needs the fold table in `lib/search`, and running it inside
 * a `WHERE` clause would mean either a normalised shadow column on every
 * searchable field or a full scan per keystroke. At this scale, sending 100
 * names to the client once is smaller than either.
 *
 * ## Permissions
 *
 * Checked here, server-side, before anything is read (CLAUDE.md invariant 3).
 * `can()` is consulted *before* calling each query rather than catching the
 * `ForbiddenError` it would throw: a palette must degrade to fewer groups for a
 * worker, not fail.
 */
export async function getCommandDirectory(): Promise<CommandDirectory> {
  const actor = await requireActor()

  const [users, roles] = await Promise.all([
    can(actor, 'user.view')
      ? getUsers({ page: 1, pageSize: 100 }).then((page) => page.items)
      : Promise.resolve([]),
    can(actor, 'role.view') ? getRoles() : Promise.resolve([]),
  ])

  return {
    users: users.map((user) => ({
      kind: 'user' as const,
      id: user.id,
      label: user.fullName,
      sublabel: user.username,
      keywords: user.roles.map((role) => role.nameAr),
      // Deep-linking into an entity's sheet arrives with the first module that
      // has one to open (Phase 3). Until then the palette lands on the list
      // with the person already filtered in, which is one keystroke away from
      // the same result and never a dead link.
      href: `/users?q=${encodeURIComponent(user.username)}`,
    })),
    roles: roles.map((role) => ({
      kind: 'role' as const,
      id: role.id,
      label: role.nameAr,
      sublabel: role.nameEn,
      href: '/roles',
    })),
  }
}
