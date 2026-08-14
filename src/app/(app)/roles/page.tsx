import type { Metadata } from 'next'

import { ar } from '@/i18n/ar'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/rbac'
import { getPermissionGroups, getRoleById, getRoles } from '@/modules/role/queries'
import type { RoleDetailDto } from '@/modules/role/types'

import { RolesClient } from './roles-client'

export const metadata: Metadata = { title: ar.roles.title }

/**
 * A Server Component. `getRoles()` performs the `role.view` check itself — this
 * page never decides whether the data may be read, it only asks for it
 * (CLAUDE.md invariant 3). An unprivileged request throws `ForbiddenError` from
 * the query and lands on the error boundary.
 *
 * Role details are fetched here and passed down, rather than fetched from the
 * sheet on open: SPEC §9 bans client-side data waterfalls, and the whole set is
 * a handful of rows.
 */
export default async function RolesPage() {
  const actor = await requireActor()
  const [roles, groups] = await Promise.all([getRoles(), getPermissionGroups()])

  const details = await Promise.all(roles.map((role) => getRoleById(role.id)))
  const detailsById = details.reduce<Record<string, RoleDetailDto>>((acc, detail) => {
    acc[detail.id] = detail
    return acc
  }, {})

  return (
    <RolesClient
      roles={roles}
      groups={groups}
      detailsById={detailsById}
      canManage={can(actor, 'role.manage')}
    />
  )
}
