import { RelativeTime } from '@/components/data/relative-time'
import { Avatar } from '@/components/data/user-chip'
import { ar } from '@/i18n/ar'
import { formatDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money-format'
import type { TaskActivityDto, TaskActivityKind } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

/**
 * The read-only feed SPEC §5.1 calls load-bearing, not decorative:
 * `BLOCKED → previous` and the original `submittedAt` are both recovered by
 * reading it back (`modules/task/service.ts`). Rendered here, not edited.
 *
 * `from`/`to` are opaque strings server-side by design (`TaskActivity.from`/
 * `.to`, SPEC §4) — a status, a user id, an ISO date, a money string,
 * depending on `type`. Resolving a user id to a name uses `userOptions`
 * ("the whole directory once", the same precedent the command palette and
 * `getUserOptions` already set at SPEC §2's ~100-person scale); a
 * `dependsOnTaskId` is not resolved to a title here, because doing so for an
 * activity row possibly years old would need a lookup this tab does not
 * otherwise carry — the type label alone still says what happened.
 */
function describe(entry: TaskActivityDto, users: UserOptionDto[]): string {
  const nameOf = (id: string | null) =>
    users.find((u) => u.id === id)?.fullName ?? id ?? ''

  switch (entry.type) {
    case 'STATUS_CHANGED': {
      const from = entry.from
        ? ((ar.enums.taskStatus as Record<string, string>)[entry.from] ?? entry.from)
        : ''
      const to = entry.to
        ? ((ar.enums.taskStatus as Record<string, string>)[entry.to] ?? entry.to)
        : ''
      return `${from} ← ${to}`
    }
    case 'ASSIGNED':
      return entry.from ? `${nameOf(entry.from)} ← ${nameOf(entry.to)}` : nameOf(entry.to)
    case 'WATCHER_ADDED':
    case 'WATCHER_REMOVED':
      return nameOf(entry.to)
    case 'DUE_DATE_CHANGED':
      return entry.from && entry.to
        ? `${formatDate(new Date(entry.from))} ← ${formatDate(new Date(entry.to))}`
        : ''
    case 'VALUE_CHANGED':
      return entry.from && entry.to
        ? `${formatMoney(entry.from, { withCurrency: true })} ← ${formatMoney(entry.to, { withCurrency: true })}`
        : ''
    default:
      return ''
  }
}

export function TaskActivityTab({
  activity,
  userOptions,
}: {
  activity: TaskActivityDto[]
  userOptions: UserOptionDto[]
}) {
  if (activity.length === 0) {
    return <p className="text-fg-subtle text-sm">{ar.tasks.activity.empty}</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {[...activity].reverse().map((entry) => (
        <li key={entry.id} className="flex items-start gap-2.5">
          {entry.actor ? (
            <Avatar user={entry.actor} size="sm" />
          ) : (
            <span
              aria-hidden
              className="bg-muted text-fg-subtle flex size-8 shrink-0 items-center justify-center rounded-full text-[0.625rem]"
            >
              {ar.tasks.activity.system.slice(0, 2)}
            </span>
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {entry.actor?.fullName ?? ar.tasks.activity.system}
              </span>
              <RelativeTime
                value={entry.createdAt}
                className="text-fg-subtle shrink-0 text-xs"
              />
            </div>
            <p className="text-fg-muted text-sm">
              {ar.tasks.activity.types[entry.type as TaskActivityKind]}
              {describe(entry, userOptions) ? (
                <span className="text-fg-subtle"> · {describe(entry, userOptions)}</span>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
