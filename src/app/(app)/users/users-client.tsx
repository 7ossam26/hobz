'use client'

import { Eye, KeyRound, Pencil, Plus, Power, PowerOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { EmptyState } from '@/components/shared/empty-state'
import { FormField } from '@/components/shared/form-field'
import { Sheet } from '@/components/shared/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ar } from '@/i18n/ar'
import { formatMobileForDisplay } from '@/lib/phone'
import { startImpersonationAction } from '@/modules/impersonation/actions'
import type { RoleSummaryDto } from '@/modules/role/types'
import {
  activateUserAction,
  createUserAction,
  deactivateUserAction,
  resetUserPasswordAction,
  updateUserAction,
} from '@/modules/user/actions'
import { createUserSchema, updateUserSchema } from '@/modules/user/schema'
import type { UserDetailDto, UserSummaryDto } from '@/modules/user/types'

interface Props {
  users: UserSummaryDto[]
  roles: RoleSummaryDto[]
  detailsById: Record<string, UserDetailDto>
  currentUserId: string
  permissions: {
    create: boolean
    edit: boolean
    deactivate: boolean
    resetPassword: boolean
    impersonate: boolean
  }
}

type Draft = {
  id?: string
  username: string
  password: string
  fullName: string
  phone: string
  isWorker: boolean
  payType: 'SALARY' | 'PER_TASK' | 'HYBRID'
  monthlySalary: string
  defaultTaskRate: string
  weeklyCapacityHours: string
  penaltyProfileId: string
  roles: Set<string>
}

const emptyDraft = (): Draft => ({
  username: '',
  password: '',
  fullName: '',
  phone: '',
  isWorker: true,
  payType: 'PER_TASK',
  monthlySalary: '',
  defaultTaskRate: '',
  weeklyCapacityHours: '40',
  penaltyProfileId: '',
  roles: new Set(),
})

export function UsersClient({
  users,
  roles,
  detailsById,
  currentUserId,
  permissions,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [resetFor, setResetFor] = useState<UserSummaryDto | null>(null)
  const [resetValue, setResetValue] = useState('')
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'ok' } | null>(
    null,
  )

  function fail(text: string) {
    setMessage({ text, tone: 'error' })
  }

  function openCreate() {
    setMessage(null)
    setDraft(emptyDraft())
  }

  function openEdit(user: UserSummaryDto) {
    setMessage(null)
    const detail = detailsById[user.id]
    setDraft({
      id: user.id,
      username: user.username,
      password: '',
      fullName: user.fullName,
      phone: user.phone ?? '',
      isWorker: user.isWorker,
      payType: user.payType,
      monthlySalary: detail?.monthlySalary ?? '',
      defaultTaskRate: detail?.defaultTaskRate ?? '',
      weeklyCapacityHours: String(detail?.weeklyCapacityHours ?? 40),
      penaltyProfileId: detail?.penaltyProfileId ?? '',
      roles: new Set(user.roles.map((r) => r.id)),
    })
  }

  function save() {
    if (!draft) return
    setMessage(null)

    const shared = {
      fullName: draft.fullName,
      phone: draft.phone,
      isWorker: draft.isWorker,
      payType: draft.payType,
      monthlySalary: draft.monthlySalary,
      defaultTaskRate: draft.defaultTaskRate,
      weeklyCapacityHours: Number(draft.weeklyCapacityHours),
      penaltyProfileId: draft.penaltyProfileId,
      roles: [...draft.roles],
    }

    const payload = draft.id
      ? { ...shared, id: draft.id }
      : { ...shared, username: draft.username, password: draft.password }

    // The same Zod schema the action parses (SPEC §3: "one schema per input,
    // shared between the server action and the form"). Running it here is what
    // turns "الراتب الشهري مطلوب لهذا النوع من الأجر" into a message on the
    // field instead of a generic failure — an action that throws across the RSC
    // boundary arrives with its message stripped in production.
    //
    // The server parses it again. That is the check that counts; this one is
    // for the human.
    const parsed = draft.id
      ? updateUserSchema.safeParse(payload)
      : createUserSchema.safeParse(payload)

    if (!parsed.success) {
      fail(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        if (draft.id) await updateUserAction(payload)
        else await createUserAction(payload)
        setDraft(null)
        router.refresh()
      } catch {
        fail(ar.errors.unexpected)
      }
    })
  }

  function toggleActive(user: UserSummaryDto) {
    setMessage(null)
    startTransition(async () => {
      try {
        if (user.isActive) await deactivateUserAction({ id: user.id })
        else await activateUserAction({ id: user.id })
        router.refresh()
      } catch {
        // The most likely reason by far, and the one the phase brief names:
        // the account still owns open work.
        fail(user.isActive ? ar.users.hasOpenTasks : ar.errors.unexpected)
      }
    })
  }

  function submitReset() {
    if (!resetFor) return
    setMessage(null)
    startTransition(async () => {
      try {
        await resetUserPasswordAction({ id: resetFor.id, newPassword: resetValue })
        setResetFor(null)
        setResetValue('')
        setMessage({ text: ar.users.passwordReset, tone: 'ok' })
        router.refresh()
      } catch {
        fail(ar.errors.unexpected)
      }
    })
  }

  function impersonate(user: UserSummaryDto) {
    setMessage(null)
    startTransition(async () => {
      try {
        await startImpersonationAction({ userId: user.id })
        router.push('/dashboard')
        router.refresh()
      } catch {
        fail(ar.impersonation.notAllowed)
      }
    })
  }

  const needsSalary = draft?.payType === 'SALARY' || draft?.payType === 'HYBRID'
  const needsRate = draft?.payType === 'PER_TASK' || draft?.payType === 'HYBRID'

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{ar.users.title}</h1>
          <p className="text-muted-foreground text-sm">{ar.auth.noSelfSignup}</p>
        </div>
        {permissions.create ? (
          <Button onClick={openCreate}>
            <Plus />
            {ar.users.create}
          </Button>
        ) : null}
      </header>

      {message ? (
        <p
          role="alert"
          className={
            message.tone === 'error'
              ? 'bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm'
              : 'rounded-md bg-emerald-100 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
          }
        >
          {message.text}
        </p>
      ) : null}

      {users.length === 0 ? (
        <EmptyState
          title={ar.users.empty}
          action={
            permissions.create ? (
              <Button onClick={openCreate}>{ar.users.emptyAction}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{ar.users.fullName}</TableHead>
                <TableHead>{ar.auth.username}</TableHead>
                <TableHead>{ar.users.phone}</TableHead>
                <TableHead>{ar.users.roles}</TableHead>
                <TableHead>{ar.users.status}</TableHead>
                <TableHead className="w-36">{ar.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {user.fullName}
                      {user.isWorker ? (
                        <Badge variant="outline">{ar.users.isWorker}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground font-mono text-xs"
                    dir="ltr"
                  >
                    {user.username}
                  </TableCell>
                  <TableCell className="tabular-nums" dir="ltr">
                    {user.phone ? formatMobileForDisplay(user.phone) : '—'}
                  </TableCell>
                  <TableCell>
                    {user.roles.length === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {ar.users.noRoles}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((role) => (
                          <Badge key={role.id} variant="neutral">
                            {role.nameAr}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? 'positive' : 'muted'}>
                      {user.isActive ? ar.common.active : ar.common.inactive}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!permissions.edit}
                        aria-label={ar.common.edit}
                        title={ar.common.edit}
                        onClick={() => openEdit(user)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!permissions.resetPassword}
                        aria-label={ar.users.resetPassword}
                        title={ar.users.resetPassword}
                        onClick={() => {
                          setResetFor(user)
                          setResetValue('')
                        }}
                      >
                        <KeyRound />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!permissions.deactivate || user.id === currentUserId}
                        aria-label={
                          user.isActive ? ar.users.deactivate : ar.users.activate
                        }
                        title={
                          user.id === currentUserId
                            ? ar.users.cannotDeactivateSelf
                            : user.isActive
                              ? ar.users.deactivate
                              : ar.users.activate
                        }
                        onClick={() => toggleActive(user)}
                      >
                        {user.isActive ? <PowerOff /> : <Power />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={
                          !permissions.impersonate ||
                          user.id === currentUserId ||
                          !user.isActive
                        }
                        aria-label={ar.impersonation.start}
                        title={ar.impersonation.start}
                        onClick={() => impersonate(user)}
                      >
                        <Eye />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Create / edit ──────────────────────────────────────────────── */}
      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? ar.users.edit : ar.users.create}
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
            <FormField name="fullName" label={ar.users.fullName} required>
              {(field) => (
                <Input
                  {...field}
                  value={draft.fullName}
                  onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                />
              )}
            </FormField>

            {!draft.id ? (
              <>
                <FormField name="username" label={ar.auth.username} required>
                  {(field) => (
                    <Input
                      {...field}
                      value={draft.username}
                      dir="ltr"
                      className="text-start font-mono"
                      autoCapitalize="none"
                      onChange={(e) =>
                        setDraft({ ...draft, username: e.target.value.toLowerCase() })
                      }
                    />
                  )}
                </FormField>
                <FormField name="password" label={ar.auth.password} required>
                  {(field) => (
                    <Input
                      {...field}
                      type="password"
                      value={draft.password}
                      dir="ltr"
                      className="text-start"
                      autoComplete="new-password"
                      onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    />
                  )}
                </FormField>
              </>
            ) : null}

            <FormField
              name="phone"
              label={ar.users.phone}
              hint={ar.validation.phoneInvalid}
            >
              {(field) => (
                <Input
                  {...field}
                  value={draft.phone}
                  dir="ltr"
                  className="text-start tabular-nums"
                  inputMode="tel"
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              )}
            </FormField>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={draft.isWorker}
                onChange={(e) => setDraft({ ...draft, isWorker: e.target.checked })}
              />
              <span className="flex flex-col">
                <span>{ar.users.isWorker}</span>
                <span className="text-muted-foreground text-xs">
                  {ar.users.isWorkerHint}
                </span>
              </span>
            </label>

            <FormField name="payType" label={ar.users.payType} required>
              {(field) => (
                <Select
                  {...field}
                  value={draft.payType}
                  onChange={(e) =>
                    setDraft({ ...draft, payType: e.target.value as Draft['payType'] })
                  }
                >
                  <option value="SALARY">{ar.enums.payType.SALARY}</option>
                  <option value="PER_TASK">{ar.enums.payType.PER_TASK}</option>
                  <option value="HYBRID">{ar.enums.payType.HYBRID}</option>
                </Select>
              )}
            </FormField>

            {draft.isWorker && needsSalary ? (
              <FormField name="monthlySalary" label={ar.users.monthlySalary} required>
                {(field) => (
                  <Input
                    {...field}
                    value={draft.monthlySalary}
                    dir="ltr"
                    inputMode="decimal"
                    className="text-start tabular-nums"
                    onChange={(e) =>
                      setDraft({ ...draft, monthlySalary: e.target.value })
                    }
                  />
                )}
              </FormField>
            ) : null}

            {draft.isWorker && needsRate ? (
              <FormField name="defaultTaskRate" label={ar.users.defaultTaskRate} required>
                {(field) => (
                  <Input
                    {...field}
                    value={draft.defaultTaskRate}
                    dir="ltr"
                    inputMode="decimal"
                    className="text-start tabular-nums"
                    onChange={(e) =>
                      setDraft({ ...draft, defaultTaskRate: e.target.value })
                    }
                  />
                )}
              </FormField>
            ) : null}

            <FormField
              name="weeklyCapacityHours"
              label={ar.users.weeklyCapacityHours}
              required
            >
              {(field) => (
                <Input
                  {...field}
                  value={draft.weeklyCapacityHours}
                  dir="ltr"
                  inputMode="numeric"
                  className="text-start tabular-nums"
                  onChange={(e) =>
                    setDraft({ ...draft, weeklyCapacityHours: e.target.value })
                  }
                />
              )}
            </FormField>

            <FormField
              name="penaltyProfileId"
              label={ar.users.penaltyProfile}
              hint={ar.users.penaltyProfileDefault}
            >
              {(field) => (
                <Input
                  {...field}
                  value={draft.penaltyProfileId}
                  dir="ltr"
                  className="text-start font-mono"
                  onChange={(e) =>
                    setDraft({ ...draft, penaltyProfileId: e.target.value })
                  }
                />
              )}
            </FormField>

            <fieldset className="flex flex-col gap-2">
              <legend className="pb-1 text-sm font-medium">{ar.users.roles}</legend>
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.roles.has(role.id)}
                    onChange={(e) => {
                      const next = new Set(draft.roles)
                      if (e.target.checked) next.add(role.id)
                      else next.delete(role.id)
                      setDraft({ ...draft, roles: next })
                    }}
                  />
                  {role.nameAr}
                </label>
              ))}
            </fieldset>
          </div>
        ) : null}
      </Sheet>

      {/* ── Admin password reset ───────────────────────────────────────── */}
      <Sheet
        open={resetFor !== null}
        onClose={() => setResetFor(null)}
        title={ar.users.resetPassword}
        description={ar.users.resetPasswordHint}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetFor(null)} disabled={pending}>
              {ar.common.cancel}
            </Button>
            <Button onClick={submitReset} disabled={pending || resetValue.length === 0}>
              {pending ? ar.common.saving : ar.common.confirm}
            </Button>
          </>
        }
      >
        <FormField name="newPassword" label={ar.auth.newPassword} required>
          {(field) => (
            <Input
              {...field}
              type="text"
              value={resetValue}
              dir="ltr"
              className="text-start font-mono"
              autoComplete="off"
              onChange={(e) => setResetValue(e.target.value)}
            />
          )}
        </FormField>
      </Sheet>
    </div>
  )
}
