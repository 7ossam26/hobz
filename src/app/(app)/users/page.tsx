import type { Metadata } from 'next'

import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/rbac'
import { getRoles } from '@/modules/role/queries'
import type { RoleSummaryDto } from '@/modules/role/types'
import { getUserById, getUsers } from '@/modules/user/queries'
import type { UserDetailDto } from '@/modules/user/types'

import { UsersClient } from './users-client'

export const metadata: Metadata = { title: ar.users.title }

export default async function UsersPage() {
  const actor = await requireActor()
  // `getUsers()` asserts `user.view` itself. Reaching this line without it is
  // impossible; the page never makes the decision (CLAUDE.md invariant 3).
  const page = await getUsers({ page: 1, pageSize: 100 })

  // The role list is only needed to render the assignment checkboxes, and only
  // a user who can edit will see them. Asking for it without `role.view` would
  // throw and take the whole page down.
  const roles: RoleSummaryDto[] = can(actor, 'role.view') ? await getRoles() : []

  const details = await Promise.all(page.items.map((user) => getUserById(user.id)))
  const detailsById = details.reduce<Record<string, UserDetailDto>>((acc, detail) => {
    acc[detail.id] = detail
    return acc
  }, {})

  return (
    <UsersClient
      users={page.items}
      roles={roles}
      detailsById={detailsById}
      currentUserId={actor.id}
      permissions={{
        create: can(actor, 'user.create'),
        edit: can(actor, 'user.edit'),
        deactivate: can(actor, 'user.deactivate'),
        resetPassword: can(actor, 'user.resetPassword'),
        // SUPER_ADMIN only, per the phase brief — the permission alone is not
        // enough, and the action re-checks both.
        impersonate: actor.isSuperAdmin && can(actor, 'user.impersonate'),
      }}
    />
  )
}
