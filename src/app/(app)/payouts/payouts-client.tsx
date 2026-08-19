'use client'

import { Banknote } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { Chip } from '@/components/data/chip'
import { DateText } from '@/components/data/date-text'
import { MoneyText } from '@/components/data/money-text'
import { UserChip } from '@/components/data/user-chip'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Dialog } from '@/components/shared/dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ar } from '@/i18n/ar'
import { fillWhatsappTemplate } from '@/lib/whatsapp'
import {
  approvePayoutAction,
  closeCycleAction,
  markPayoutPaidAction,
} from '@/modules/payout/actions'
import { markPayoutPaidSchema } from '@/modules/payout/schema'
import type { PayoutCycleDto, PayoutDto } from '@/modules/payout/types'

interface Props {
  cycles: PayoutCycleDto[]
  selectedCycleId: string | null
  payouts: PayoutDto[]
  paymentMethods: string[]
  /** SPEC §8 — Settings `whatsapp.templates`. */
  whatsappTemplates: Record<string, string>
  canGenerate: boolean
  canApprove: boolean
  canMarkPaid: boolean
}

/**
 * Three permissions, three buttons, and none of them is the enforcement — every
 * one of these actions re-checks server-side (CLAUDE.md invariant 3). Hiding
 * them is what stops a manager clicking something they will only be refused.
 */
