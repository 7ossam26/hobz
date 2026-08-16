'use client'

import { Undo2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { Chip } from '@/components/data/chip'
import { DateText } from '@/components/data/date-text'
import { MoneyText } from '@/components/data/money-text'
import { Dialog } from '@/components/shared/dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import {
  createPenaltyAction,
  grantBonusAction,
  reversePenaltyAction,
} from '@/modules/penalty/actions'
import type {
  MoneyRegisterPageDto,
  MoneyRegisterRowDto,
  PenaltyProfileDto,
} from '@/modules/penalty/types'

import { PenaltyProfilesSheet } from './penalty-profiles-sheet'

interface Props {
  register: MoneyRegisterPageDto
  workers: Array<{ id: string; fullName: string }>
  canReversePenalty: boolean
  canReverseBonus: boolean
  canCreatePenalty: boolean
  canCreateBonus: boolean
  /** Null when the caller lacks `settings.view` — the formulas are not theirs to read. */
  profiles: PenaltyProfileDto[] | null
  canEditProfiles: boolean
}

/**
 * The register's interactive half.
 *
 * Filters live in the URL, not in state: they are inputs to a Prisma query that
 * runs in a Server Component, so they have to survive a request (SPEC §9). A
 * filtered register is therefore linkable, and the back button steps through
 * filter changes rather than leaving the page.
 *
 * Every button here is cosmetic in the security sense — each action re-checks
 * server-side (CLAUDE.md invariant 3). Hiding them is what stops a manager
 * clicking something they will only be refused.
 */
