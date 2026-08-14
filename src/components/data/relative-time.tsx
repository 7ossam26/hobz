'use client'

import * as React from 'react'

import { formatDateTime, formatRelative } from '@/lib/datetime'
import { cn } from '@/lib/utils'

/**
 * `منذ 5 دقائق` — and the reason this is one of the few genuinely client
 * components in the phase.
 *
 * The server renders the **absolute** date. Only after mount does it become
 * relative, and from then on it re-renders on a timer. Two problems solved at
 * once:
 *
 *  - **No hydration mismatch.** A server that formats "منذ دقيقة" and a browser
 *    that hydrates seconds later formats "منذ دقيقتين" — React would warn, and
 *    on a slow connection the two can differ by minutes. First client render is
 *    identical to the server's by construction.
 *  - **It stays true.** A dashboard left open for an hour keeps saying "منذ
 *    دقيقتين" otherwise, which is worse than showing a timestamp.
 *
 * The absolute form is always available in the `title` and in `dateTime`, so
 * nothing is lost by the friendlier wording.
 */
export function RelativeTime({
  value,
  refreshMs = 60_000,
  className,
  ...props
}: Omit<React.ComponentProps<'time'>, 'dateTime' | 'children'> & {
  value: Date
  /** Ticks per minute by default; a live feed can ask for faster. */
  refreshMs?: number
}) {
  const [now, setNow] = React.useState<Date | null>(null)

  React.useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), refreshMs)
    return () => clearInterval(timer)
  }, [refreshMs])

  const absolute = formatDateTime(value)

  return (
    <time
      data-slot="relative-time"
      dateTime={value.toISOString()}
      title={absolute}
      className={cn('whitespace-nowrap', className)}
      {...props}
    >
      {now ? formatRelative(value, now) : absolute}
    </time>
  )
}