export function PayoutsClient({
  cycles,
  selectedCycleId,
  payouts,
  paymentMethods,
  whatsappTemplates,
  canGenerate,
  canApprove,
  canMarkPaid,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [confirmingClose, setConfirmingClose] = React.useState(false)
  const [paying, setPaying] = React.useState<PayoutDto | null>(null)

  function selectCycle(cycleId: string) {
    const next = new URLSearchParams(searchParams.toString())
    next.set('cycle', cycleId)
    router.push(`/payouts?${next.toString()}`)
  }

  function closeCycle() {
    startTransition(async () => {
      try {
        const result = await closeCycleAction({})
        if (!result.acquired) {
          toast({ title: ar.payouts.closeCycleLocked, tone: 'info' })
        } else if (result.closed) {
          toast({
            title: ar.payouts.closeCycleDone.replace(
              '{count}',
              String(result.payoutsCreated),
            ),
            tone: 'success',
          })
        } else {
          toast({ title: ar.payouts.errors.cycleNotOpen, tone: 'info' })
        }
        setConfirmingClose(false)
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  function approve(payout: PayoutDto) {
    startTransition(async () => {
      try {
        await approvePayoutAction({ payoutId: payout.id })
        toast({ title: ar.common.saved, tone: 'success' })
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{ar.payouts.title}</h1>
          <p className="text-muted-foreground text-sm">{ar.payouts.subtitle}</p>
        </div>
        {canGenerate ? (
          <Button
            type="button"
            onClick={() => setConfirmingClose(true)}
            disabled={pending}
          >
            {ar.payouts.closeCycle}
          </Button>
        ) : null}
      </header>

      {cycles.length === 0 ? (
        <EmptyState
          title={ar.payouts.empty}
          description={ar.payouts.emptyHint}
          icon={<Banknote aria-hidden className="size-5" />}
        />
      ) : (
        <>
          <section className="flex gap-2 overflow-x-auto pb-1">
            {cycles.map((cycle) => (
              <button
                key={cycle.id}
                type="button"
                onClick={() => selectCycle(cycle.id)}
                aria-current={cycle.id === selectedCycleId ? 'true' : undefined}
                className="border-border data-[current=true]:border-primary hover:bg-accent flex min-w-44 shrink-0 flex-col gap-1 rounded-lg border p-3 text-start transition-colors"
                data-current={cycle.id === selectedCycleId}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    <DateText value={cycle.periodEnd} variant="short" />
                  </span>
                  <Chip
                    hue={
                      cycle.status === 'PAID'
                        ? 'emerald'
                        : cycle.status === 'CLOSED'
                          ? 'sky'
                          : 'neutral'
                    }
                    size="sm"
                  >
                    {ar.enums.payoutCycleStatus[cycle.status]}
                  </Chip>
                </span>
                <MoneyText value={cycle.totalNet} withCurrency />
                <span className="text-muted-foreground text-xs">
                  {ar.payouts.payoutCount}: {cycle.payoutCount}
                </span>
              </button>
            ))}
          </section>

          {payouts.length === 0 ? (
            <EmptyState title={ar.payouts.noPayouts} />
          ) : (
            <div className="border-border overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ar.payouts.worker}</TableHead>
                    <TableHead className="text-end">
                      {ar.payouts.carriedForward}
                    </TableHead>
                    <TableHead className="text-end">{ar.payouts.gross}</TableHead>
                    <TableHead className="text-end">{ar.payouts.penalties}</TableHead>
                    <TableHead className="text-end">{ar.payouts.advances}</TableHead>
                    <TableHead className="text-end">{ar.payouts.net}</TableHead>
                    <TableHead className="text-end">{ar.payouts.outstanding}</TableHead>
                    <TableHead>{ar.audit.action}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((payout) => (
                    <TableRow key={payout.id}>
                      <TableCell>
                        {payout.user ? (
                          <UserChip
                            user={payout.user}
                            whatsappMessage={
                              whatsappTemplates.payoutPaid
                                ? fillWhatsappTemplate(whatsappTemplates.payoutPaid, {
                                    name: payout.user.fullName,
                                    amount: payout.net,
                                  })
                                : undefined
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground">{ar.common.none}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <MoneyText value={payout.carriedForward} tone="ledger" />
                      </TableCell>
                      <TableCell className="text-end">
                        <MoneyText value={payout.gross} />
                      </TableCell>
                      <TableCell className="text-end">
                        <MoneyText value={payout.penalties} />
                      </TableCell>
                      <TableCell className="text-end">
                        <MoneyText value={payout.advances} />
                      </TableCell>
                      <TableCell className="text-end font-medium">
                        <MoneyText value={payout.net} />
                      </TableCell>
                      <TableCell className="text-end">
                        <MoneyText value={payout.outstanding} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Chip
                            hue={
                              payout.status === 'PAID'
                                ? 'emerald'
                                : payout.status === 'APPROVED'
                                  ? 'sky'
                                  : 'neutral'
                            }
                            size="sm"
                          >
                            {ar.enums.payoutStatus[payout.status]}
                          </Chip>
                          {payout.status === 'DRAFT' && canApprove ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => approve(payout)}
                            >
                              {ar.payouts.approve}
                            </Button>
                          ) : null}
                          {payout.status === 'APPROVED' && canMarkPaid ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={pending}
                              onClick={() => setPaying(payout)}
                            >
                              {ar.payouts.markPaid}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmingClose}
        onClose={() => setConfirmingClose(false)}
        onConfirm={closeCycle}
        title={ar.payouts.closeCycle}
        description={ar.payouts.closeCycleConfirm}
        confirmLabel={ar.payouts.closeCycle}
        busy={pending}
      />

      <PaymentDialog
        payout={paying}
        paymentMethods={paymentMethods}
        busy={pending}
        onClose={() => setPaying(null)}
        onSubmit={(input) => {
          startTransition(async () => {
            try {
              await markPayoutPaidAction(input)
              toast({ title: ar.common.saved, tone: 'success' })
              setPaying(null)
              router.refresh()
            } catch {
              toast({ title: ar.errors.unexpected, tone: 'error' })
            }
          })
        }}
      />
    </div>
  )
}

/**
 * Partial payment is the default shape of this form, not a special mode: the
 * amount defaults to the whole outstanding balance and can be reduced. SPEC
 * §5.5 says the remainder stays outstanding, and the hint under the field says
 * so too, because a manager typing a smaller number needs to know it is not a
 * write-off.
 */
function PaymentDialog({
  payout,
  paymentMethods,
  busy,
  onClose,
  onSubmit,
}: {
  payout: PayoutDto | null
  paymentMethods: string[]
  busy: boolean
  onClose: () => void
  onSubmit: (input: {
    payoutId: string
    amount: string
    method?: string
    reference?: string
  }) => void
}) {
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!payout) return
    setAmount(payout.outstanding)
    setMethod(paymentMethods[0] ?? '')
    setReference('')
    setError(null)
  }, [payout, paymentMethods])

  if (!payout) return null

  function submit() {
    if (!payout) return
    const candidate = {
      payoutId: payout.id,
      amount: amount.trim(),
      ...(method ? { method } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    }
    const parsed = markPayoutPaidSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(ar.errors.validation)
      return
    }
    if (Number(candidate.amount) > Number(payout.outstanding)) {
      setError(ar.payouts.errors.exceedsOutstanding)
      return
    }
    setError(null)
    onSubmit(candidate)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={ar.payouts.markPaid}
      description={payout.user?.fullName}
      busy={busy}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {ar.common.cancel}
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            {ar.common.confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField
          name="amount"
          label={ar.payouts.amountToPay}
          hint={ar.payouts.partialHint}
          required
          {...(error ? { error } : {})}
        >
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="numeric-latn"
            />
          )}
        </FormField>

        <FormField name="method" label={ar.payouts.method} required>
          {(field) => (
            <select
              {...field}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              {paymentMethods.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField name="reference" label={ar.payouts.reference}>
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </FormField>

        <p className="text-muted-foreground text-xs">
          {ar.payouts.outstanding}: <MoneyText value={payout.outstanding} withCurrency />
        </p>
      </div>
    </Dialog>
  )
}
