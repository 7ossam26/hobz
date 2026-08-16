'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Chip } from '@/components/data/chip'
import { MoneyText } from '@/components/data/money-text'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { FormField } from '@/components/shared/form-field'
import { Sheet } from '@/components/shared/sheet'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import {
  createPenaltyProfileAction,
  deletePenaltyProfileAction,
  updatePenaltyProfileAction,
} from '@/modules/penalty/actions'
import { PENALTY_MODES, isFixedAmount, type PenaltyMode } from '@/modules/penalty/mode'
import type { PenaltyProfileDto } from '@/modules/penalty/types'

/**
 * SPEC R2's named formulas, managed where the deductions they produce are read.
 *
 * ── Why here and not on a Settings page ───────────────────────────────────
 *
 * The Settings *shell* is Phase 12's, and there is no page to hang this off
 * yet. Rather than build half of that shell now and have Phase 12 rework it,
 * the formulas live behind a sheet on the register — which is where the
 * question they answer actually gets asked ("why is this person's deduction
 * different from that one's?"). It is also SPEC §9's interaction model:
 * entities are edited in a sheet over the current page, not by navigating away.
 *
 * The button that opens it is visible only to `settings.edit` holders, and that
 * is cosmetic: every action re-checks server-side (CLAUDE.md invariant 3).
 */
export function PenaltyProfilesSheet({
  open,
  onClose,
  profiles,
  canEdit,
}: {
  open: boolean
  onClose: () => void
  profiles: PenaltyProfileDto[]
  canEdit: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState<PenaltyProfileDto | 'new' | null>(null)
  const [deleting, setDeleting] = React.useState<PenaltyProfileDto | null>(null)

  function remove() {
    if (!deleting) return
    startTransition(async () => {
      try {
        await deletePenaltyProfileAction({ id: deleting.id })
        toast({ title: ar.penaltyProfiles.deleted, tone: 'success' })
        setDeleting(null)
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={ar.penaltyProfiles.title}
        description={ar.penaltyProfiles.subtitle}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          {canEdit ? (
            <Button type="button" onClick={() => setEditing('new')} disabled={pending}>
              {ar.penaltyProfiles.create}
            </Button>
          ) : null}

          {/*
            SPEC §5.4 says "No cap", and it is stated on the screen where an
            operator sets the number rather than only in a spec they will never
            read. A percentage over 100 or a per-day figure larger than a task
            is worth is a real configuration, and somebody typing one should
            know the system will not quietly protect them from it.
          */}
          <p className="text-muted-foreground text-xs">{ar.penaltyProfiles.noCap}</p>

          {profiles.length === 0 ? (
            <EmptyState
              title={ar.penaltyProfiles.empty}
              description={ar.penaltyProfiles.emptyHint}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {profiles.map((profile) => (
                <li
                  key={profile.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{profile.name}</span>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Chip hue="neutral" size="sm" tone="outline">
                        {ar.enums.penaltyMode[profile.mode]}
                      </Chip>
                      {isFixedAmount(profile.mode) ? (
                        <MoneyText value={profile.value} withCurrency />
                      ) : (
                        <span className="numeric-latn" dir="ltr">
                          {trimPercent(profile.value)}%
                        </span>
                      )}
                      {profile.graceHours !== null ? (
                        <span className="text-muted-foreground numeric-latn">
                          {ar.lateness.graceHoursValue.replace(
                            '{hours}',
                            String(profile.graceHours),
                          )}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {ar.penaltyProfiles.usersCount.replace(
                          '{count}',
                          String(profile.userCount),
                        )}
                      </span>
                    </div>
                  </div>

                  {canEdit ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={ar.penaltyProfiles.edit}
                        onClick={() => setEditing(profile)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={ar.penaltyProfiles.delete}
                        onClick={() => setDeleting(profile)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>

      <ProfileForm
        target={editing}
        pending={pending}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null)
          router.refresh()
        }}
        startTransition={startTransition}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove()}
        title={ar.penaltyProfiles.delete}
        // The consequence, stated: every منفّذ on this formula returns to the
        // agency default, which changes what they are docked next month.
        description={ar.penaltyProfiles.deleteConfirm}
        confirmLabel={ar.common.delete}
        busy={pending}
      />
    </>
  )
}

/** `5.00` → `5`, `7.50` → `7.5`. A percentage is a policy, not an amount. */
const trimPercent = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value

function ProfileForm({
  target,
  pending,
  onClose,
  onDone,
  startTransition,
}: {
  target: PenaltyProfileDto | 'new' | null
  pending: boolean
  onClose: () => void
  onDone: () => void
  startTransition: React.TransitionStartFunction
}) {
  const { toast } = useToast()
  const existing = target !== null && target !== 'new' ? target : null

  const [name, setName] = React.useState('')
  const [mode, setMode] = React.useState<PenaltyMode>('PCT_TASK_VALUE_PER_DAY')
  const [value, setValue] = React.useState('')
  const [graceHours, setGraceHours] = React.useState('')

  React.useEffect(() => {
    setName(existing?.name ?? '')
    setMode(existing?.mode ?? 'PCT_TASK_VALUE_PER_DAY')
    setValue(existing ? trimPercent(existing.value) : '')
    setGraceHours(existing?.graceHours === null ? '' : String(existing?.graceHours ?? ''))
    // `target` identity, not `existing`: switching from one profile to another
    // must reset the fields, and so must opening "new" after an edit.
  }, [target, existing])

  const valid = name.trim().length >= 2 && Number(value) >= 0 && value !== ''

  function submit() {
    if (!target || !valid) return
    const input = {
      name: name.trim(),
      mode,
      value,
      graceHours: graceHours === '' ? null : Number(graceHours),
    }
    startTransition(async () => {
      try {
        if (existing) await updatePenaltyProfileAction({ id: existing.id, ...input })
        else await createPenaltyProfileAction(input)
        toast({
          title: existing ? ar.penaltyProfiles.updated : ar.penaltyProfiles.created,
          tone: 'success',
        })
        onDone()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      title={existing ? ar.penaltyProfiles.edit : ar.penaltyProfiles.create}
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {ar.common.cancel}
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !valid}>
            {ar.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField name="name" label={ar.penaltyProfiles.name} required>
          {(props) => (
            <Input
              {...props}
              value={name}
              placeholder={ar.penaltyProfiles.namePlaceholder}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FormField>

        <FormField name="mode" label={ar.penaltyProfiles.mode} required>
          {(props) => (
            <Select
              {...props}
              value={mode}
              onChange={(event) => setMode(event.target.value as PenaltyMode)}
            >
              {PENALTY_MODES.map((option) => (
                <option key={option} value={option}>
                  {ar.enums.penaltyMode[option]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          name="value"
          // The label changes with the mode, because the number means two
          // different things and a field labelled "القيمة" invites somebody to
          // type 500 meaning pounds into a percentage.
          label={
            isFixedAmount(mode)
              ? ar.penaltyProfiles.valueCurrency
              : ar.penaltyProfiles.valuePercent
          }
          required
        >
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="decimal"
              dir="ltr"
              className="numeric-latn text-start"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </FormField>

        <FormField
          name="graceHours"
          label={ar.penaltyProfiles.graceHours}
          hint={ar.penaltyProfiles.graceHoursHint}
        >
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="numeric"
              dir="ltr"
              className="numeric-latn text-start"
              value={graceHours}
              onChange={(event) => setGraceHours(event.target.value)}
            />
          )}
        </FormField>
      </div>
    </Sheet>
  )
}
