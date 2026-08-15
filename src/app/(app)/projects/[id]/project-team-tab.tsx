'use client'

import { UserMinus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Chip } from '@/components/data/chip'
import { UserChip } from '@/components/data/user-chip'
import { EmptyState } from '@/components/shared/empty-state'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import { projectMemberRoleHue } from '@/lib/palette'
import {
  addProjectMemberAction,
  removeProjectMemberAction,
  updateProjectMemberRoleAction,
} from '@/modules/project/actions'
import type { ProjectMemberRoleInput } from '@/modules/project/schema'
import type { ProjectDetailDto } from '@/modules/project/types'

const MEMBER_ROLES: ProjectMemberRoleInput[] = ['MANAGER', 'CONTRIBUTOR', 'VIEWER']

export function ProjectTeamTab({
  project,
  userOptions,
  canEdit,
}: {
  project: ProjectDetailDto
  userOptions: Array<{ id: string; fullName: string; username: string }>
  canEdit: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [addingUserId, setAddingUserId] = React.useState('')
  const [addingRole, setAddingRole] =
    React.useState<ProjectMemberRoleInput>('CONTRIBUTOR')

  const memberIds = new Set(project.members.map((m) => m.userId))
  const available = userOptions.filter(
    (u) => !memberIds.has(u.id) && u.id !== project.owner.id,
  )

  function addMember() {
    if (!addingUserId) return
    startTransition(async () => {
      try {
        await addProjectMemberAction({
          projectId: project.id,
          userId: addingUserId,
          role: addingRole,
        })
        toast({ title: ar.common.saved, tone: 'success' })
        setAddingUserId('')
        router.refresh()
      } catch {
        toast({ title: ar.projects.team.alreadyMember, tone: 'error' })
      }
    })
  }

  function changeRole(userId: string, role: ProjectMemberRoleInput) {
    startTransition(async () => {
      try {
        await updateProjectMemberRoleAction({ projectId: project.id, userId, role })
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  function remove(userId: string) {
    startTransition(async () => {
      try {
        await removeProjectMemberAction({ projectId: project.id, userId })
        toast({ title: ar.common.saved, tone: 'success' })
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{ar.projects.team.title}</h3>
        <UserChip user={project.owner} size="sm" showWhatsapp={false} />
      </div>

      {project.members.length === 0 ? (
        <EmptyState title={ar.projects.team.empty} className="py-8" />
      ) : (
        <ul className="flex flex-col gap-2">
          {project.members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-2 rounded-md border p-2"
            >
              <UserChip user={{ ...member, id: member.userId }} size="sm" />
              <div className="flex items-center gap-2">
                {canEdit ? (
                  <Select
                    aria-label={ar.projects.team.role}
                    value={member.role}
                    disabled={pending}
                    onChange={(e) =>
                      changeRole(member.userId, e.target.value as ProjectMemberRoleInput)
                    }
                    className="h-8 w-32 text-xs"
                  >
                    {MEMBER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ar.enums.projectMemberRole[role]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Chip hue={projectMemberRoleHue(member.role)} size="sm">
                    {ar.enums.projectMemberRole[member.role]}
                  </Chip>
                )}
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    aria-label={ar.projects.team.removeMember}
                    title={ar.projects.team.removeMember}
                    onClick={() => remove(member.userId)}
                  >
                    <UserMinus />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="flex items-end gap-2 border-t pt-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium">
              {ar.projects.team.selectUser}
            </label>
            <Select
              value={addingUserId}
              onChange={(e) => setAddingUserId(e.target.value)}
            >
              <option value="">{ar.common.select}</option>
              {available.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-36">
            <label className="mb-1.5 block text-xs font-medium">
              {ar.projects.team.role}
            </label>
            <Select
              value={addingRole}
              onChange={(e) => setAddingRole(e.target.value as ProjectMemberRoleInput)}
            >
              {MEMBER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ar.enums.projectMemberRole[role]}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={addMember} disabled={pending || !addingUserId}>
            {ar.projects.team.addMember}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
