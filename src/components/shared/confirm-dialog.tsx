'use client'

import * as React from 'react'

import { Dialog } from '@/components/shared/dialog'
import { FormField } from '@/components/shared/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import { normalizeArabic } from '@/lib/search'

/**
 * Destructive confirmation, with two optional gates.
 *
 * **Typed confirmation** (SPEC §9: "destructive actions need typed
 * confirmation"). The user retypes the entity's name. A second "are you sure?"
 * button is answered reflexively; a name has to be read off the screen first,
 * which is the entire mechanism.
 *
 * The comparison runs through `normalizeArabic`, so a manager who types
 * `احمد` clears a dialog naming `أحمد`. That is not a loophole: the gate exists
 * to force attention, not to test orthography, and failing someone for a hamza
 * they cannot see teaches them to copy-paste — which defeats it entirely.
 *
 * **Mandatory reason.** Several actions in this product are reversible only on
 * the record: reversing a penalty requires a reason (SPEC §5.4), as does
 * overriding project health (§5.7). The reason belongs in the same dialog as
 * the decision, and it goes straight into the audit row.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  confirmPhrase,
  reasonRequired = false,
  reasonLabel,
  destructive = true,
  busy = false,
}: {
  open: boolean
  onClose: () => void
  /** Receives the typed reason when one was required. */
  onConfirm: (reason: string) => void
  title: string
  description?: string
  confirmLabel?: string
  /** Retype-to-confirm. Usually the entity's name. Omit for low-stakes actions. */
  confirmPhrase?: string
  reasonRequired?: boolean
  reasonLabel?: string
  destructive?: boolean
  busy?: boolean
}) {
  const [typed, setTyped] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  // Reopening on a different entity must never inherit the previous answer —
  // otherwise a second delete is confirmed by the first one's typing.
  React.useEffect(() => {
    if (open) {
      setTyped('')
      setReason('')
      setTouched(false)
    }
  }, [open])

  const phraseOk =
    !confirmPhrase || normalizeArabic(typed) === normalizeArabic(confirmPhrase)
  const reasonOk = !reasonRequired || reason.trim().length > 0
  const canConfirm = phraseOk && reasonOk && !busy

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      busy={busy}
      hue={destructive ? 'red' : undefined}
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
            variant={destructive ? 'destructive' : 'default'}
            disabled={!canConfirm}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel ?? ar.confirm.proceed}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {destructive ? (
          <p className="text-fg-muted text-sm">{ar.confirm.irreversible}</p>
        ) : null}

        {confirmPhrase ? (
          <FormField
            name="confirm-phrase"
            label={ar.confirm.typeToConfirm.replace('{value}', confirmPhrase)}
            required
            error={
              touched && typed.length > 0 && !phraseOk ? ar.confirm.mismatch : undefined
            }
          >
            {(field) => (
              <Input
                {...field}
                value={typed}
                autoComplete="off"
                onChange={(event) => {
                  setTyped(event.target.value)
                  setTouched(true)
                }}
              />
            )}
          </FormField>
        ) : null}

        {reasonRequired ? (
          <FormField
            name="confirm-reason"
            label={reasonLabel ?? ar.common.reason}
            required
          >
            {(field) => (
              <Textarea
                {...field}
                value={reason}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </FormField>
        ) : null}
      </div>
    </Dialog>
  )
}
