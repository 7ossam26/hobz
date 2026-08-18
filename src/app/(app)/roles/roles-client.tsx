'use client'

import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { EmptyState } from '@/components/shared/empty-state'
import { FormField } from '@/components/shared/form-field'
import { Sheet } from '@/components/shared/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import {
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
} from '@/modules/role/actions'
import { createRoleSchema, updateRoleSchema } from '@/modules/role/schema'
import type {
  PermissionGroupDto,
  RoleDetailDto,
  RoleSummaryDto,
} from '@/modules/role/types'

/**
 * The role editor.
 *
 * Two things it will not let you do, both enforced again server-side:
 * touch `SUPER_ADMIN`, and delete a role somebody still holds. The disabled
 * button is the courtesy; `assertMutable` and the member count in
 * `modules/role/service.ts` are the enforcement (CLAUDE.md invariant 3).
 */

interface Props {
  roles: RoleSummaryDto[]
  groups: PermissionGroupDto[]
  canManage: boolean
  detailsById: Record<string, RoleDetailDto>
}

type Draft = {
  id?: string
  nameAr: string
  nameEn: string
  description: string
  permissions: Set<string>
}

const emptyDraft = (): Draft => ({
  nameAr: '',
  nameEn: '',
  description: '',
  permissions: new Set(),
})

export function RolesClient({ roles, groups, canManage, detailsById }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  function openCreate() {
    setError(null)
    setDraft(emptyDraft())
  }

  function openEdit(role: RoleSummaryDto) {
    setError(null)
    const detail = detailsById[role.id]
    setDraft({
      id: role.id,
      nameAr: role.nameAr,
      nameEn: role.nameEn,
      description: role.description ?? '',
      permissions: new Set(detail?.permissions ?? []),
    })
  }

  function togglePermission(key: string, checked: boolean) {
    setDraft((current) => {
      if (!current) return current
      const next = new Set(current.permissions)
      if (checked) next.add(key)
      else next.delete(key)
      return { ...current, permissions: next }
    })
  }

  function toggleDomain(keys: string[], checked: boolean) {
    setDraft((current) => {
      if (!current) return current
      const next = new Set(current.permissions)
      for (const key of keys) {
        if (checked) next.add(key)
        else next.delete(key)
      }
      return { ...current, permissions: next }
    })
  }

  function save() {
    if (!draft) return
    setError(null)

    const base = {
      nameAr: draft.nameAr,
      description: draft.description,
      permissions: [...draft.permissions],
    }
    const payload = draft.id
      ? { ...base, id: draft.id }
      : { ...base, nameEn: draft.nameEn }

    // The same schema the action parses (SPEC §3). Validating here is what puts
    // "المعرّف الإنجليزي بحروف لاتينية كبيرة وشرطة سفلية فقط" on screen — an
    // AppError thrown across the RSC boundary loses its message in production.
    // The server parses it again, and that is the check that counts.
    const parsed = draft.id
      ? updateRoleSchema.safeParse(payload)
      : createRoleSchema.safeParse(payload)

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        if (draft.id) await updateRoleAction(payload)
        else await createRoleAction(payload)
        setDraft(null)
        router.refresh()
      } catch {
        setError(ar.errors.unexpected)
      }
    })
  }

  function remove(role: RoleSummaryDto) {
    setError(null)
    startTransition(async () => {
      try {
        await deleteRoleAction({ id: role.id })
        router.refresh()
      } catch {
        setError(ar.roles.inUse)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{ar.roles.title}</h1>
          <p className="text-muted-foreground text-sm">{ar.roles.permissions}</p>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus />
            {ar.roles.create}
          </Button>
        ) : null}
      </header>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      {roles.length === 0 ? (
        <EmptyState
          title={ar.roles.empty}
          action={
            canManage ? (
              <Button onClick={openCreate}>{ar.roles.emptyAction}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{ar.roles.nameAr}</TableHead>
                <TableHead>{ar.roles.nameEn}</TableHead>
                <TableHead>{ar.roles.permissionCount}</TableHead>
                <TableHead>{ar.roles.memberCount}</TableHead>
                <TableHead className="w-24">{ar.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {role.nameAr}
                      {role.isSystem ? (
                        <Badge variant="accent">
                          <Lock className="size-3" aria-hidden />
                          {ar.roles.systemRole}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground font-mono text-xs"
                    dir="ltr"
                  >
                    {role.nameEn}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {role.permissionCount === null ? (
                      <span className="text-muted-foreground text-xs">
                        {ar.roles.superAdminImplicit}
                      </span>
                    ) : (
                      role.permissionCount
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{role.memberCount}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!canManage || role.isSystem}
                        title={role.isSystem ? ar.roles.systemRoleLocked : ar.common.edit}
                        aria-label={ar.common.edit}
                        onClick={() => openEdit(role)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!canManage || role.isSystem || role.memberCount > 0}
                        title={
                          role.isSystem
                            ? ar.roles.systemRoleLocked
                            : role.memberCount > 0
                              ? ar.roles.inUse
                              : ar.common.delete
                        }
                        aria-label={ar.common.delete}
                        onClick={() => remove(role)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? ar.roles.edit : ar.roles.create}
        description={ar.roles.permissions}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              {ar.common.cancel}
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? ar.common.saving : ar.common.save}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            <FormField name="nameAr" label={ar.roles.nameAr} required>
              {(field) => (
                <Input
                  {...field}
                  value={draft.nameAr}
                  onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
                />
              )}
            </FormField>

            <FormField
              name="nameEn"
              label={ar.roles.nameEn}
              hint={ar.roles.nameEnHint}
              required
            >
              {(field) => (
                <Input
                  {...field}
                  value={draft.nameEn}
                  dir="ltr"
                  className="text-start font-mono"
                  // Immutable after creation: it is the identifier the audit
                  // history is written against.
                  disabled={Boolean(draft.id)}
                  onChange={(e) =>
                    setDraft({ ...draft, nameEn: e.target.value.toUpperCase() })
                  }
                />
              )}
            </FormField>

            <FormField name="description" label={ar.roles.description}>
              {(field) => (
                <Textarea
                  {...field}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              )}
            </FormField>

            <fieldset className="flex flex-col gap-4">
              <legend className="pb-2 text-sm font-medium">{ar.roles.permissions}</legend>

              {groups.map((group) => {
                const keys = group.permissions.map((p) => p.key)
                const allChecked = keys.every((k) => draft.permissions.has(k))

                return (
                  <div
                    key={group.domain}
                    className="flex flex-col gap-2 rounded-md border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{group.labelAr}</span>
                      <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={allChecked}
                          onChange={(e) => toggleDomain(keys, e.target.checked)}
                        />
                        {ar.common.selectAll}
                      </label>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {group.permissions.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex items-start gap-2 text-sm"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={draft.permissions.has(permission.key)}
                            onChange={(e) =>
                              togglePermission(permission.key, e.target.checked)
                            }
                          />
                          <span className="flex flex-col">
                            <span>{permission.descriptionAr}</span>
                            <span
                              className="text-muted-foreground font-mono text-[11px]"
                              dir="ltr"
                            >
                              {permission.key}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </fieldset>
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}