export function PenaltiesClient({
  register,
  workers,
  canReversePenalty,
  canReverseBonus,
  canCreatePenalty,
  canCreateBonus,
  profiles,
  canEditProfiles,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [reversing, setReversing] = React.useState<MoneyRegisterRowDto | null>(null)
  const [reason, setReason] = React.useState('')
  const [granting, setGranting] = React.useState<'PENALTY' | 'BONUS' | null>(null)
  const [showProfiles, setShowProfiles] = React.useState(false)

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    // Any filter change returns to the first page; page 4 of the old filter is
    // a different set of rows and almost never the one being looked for.
    next.delete('page')
    router.push(`/penalties?${next.toString()}`)
  }

  const mayReverse = (row: MoneyRegisterRowDto): boolean =>
    row.reversedByEntryId === null &&
    (row.kind === 'BONUS' ? canReverseBonus && canReversePenalty : canReversePenalty)

  function reverse() {
    if (!reversing) return
    startTransition(async () => {
      try {
        await reversePenaltyAction({ entryId: reversing.entryId, reason })
        toast({
          title:
            reversing.kind === 'BONUS'
              ? ar.penalties.reverse.doneBonus
              : ar.penalties.reverse.done,
          tone: 'success',
        })
        setReversing(null)
        setReason('')
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Select
            aria-label={ar.ledger.type}
            value={searchParams.get('kind') ?? ''}
            onChange={(event) => setFilter('kind', event.target.value)}
            className="w-40"
          >
            <option value="">{ar.ledger.allTypes}</option>
            <option value="PENALTY">{ar.penalties.penalties}</option>
            <option value="BONUS">{ar.bonuses.title}</option>
          </Select>

          <Select
            aria-label={ar.penalties.worker}
            value={searchParams.get('user') ?? ''}
            onChange={(event) => setFilter('user', event.target.value)}
            className="w-48"
          >
            <option value="">{ar.penalties.worker}</option>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.fullName}
              </option>
            ))}
          </Select>

          <Select
            aria-label={ar.ledger.automatic}
            value={searchParams.get('automatic') ?? ''}
            onChange={(event) => setFilter('automatic', event.target.value)}
            className="w-40"
          >
            <option value="">{ar.common.all}</option>
            <option value="auto">{ar.penalties.automatic}</option>
            <option value="manual">{ar.penalties.manual}</option>
          </Select>

          <Select
            aria-label={ar.ledger.reversed}
            value={searchParams.get('reversed') ?? ''}
            onChange={(event) => setFilter('reversed', event.target.value)}
            className="w-40"
          >
            <option value="">{ar.common.all}</option>
            <option value="standing">{ar.penalties.frozen}</option>
            <option value="reversed">{ar.ledger.reversed}</option>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="ghost" asChild>
            <Link href="/penalties/report">{ar.reports.deductions}</Link>
          </Button>
          {profiles ? (
            <Button type="button" variant="ghost" onClick={() => setShowProfiles(true)}>
              {ar.penaltyProfiles.title}
            </Button>
          ) : null}
          {canCreatePenalty ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setGranting('PENALTY')}
            >
              {ar.penalties.create}
            </Button>
          ) : null}
          {canCreateBonus ? (
            <Button type="button" onClick={() => setGranting('BONUS')}>
              {ar.bonuses.create}
            </Button>
          ) : null}
        </div>
      </div>

      {register.items.length === 0 ? (
        <EmptyState title={ar.penalties.empty} description={ar.penalties.emptyHint} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{ar.ledger.type}</TableHead>
              <TableHead>{ar.penalties.worker}</TableHead>
              <TableHead>{ar.penalties.task}</TableHead>
              <TableHead>{ar.penalties.reason}</TableHead>
              <TableHead className="text-end">{ar.penalties.amount}</TableHead>
              <TableHead>{ar.penalties.date}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {register.items.map((row) => (
              <TableRow key={row.entryId} data-reversed={row.reversedByEntryId !== null}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip hue={row.kind === 'PENALTY' ? 'red' : 'emerald'} size="sm">
                      {row.kind === 'PENALTY' ? ar.penalties.penalty : ar.bonuses.bonus}
                    </Chip>
                    <Chip hue="neutral" size="sm" tone="ghost">
                      {row.isAutoGenerated ? ar.ledger.automatic : ar.ledger.manual}
                    </Chip>
                  </div>
                </TableCell>
                <TableCell>{row.userFullName}</TableCell>
                <TableCell className="max-w-40 truncate">
                  {row.taskTitle ?? ar.common.none}
                </TableCell>
                <TableCell className="max-w-96 text-xs">
                  {row.note}
                  {row.reversalReason ? (
                    <span className="text-muted-foreground block">
                      {ar.penalties.reverse.reason}: {row.reversalReason}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-end">
                  <MoneyText
                    value={row.kind === 'PENALTY' ? `-${row.amount}` : row.amount}
                    tone="ledger"
                    className={row.reversedByEntryId ? 'line-through opacity-60' : ''}
                  />
                </TableCell>
                <TableCell>
                  <DateText value={row.createdAt} variant="short" />
                </TableCell>
                <TableCell className="text-end">
                  {mayReverse(row) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={ar.penalties.reverse.action}
                      title={ar.penalties.reverse.action}
                      onClick={() => setReversing(row)}
                    >
                      <Undo2 />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={reversing !== null}
        onClose={() => {
          setReversing(null)
          setReason('')
        }}
        title={ar.penalties.reverse.title}
        description={ar.penalties.reverse.confirm}
        hue="amber"
        busy={pending}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setReversing(null)}
              disabled={pending}
            >
              {ar.common.cancel}
            </Button>
            <Button
              type="button"
              onClick={reverse}
              // Mandatory (phase brief item 7). The reason becomes the
              // reversal's own note, which the منفّذ reads verbatim, so an
              // empty one would leave a credit nobody can explain.
              disabled={pending || reason.trim().length < 3}
            >
              {ar.penalties.reverse.action}
            </Button>
          </>
        }
      >
        <FormField
          name="reason"
          label={ar.penalties.reverse.reason}
          hint={ar.penalties.reverse.reasonHint}
          required
        >
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </FormField>
      </Dialog>

      <GrantDialog
        kind={granting}
        workers={workers}
        pending={pending}
        onClose={() => setGranting(null)}
        onDone={() => {
          setGranting(null)
          router.refresh()
        }}
        startTransition={startTransition}
      />

      {profiles ? (
        <PenaltyProfilesSheet
          open={showProfiles}
          onClose={() => setShowProfiles(false)}
          profiles={profiles}
          canEdit={canEditProfiles}
        />
      ) : null}
    </div>
  )
}

/**
 * Manual deductions and bonuses share a dialog because they are the same
 * decision shape — a person, an amount, and a sentence explaining it.
 *
 * **The reason is free text and there is no list to pick from** (phase brief
 * item 5). A dropdown would dress a manager's judgement up as a computed
 * category and leave the منفّذ reading "أخرى", which explains nothing. The
 * whole point of separating manual deductions from automatic ones is that this
 * one is somebody's decision, and the least it owes is a sentence.
 */
function GrantDialog({
  kind,
  workers,
  pending,
  onClose,
  onDone,
  startTransition,
}: {
  kind: 'PENALTY' | 'BONUS' | null
  workers: Array<{ id: string; fullName: string }>
  pending: boolean
  onClose: () => void
  onDone: () => void
  startTransition: React.TransitionStartFunction
}) {
  const { toast } = useToast()
  const [userId, setUserId] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (kind === null) {
      setUserId('')
      setAmount('')
      setReason('')
    }
  }, [kind])

  const isPenalty = kind === 'PENALTY'
  const valid = userId !== '' && Number(amount) > 0 && reason.trim().length >= 3

  function submit() {
    if (!kind || !valid) return
    startTransition(async () => {
      try {
        if (isPenalty) await createPenaltyAction({ userId, amount, reason })
        else await grantBonusAction({ userId, amount, reason })
        toast({
          title: isPenalty ? ar.penalties.created : ar.bonuses.created,
          tone: 'success',
        })
        onDone()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <Dialog
      open={kind !== null}
      onClose={onClose}
      title={isPenalty ? ar.penalties.create : ar.bonuses.create}
      description={isPenalty ? ar.penalties.reasonOnlyOther : ar.bonuses.hint}
      hue={isPenalty ? 'red' : 'emerald'}
      busy={pending}
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
        <FormField name="userId" label={ar.penalties.worker} required>
          {(props) => (
            <Select
              {...props}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">{ar.common.none}</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.fullName}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          name="amount"
          label={isPenalty ? ar.penalties.amount : ar.bonuses.amount}
          required
        >
          {(props) => (
            <Input
              {...props}
              // `inputMode` and a text type, never `type="number"`: money is a
              // string all the way to `lib/money` (CLAUDE.md invariant 2), and
              // a number input hands the browser a float first.
              type="text"
              inputMode="decimal"
              dir="ltr"
              className="numeric-latn text-start"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </FormField>

        <FormField
          name="reason"
          label={isPenalty ? ar.penalties.reasonLabel : ar.bonuses.reason}
          hint={isPenalty ? ar.penalties.reasonPlaceholder : ar.bonuses.reasonHint}
          required
        >
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  )
}
