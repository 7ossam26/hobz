'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { useToast } from '@/components/shared/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ar } from '@/i18n/ar'
import { createHolidayAction, deleteHolidayAction } from '@/modules/holiday/actions'
import type { HolidayDto } from '@/modules/holiday/types'

/**
 * Public holidays, edited inside the Settings page.
 *
 * They are not a `Setting` row — they are their own table with their own
 * permission (`calendar.manage`, SPEC §6) and their own audit trail, because
 * adding one changes what every deadline in the agency is measured against.
 * They live on this screen anyway because SPEC §7 lists "holidays" among the
 * things one page must configure, and an operator does not care which storage
 * shape a rule happens to have.
 *
 * The date is rendered as its Cairo date key, LTR and tabular — a holiday has
 * no time of day, and re-parsing it into a `Date` here would invite a timezone
 * shift on the display of a value the server already resolved.
 */
export function HolidaysSection({
  holidays,
  canManage,
}: {
  holidays: HolidayDto[]
  canManage: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)
  const [date, setDate] = React.useState('')
  const [nameAr, setNameAr] = React.useState('')
  const [isRecurring, setIsRecurring] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState<HolidayDto | null>(null)

  function add() {
    setError(null)
    setPending(true)
    void createHolidayAction({ date, nameAr, isRecurring })
      .then(() => {
        setDate('')
        setNameAr('')
        setIsRecurring(false)
        toast({ title: ar.common.saved, tone: 'success' })
        router.refresh()
      })
      .catch(() => setError(ar.holidays.errors.duplicate))
      .finally(() => setPending(false))
  }

  function remove(holiday: HolidayDto) {
    setPending(true)
    void deleteHolidayAction({ id: holiday.id })
      .then(() => {
        toast({ title: ar.common.saved, tone: 'success' })
        router.refresh()
      })
      .catch(() => toast({ title: ar.errors.unexpected, tone: 'error' }))
      .finally(() => {
        setPending(false)
        setConfirming(null)
      })
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holiday-date">{ar.holidays.date}</Label>
            <Input
              id="holiday-date"
              type="date"
              dir="ltr"
              className="w-44 tabular-nums"
              value={date}
              disabled={pending}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holiday-name">{ar.holidays.name}</Label>
            <Input
              id="holiday-name"
              className="w-64"
              value={nameAr}
              disabled={pending}
              onChange={(event) => setNameAr(event.target.value)}
            />
          </div>

          <div className="flex h-9 items-center gap-2">
            <Checkbox
              id="holiday-recurring"
              checked={isRecurring}
              disabled={pending}
              onChange={(event) => setIsRecurring(event.target.checked)}
            />
            <Label htmlFor="holiday-recurring" className="font-normal">
              {ar.holidays.recurring}
            </Label>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={pending || date === '' || nameAr.trim() === ''}
            onClick={add}
          >
            <Plus aria-hidden />
            {ar.common.add}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">{ar.holidays.recurringHint}</p>

      {holidays.length === 0 ? (
        <EmptyState title={ar.holidays.empty} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{ar.holidays.date}</TableHead>
              <TableHead>{ar.holidays.name}</TableHead>
              <TableHead>{ar.holidays.recurring}</TableHead>
              {canManage ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays.map((holiday) => (
              <TableRow key={holiday.id}>
                <TableCell dir="ltr" className="text-start tabular-nums">
                  {holiday.date}
                </TableCell>
                <TableCell>{holiday.nameAr}</TableCell>
                <TableCell>
                  {holiday.isRecurring ? (
                    <Badge variant="accent">{ar.common.yes}</Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">{ar.common.no}</span>
                  )}
                </TableCell>
                {canManage ? (
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending}
                      aria-label={ar.common.delete}
                      onClick={() => setConfirming(holiday)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={ar.common.delete}
        description={confirming?.nameAr}
        confirmLabel={ar.common.delete}
        busy={pending}
        onConfirm={() => {
          if (confirming) remove(confirming)
        }}
      />
    </div>
  )
}
