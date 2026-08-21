import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { Dot } from '@/components/data/chip'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { projectStatusHue, taskStatusHue } from '@/lib/palette'
import { cn } from '@/lib/utils'
import {
  getGlobalCalendarEvents,
  type CalendarEventDto,
} from '@/modules/calendar/queries'
import { getProjectOptions } from '@/modules/project/queries'
import { getUserOptions } from '@/modules/user/queries'

import {
  addMonthsUtc,
  isSameUtcDay,
  monthGridRange,
  startOfUtcDay,
  toDateParam,
} from '../tasks/calendar/date-grid'

import { CalendarFilters } from './calendar-filters'

export const metadata: Metadata = { title: ar.globalCalendar.title }

const MAX_PER_DAY = 3

function groupByDay(events: CalendarEventDto[]): Map<string, CalendarEventDto[]> {
  const map = new Map<string, CalendarEventDto[]>()
  for (const event of events) {
    const key = toDateParam(event.date)
    const bucket = map.get(key)
    if (bucket) bucket.push(event)
    else map.set(key, [event])
  }
  return map
}

function eventHue(event: CalendarEventDto): ReturnType<typeof taskStatusHue> {
  return event.type === 'TASK'
    ? taskStatusHue(event.status)
    : projectStatusHue(event.status)
}

function fromMonthParam(raw: string | undefined, fallback: Date): Date {
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return fallback
  const [year, month] = raw.split('-').map(Number)
  return new Date(Date.UTC(year as number, (month as number) - 1, 1))
}

function toMonthParam(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * The global deadlines calendar (phase brief item 6) — every task and project
 * due date, filterable by project/worker. A Server Component throughout
 * except the two filter `<select>`s (`calendar-filters.tsx`): month
 * navigation is plain links, event rows are plain links, and the only client
 * JS on this route is the filter form itself.
 */
export default async function GlobalCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (key: string): string => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? ''
  }

  const now = new Date()
  const reference = fromMonthParam(one('month') || undefined, startOfUtcDay(now))
  const projectId = one('projectId')
  const workerId = one('workerId')

  const { from, to, weeks } = monthGridRange(reference)

  const [calendar, projectOptions, userOptions] = await Promise.all([
    getGlobalCalendarEvents(
      { from, to },
      {
        ...(projectId ? { projectId } : {}),
        ...(workerId ? { workerId } : {}),
      },
      now,
    ),
    getProjectOptions(),
    getUserOptions(),
  ])

  const byDay = groupByDay(calendar.events)
  const today = startOfUtcDay(now)
  const title = `${ar.months[reference.getUTCMonth()]} ${reference.getUTCFullYear()}`

  const hrefFor = (date: Date): string => {
    const usp = new URLSearchParams()
    usp.set('month', toMonthParam(date))
    if (projectId) usp.set('projectId', projectId)
    if (workerId) usp.set('workerId', workerId)
    return `/calendar?${usp.toString()}`
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{ar.globalCalendar.title}</h1>
        <p className="text-muted-foreground text-sm">{ar.globalCalendar.subtitle}</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon-sm">
            <Link
              href={hrefFor(addMonthsUtc(reference, -1))}
              aria-label={ar.common.previous}
            >
              <ChevronRight />
            </Link>
          </Button>
          <Button asChild variant="outline" size="icon-sm">
            <Link href={hrefFor(addMonthsUtc(reference, 1))} aria-label={ar.common.next}>
              <ChevronLeft />
            </Link>
          </Button>
          <h2 className="ms-2 text-sm font-semibold tabular-nums">{title}</h2>
        </div>

        <CalendarFilters
          projectOptions={projectOptions}
          userOptions={userOptions}
          projectId={projectId}
          workerId={workerId}
        />
      </div>

      {calendar.truncated ? (
        <p className="text-fg-subtle text-xs">{ar.globalCalendar.truncatedNotice}</p>
      ) : null}

      <div className="flex flex-col overflow-hidden rounded-lg border">
        <div className="bg-surface-sunken grid grid-cols-7 border-b">
          {ar.weekdaysShort.map((label) => (
            <div
              key={label}
              className="text-fg-muted p-2 text-center text-xs font-medium"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid auto-rows-fr grid-cols-7 gap-px">
          {weeks.flatMap((week) =>
            week.map((day) => {
              const key = toDateParam(day)
              const events = byDay.get(key) ?? []
              const isToday = isSameUtcDay(day, today)
              const inMonth = day.getUTCMonth() === reference.getUTCMonth()

              return (
                <div
                  key={key}
                  className={cn(
                    'bg-card flex min-h-24 flex-col gap-1 border-b p-1.5',
                    !inMonth && 'bg-surface-sunken/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                      isToday && 'bg-accent-solid text-accent-on-solid font-semibold',
                      !isToday && !inMonth && 'text-fg-subtle',
                    )}
                  >
                    {day.getUTCDate()}
                  </span>

                  <div className="flex flex-1 flex-col gap-1">
                    {events.slice(0, MAX_PER_DAY).map((event) => (
                      <Link
                        key={event.id}
                        href={event.href}
                        // A month grid can hold a hundred events, and Next
                        // prefetches every link in the viewport. Without this
                        // the calendar fires one full detail-page render per
                        // event on arrival — the page never reaches network
                        // idle, and the cost grows with the organization's workload.
                        prefetch={false}
                        data-hue={eventHue(event)}
                        className="bg-hue-surface text-hue-text flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[0.6875rem]"
                        title={`${ar.globalCalendar.types[event.type]}: ${event.title}`}
                      >
                        <Dot hue={eventHue(event)} className="shrink-0" />
                        <span className="truncate">{event.title}</span>
                      </Link>
                    ))}
                    {events.length > MAX_PER_DAY ? (
                      <span className="text-fg-subtle px-1.5 text-[0.6875rem]">
                        {ar.common.andMore.replace(
                          '{count}',
                          String(events.length - MAX_PER_DAY),
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            }),
          )}
        </div>
      </div>
    </div>
  )
}
