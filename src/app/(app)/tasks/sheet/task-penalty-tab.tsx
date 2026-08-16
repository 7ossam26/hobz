'use client'

import { Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Chip } from '@/components/data/chip'
import { DateText } from '@/components/data/date-text'
import { MoneyText } from '@/components/data/money-text'
import { PenaltyBreakdown } from '@/components/money/penalty-breakdown'
import { Dialog } from '@/components/shared/dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import {
  recomputeTaskPenaltyAction,
  reversePenaltyAction,
} from '@/modules/penalty/actions'
import type { PenaltyEntryDto, TaskPenaltyPanelDto } from '@/modules/penalty/types'

import type { TaskPermissions } from '../tasks-client'

/**
 * The per-task deduction panel (phase brief item 9).
 *
 * Two halves, and the split is SPEC T4's:
 *
 *  - **The live figure**, recomputed the moment the sheet opened. It is what
 *    the deduction *is* right now, and it moves until the task is delivered.
 *  - **Every entry this task has produced**, each labelled with the delivery it
 *    belongs to — التسليم الأصلي, المراجعة رقم 1 — because after a revision
 *    both stand, and a reader comparing timestamps to work out which is which
 *    is a reader who will get it wrong.
 *
 * Reading never writes. Opening this panel assesses; it does not apply. The
 * "recalculate now" button is the only thing here that can move money, and it
 * contends for the same per-task lock the nightly job takes.
 */
export function TaskPenaltyTab({
  taskId,
  panel,
  permissions,
  onMutated,
}: {
  taskId: string
  panel: TaskPenaltyPanelDto | null
  permissions: TaskPermissions & {
    penaltyReverse?: boolean
    penaltyCreate?: boolean
  }
  onMutated: () => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [reversing, setReversing] = React.useState<PenaltyEntryDto | null>(null)
  const [reason, setReason] = React.useState('')

  if (!panel) {
    return <EmptyState title={ar.penalties.noPenaltyForTask} />
  }

  function recompute() {
    startTransition(async () => {
      try {
        await recomputeTaskPenaltyAction({ taskId })
        toast({ title: ar.common.saved, tone: 'success' })
        onMutated()
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  function reverse() {
    if (!reversing) return
    startTransition(async () => {
      try {
        await reversePenaltyAction({ entryId: reversing.entryId, reason })
        toast({ title: ar.penalties.reverse.done, tone: 'success' })
        setReversing(null)
        setReason('')
        onMutated()
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">
            {ar.penalties.fields.amount}
          </span>
          <MoneyText
            value={`-${panel.totalCharged}`}
            withCurrency
            tone="ledger"
            className="text-2xl"
          />
        </div>
        {permissions.penaltyCreate ? (
          <Button type="button" variant="outline" onClick={recompute} disabled={pending}>
            {ar.penalties.causes.manual}
          </Button>
        ) : null}
      </section>

      {panel.revisionCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          {panel.penalizeRevisionLateness
            ? ar.penalties.revisionSeparate
            : ar.penalties.revisionNotPenalized}
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{ar.penalties.breakdown}</CardTitle>
        </CardHeader>
        <CardContent>
          {panel.current ? (
            <PenaltyBreakdown breakdown={panel.current} />
          ) : (
            <p className="text-muted-foreground text-sm">
              {/*
                A reason, never a bare zero. "No penalty" and "the deduction
                could not be computed" are different facts and only one of them
                needs somebody to act.
              */}
              {panel.currentStatus === 'NO_BASIS'
                ? ar.penalties.noBasis
                : panel.currentStatus === 'NO_ASSIGNEE'
                  ? ar.tasks.unassigned
                  : ar.penalties.onTime}
            </p>
          )}
        </CardContent>
      </Card>

      {panel.entries.length === 0 ? (
        <EmptyState title={ar.penalties.noPenaltyForTask} />
      ) : (
        <ul className="flex flex-col gap-2">
          {panel.entries.map((entry) => (
            <li
              key={entry.entryId}
              className="border-border flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {entry.roundIndex === null ? (
                    <Chip hue="neutral" size="sm" tone="outline">
                      {ar.penalties.manual}
                    </Chip>
                  ) : (
                    <Chip
                      hue={entry.roundIndex === 0 ? 'neutral' : 'fuchsia'}
                      size="sm"
                      tone="outline"
                    >
                      {entry.roundIndex === 0
                        ? ar.penalties.originalDelivery
                        : ar.penalties.revisionRound.replace(
                            '{n}',
                            String(entry.roundIndex),
                          )}
                    </Chip>
                  )}
                  {entry.isCurrentRound && entry.reversedByEntryId === null ? (
                    <Chip hue="amber" size="sm">
                      {ar.penalties.live}
                    </Chip>
                  ) : entry.reversedByEntryId === null ? (
                    <Chip hue="neutral" size="sm" tone="ghost">
                      {ar.penalties.frozen}
                    </Chip>
                  ) : (
                    <Chip hue="neutral" size="sm" tone="ghost">
                      {ar.ledger.reversed}
                    </Chip>
                  )}
                  <DateText
                    value={entry.createdAt}
                    variant="short"
                    className="text-muted-foreground text-xs"
                  />
                </div>
                {/*
                  The note *is* the breakdown for a frozen entry: it was written
                  with the full calculation at the moment the money moved, and
                  the deadline it was measured against may since have been
                  replaced by a revision's. Re-deriving it from today's row
                  would show a figure that no longer explains the amount beside
                  it (SPEC §4: an entry that cannot explain itself).
                */}
                <p className="text-xs leading-relaxed">{entry.note}</p>
                {entry.reversalReason ? (
                  <p className="text-muted-foreground text-xs">
                    {ar.penalties.reverse.reason}: {entry.reversalReason}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <MoneyText
                  value={`-${entry.amount}`}
                  tone="ledger"
                  className={entry.reversedByEntryId ? 'line-through opacity-60' : ''}
                />
                {permissions.penaltyReverse && entry.reversedByEntryId === null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={ar.penalties.reverse.action}
                    title={ar.penalties.reverse.action}
                    onClick={() => setReversing(entry)}
                  >
                    <Undo2 />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
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
              disabled={pending || reason.trim().length < 3}
            >
              {ar.penalties.reverse.action}
            </Button>
          </>
        }
      >
        <FormField
          name="reverse-reason"
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
    </div>
  )
}
