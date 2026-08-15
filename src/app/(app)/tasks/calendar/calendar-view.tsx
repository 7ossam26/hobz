'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { Dot } from '@/components/data/chip'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { taskStatusHue } from '@/lib/palette'
import { cn } from '@/lib/utils'
import type { TaskCalendarDto } from '@/modules/task/queries'
import type { TaskSummaryDto } from '@/modules/task/types'

import {
  addDays,
  addMonthsUtc,
  isSameUtcDay,
  monthGridRange,
  startOfUtcDay,
  toDateParam,
  weekRange,
} from './date-grid'

const MAX_PER_DAY = 3

function groupByDay(items: TaskSummaryDto[]): Map<string, TaskSummaryDto[]> {
  const map = new Map<string, TaskSummaryDto[]>()
  for (const task of items) {
    const key = toDateParam(task.dueDate)
    const bucket = map.get(key)
    if (bucket) bucket.push(task)
    else map.set(key, [task])
  }
  return map
}

/**
 * Month + week. The one timeline view SPEC §5's phase brief allows — no
 * Gantt — so it is deliberately a calendar and nothing more: click a task,
 * get the detail sheet, same as every other view.
 */
export function CalendarView({
  data,
  mode,
  referenceIso,
  onOpenTask,
}: {
  data: TaskCalendarDto
  mode: 'month' | 'week'
  referenceIso: string
  onOpenTask: (id: string) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const reference = new Date(referenceIso)
  const today = startOfUtcDay(new Date())
  const byDay = React.useMemo(() => groupByDay(data.items), [data.items])

  const weeks =
    mode === 'month' ? monthGridRange(reference).weeks : [weekRange(reference).days]

  function navigate(next: { mode?: 'month' | 'week'; date?: Date }) {
    const usp = new URLSearchParams(searchParams)
    if (next.mode) usp.set('cm', next.mode)
    if (next.date) usp.set('cd', toDateParam(next.date))
    router.push(`${pathname}?${usp.toString()}`, { scroll: false })
  }

  function step(delta: number) {
    const date =
      mode === 'month' ? addMonthsUtc(reference, delta) : addDays(reference, delta * 7)
    navigate({ date })
  }

  const title =
    mode === 'month'
      ? `${ar.months[reference.getUTCMonth()]} ${reference.getUTCFullYear()}`
      : `${ar.months[weeks[0]?.[0]?.getUTCMonth() ?? reference.getUTCMonth()]} ${reference.getUTCFullYear()}`

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={ar.tasks.calendarView.previousPeriod}
            onClick={() => step(-1)}
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={ar.tasks.calendarView.nextPeriod}
            onClick={() => step(1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate({ date: today })}
          >
            {ar.tasks.calendarView.today}
          </Button>
          <h2 className="ms-2 text-sm font-semibold tabular-nums">{title}</h2>
        </div>

        <div
          role="tablist"
          className="bg-surface-sunken flex items-center gap-0.5 rounded-lg border p-0.5"
        >
          {(['month', 'week'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => navigate({ mode: value })}
              className={cn(
                'h-7 rounded-md px-3 text-xs font-medium transition-colors',
                mode === value ? 'bg-card text-foreground shadow-sm' : 'text-fg-muted',
              )}
            >
              {ar.tasks.calendarView[value]}
            </button>
          ))}
        </div>
      </div>

      {data.truncated ? (
        <p className="text-fg-subtle text-xs">
          {ar.tasks.truncatedNotice.replace('{count}', '1000')}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
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

        <div
          className={cn(
            'grid flex-1 grid-cols-7 gap-px overflow-y-auto',
            mode === 'month' ? 'auto-rows-fr' : 'auto-rows-[minmax(8rem,1fr)]',
          )}
        >
          {weeks.flatMap((week) =>
            week.map((day) => {
              const key = toDateParam(day)
              const tasks = byDay.get(key) ?? []
              const isToday = isSameUtcDay(day, today)
              const inMonth =
                mode === 'week' || day.getUTCMonth() === reference.getUTCMonth()

              return (
                <div
                  key={key}
                  className={cn(
                    'bg-card flex flex-col gap-1 border-b p-1.5',
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
                    {tasks.slice(0, MAX_PER_DAY).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onOpenTask(task.id)}
                        data-hue={taskStatusHue(task.status)}
                        className="bg-hue-surface text-hue-text flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-start text-[0.6875rem]"
                        title={task.title}
                      >
                        <Dot hue={taskStatusHue(task.status)} className="shrink-0" />
                        <span className="truncate">{task.title}</span>
                      </button>
                    ))}
                    {tasks.length > MAX_PER_DAY ? (
                      <span className="text-fg-subtle px-1.5 text-[0.6875rem]">
                        {ar.tasks.calendarView.moreOnDay.replace(
                          '{count}',
                          String(tasks.length - MAX_PER_DAY),
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
