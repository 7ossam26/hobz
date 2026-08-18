'use client'

import { CalendarClock } from 'lucide-react'
import * as React from 'react'

import { Chip } from '@/components/data/chip'
import { DateText } from '@/components/data/date-text'
import { Dialog } from '@/components/shared/dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import type { Hue } from '@/lib/palette'
import {
  decideExtensionAction,
  requestExtensionAction,
} from '@/modules/extension/actions'
import type { ExtensionRequestDto, ExtensionStatusDto } from '@/modules/extension/types'
import type { TaskDetailDto } from '@/modules/task/types'

import type { TaskPermissions } from '../tasks-client'

/**
 * التمديد — SPEC §5.3's extension request, on the task it belongs to.
 *
 * The services, actions and queries landed in Phase 6; docs/DECISIONS.md
 * deferred the screen to Phase 12, which is this. It is a tab on the task
 * sheet rather than a page of its own for the reason SPEC §9 gives about the
 * whole product: an extension is a fact *about one task*, and asking a منفّذ to
 * navigate away from the task to ask for more time on it is the shape this
 * product exists to avoid.
 *
 * **Two roles, one tab.** A منفّذ raises a request (the action is `requireAuth`
 * plus an ownership check in the service); somebody holding `task.extend`
 * decides it. Both are shown the same history, because the deadline the
 * deduction is measured against is not a private fact (SPEC §5.3).
 *
 * Every control here is cosmetic. `requestExtension` re-checks ownership and
 * `decideExtensionAction` re-checks `task.extend` (CLAUDE.md invariant 3).
 */

const STATUS_HUE: Record<ExtensionStatusDto, Hue> = {
  PENDING: 'amber',
  APPROVED: 'emerald',
  // 'red' is the deduction/overdue hue in lib/palette; a rejected request is a
  // decision, not money owed, so it takes the adjacent 'orange'.
  REJECTED: 'orange',
}

