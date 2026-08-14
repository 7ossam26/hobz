import * as React from 'react'

import { ar } from '@/i18n/ar'
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDuration,
  formatTime,
} from '@/lib/datetime'
import { cn } from '@/lib/utils'

/**
 * Dates, as a reader sees them: Gregorian calendar, Arabic month name, Western
 * digits, Cairo wall clock (SPEC §2).
 *
 * Always a `<time>` element with a machine-readable `dateTime`. That is what
 * lets a test assert on the instant rather than on the wording, and what makes
 * the value survive a copy-paste into a spreadsheet.
 *
 * A missing date renders `لا يوجد` rather than an empty cell. "No due date" is
 * a fact about a task; blank space is a rendering bug the reader has to
 * diagnose.
 */

interface DateProps extends Omit<React.ComponentProps<'time'>, 'dateTime' | 'children'> {
  value: Date | null | undefined
  /** `short` drops the year — for columns where the year is implied. */
  variant?: 'full' | 'short'
}

function Empty({ className }: { className?: string }) {
  return <span className={cn('text-fg-subtle', className)}>{ar.common.none}</span>
}

export function DateText({ value, variant = 'full', className, ...props }: DateProps) {
  if (!value) return <Empty className={className} />

  return (
    <time
      data-slot="date"
      dateTime={value.toISOString()}
      title={formatDateTime(value)}
      className={cn('tabular-nums whitespace-nowrap', className)}
      {...props}
    >
      {variant === 'short' ? formatDateShort(value) : formatDate(value)}
    </time>
  )
}

/** Date and Cairo clock time, for audit rows and activity feeds. */
export function DateTimeText({ value, className, ...props }: Omit<DateProps, 'variant'>) {
  if (!value) return <Empty className={className} />

  return (
    <time
      data-slot="datetime"
      dateTime={value.toISOString()}
      className={cn('whitespace-nowrap', className)}
      {...props}
    >
      {formatDate(value)}
      <span className="text-fg-subtle mx-1">·</span>
      <span className="tabular-nums">{formatTime(value)}</span>
    </time>
  )
}

/**
 * Elapsed work, read as a quantity rather than as a point in time — so it is a
 * `<span>`, not a `<time>`, and it gets `tabular-nums` for the same reason
 * money does: these appear in columns and get compared.
 */
export function DurationText({
  minutes,
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & { minutes: number | null | undefined }) {
  if (minutes == null) return <Empty className={className} />

  return (
    <span
      data-slot="duration"
      className={cn('tabular-nums whitespace-nowrap', className)}
      {...props}
    >
      {formatDuration(minutes)}
    </span>
  )
}
