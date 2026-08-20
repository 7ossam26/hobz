import type { Metadata } from 'next'

import { ar } from '@/i18n/ar'
import { getPasswordPolicy } from '@/lib/auth/policy'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/rbac'
import { getPenaltyProfiles } from '@/modules/penalty/queries'
import type { PenaltyProfileDto } from '@/modules/penalty/types'
import { getRoles } from '@/modules/role/queries'
import type { RoleSummaryDto } from '@/modules/role/types'
import { getUsersWithDetails } from '@/modules/user/queries'
import type { UserDetailDto } from '@/modules/user/types'

import { UsersClient } from './users-client'

export const metadata: Metadata = { title: ar.users.title }

export default async function UsersPage() {
  const actor = await requireActor()
  // `getUsers()` asserts `user.view` itself. Reaching this line without it is
  // impossible; the page never makes the decision (CLAUDE.md invariant 3).
  const page = await getUsersWithDetails({ page: 1, pageSize: 100 })

  // The role list is only needed to render the assignment checkboxes, and only
  // a user who can edit will see them. Asking for it without `role.view` would
  // throw and take the whole page down.
  const roles: RoleSummaryDto[] = can(actor, 'role.view') ? await getRoles() : []

  const detailsById = page.details.reduce<Record<string, UserDetailDto>>(
    (acc, detail) => {
      acc[detail.id] = detail
      return acc
    },
    {},
  )

  // The password minimum is a Settings value (SPEC §7), and the form needs it to
  // reject a short password with the number in the message rather than letting
  // the server reject it anonymously.
  const { minLength: minPasswordLength } = await getPasswordPolicy()

  // Same shape as `/penalties`: the organization's deduction rules are not every
  // manager's to read. Without `settings.view` the field is simply not offered,
  // and the Settings default applies — which is what the field's hint says.
  const penaltyProfiles: PenaltyProfileDto[] | null = can(actor, 'settings.view')
    ? await getPenaltyProfiles()
    : null

  return (
    <UsersClient
      users={page.items}
      roles={roles}
      detailsById={detailsById}
      currentUserId={actor.id}
      minPasswordLength={minPasswordLength}
      penaltyProfiles={penaltyProfiles}
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