/** `YYYY-MM-DDTHH:mm` — what `<input type="datetime-local">` reads and writes. */
function toLocalInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function TaskExtensionsTab({
  task,
  extensions,
  permissions,
  currentUserId,
  onMutated,
}: {
  task: TaskDetailDto
  extensions: ExtensionRequestDto[]
  permissions: TaskPermissions
  currentUserId: string
  onMutated: () => void
}) {
  const { toast } = useToast()
  const [requesting, setRequesting] = React.useState(false)
  const [deciding, setDeciding] = React.useState<{
    request: ExtensionRequestDto
    decision: 'APPROVED' | 'REJECTED'
  } | null>(null)
  const [busy, setBusy] = React.useState(false)

  const pending = extensions.find((entry) => entry.status === 'PENDING') ?? null

  // A delivered or closed task cannot be extended (`extensions.errors
  // .taskDelivered`), and the assignee is who asks. `task.extend` also lets a
  // manager file one on somebody's behalf — the ordinary case of a phone call.
  const isAssignee = task.assignee?.id === currentUserId
  const mayRequest =
    pending === null &&
    (isAssignee || permissions.canApprove) &&
    !['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'DONE', 'CANCELLED'].includes(task.status)

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await work()
      toast({ title: done, tone: 'success' })
      setRequesting(false)
      setDeciding(null)
      onMutated()
    } catch {
      toast({ title: ar.errors.unexpected, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {mayRequest ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRequesting(true)}
          >
            <CalendarClock aria-hidden />
            {ar.extensions.request}
          </Button>
        </div>
      ) : null}

      {extensions.length === 0 ? (
        <EmptyState title={ar.extensions.empty} />
      ) : (
        <ul className="divide-border flex flex-col divide-y rounded-lg border">
          {extensions.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Chip hue={STATUS_HUE[entry.status]} size="sm">
                  {ar.extensions.status[entry.status]}
                </Chip>
                <span className="text-muted-foreground text-xs">
                  {ar.extensions.requestedBy}: {entry.requestedBy.fullName}
                </span>
              </div>

              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{ar.extensions.oldDueDate}</dt>
                  <dd>
                    <DateText value={entry.oldDueDate} variant="short" />
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{ar.extensions.newDueDate}</dt>
                  <dd className="font-medium">
                    <DateText value={entry.newDueDate} variant="short" />
                  </dd>
                </div>
              </dl>

              <p className="text-sm">
                <span className="text-muted-foreground">{ar.extensions.reason}: </span>
                {entry.reason}
              </p>

              {entry.decisionNote ? (
                <p className="text-muted-foreground text-xs">
                  {ar.extensions.decisionNote}: {entry.decisionNote}
                </p>
              ) : null}

              {entry.status === 'PENDING' && permissions.canApprove ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => setDeciding({ request: entry, decision: 'APPROVED' })}
                  >
                    {ar.extensions.approve}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setDeciding({ request: entry, decision: 'REJECTED' })}
                  >
                    {ar.extensions.reject}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <RequestDialog
        open={requesting}
        busy={busy}
        currentDueDate={task.dueDate}
        onClose={() => setRequesting(false)}
        onSubmit={(newDueDate, reason) =>
          run(
            () => requestExtensionAction({ taskId: task.id, newDueDate, reason }),
            ar.extensions.request,
          )
        }
      />

      <DecisionDialog
        pending={deciding}
        busy={busy}
        onClose={() => setDeciding(null)}
        onSubmit={(decisionNote) => {
          if (!deciding) return
          void run(
            () =>
              decideExtensionAction({
                id: deciding.request.id,
                decision: deciding.decision,
                decisionNote,
              }),
            deciding.decision === 'APPROVED'
              ? ar.extensions.approved
              : ar.extensions.rejected,
          )
        }}
      />
    </div>
  )
}

function RequestDialog({
  open,
  busy,
  currentDueDate,
  onClose,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  currentDueDate: Date | string
  onClose: () => void
  onSubmit: (newDueDate: Date, reason: string) => void
}) {
  const [newDueDate, setNewDueDate] = React.useState('')
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    // Pre-filled with the current deadline: the operator is moving a date, not
    // inventing one, and a blank field makes them look it up again.
    setNewDueDate(toLocalInputValue(new Date(currentDueDate)))
    setReason('')
  }, [open, currentDueDate])

  const canSubmit = newDueDate !== '' && reason.trim().length > 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ar.extensions.request}
      busy={busy}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            {ar.common.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit || busy}
            onClick={() => onSubmit(new Date(newDueDate), reason.trim())}
          >
            {ar.common.confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField name="extension-due" label={ar.extensions.newDueDate} required>
          {(field) => (
            <Input
              {...field}
              data-autofocus
              type="datetime-local"
              dir="ltr"
              value={newDueDate}
              onChange={(event) => setNewDueDate(event.target.value)}
            />
          )}
        </FormField>

        <FormField
          name="extension-reason"
          label={ar.extensions.reason}
          required
          hint={ar.extensions.errors.reasonRequired}
        >
          {(field) => (
            <Textarea
              {...field}
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

function DecisionDialog({
  pending,
  busy,
  onClose,
  onSubmit,
}: {
  pending: { request: ExtensionRequestDto; decision: 'APPROVED' | 'REJECTED' } | null
  busy: boolean
  onClose: () => void
  onSubmit: (decisionNote: string) => void
}) {
  const [note, setNote] = React.useState('')

  React.useEffect(() => {
    if (pending) setNote('')
  }, [pending])

  if (!pending) return null

  const approving = pending.decision === 'APPROVED'

  return (
    <Dialog
      open
      onClose={onClose}
      title={approving ? ar.extensions.approve : ar.extensions.reject}
      hue={approving ? 'emerald' : 'amber'}
      busy={busy}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            {ar.common.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onSubmit(note.trim())}
          >
            {approving ? ar.extensions.approve : ar.extensions.reject}
          </Button>
        </>
      }
    >
      {/* Optional, unlike the request's reason: the record already says who
          decided and when, and forcing a sentence produces "ok". */}
      <FormField name="extension-decision-note" label={ar.extensions.decisionNote}>
        {(field) => (
          <Textarea
            {...field}
            data-autofocus
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </FormField>
    </Dialog>
  )
}
