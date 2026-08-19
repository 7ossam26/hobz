import { ar } from '@/i18n/ar'
import { diffAuditEntry } from '@/modules/audit/service'
import type { AuditEntryDto } from '@/modules/audit/types'

/**
 * The before/after view.
 *
 * Only changed fields are rendered. An audit row for "edited a user" carries a
 * dozen unchanged fields alongside the one that moved, and showing all twelve
 * makes the reader hunt for the change — which defeats the point of keeping the
 * log. `diffAuditEntry` does the comparison and is unit-tested; this component
 * only paints it.
 */

function renderValue(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return ar.common.none
  if (typeof value === 'boolean') return value ? ar.common.yes : ar.common.no
  if (Array.isArray(value)) {
    return value.length === 0 ? ar.common.none : value.join(ar.common.listSeparator)
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * A diff row's tone is a datum, so it binds a hue rather than naming a colour
 * (SPEC §9). `removed` keeps `--danger-*`: it is red-the-consequence, which the
 * palette deliberately holds apart from red-the-datum.
 */
const TONE_HUE: Record<string, string> = {
  added: 'emerald',
  changed: 'amber',
}

const TONE: Record<string, string> = {
  added: 'text-hue-text',
  removed: 'text-destructive',
  changed: 'text-hue-text',
}

const LABEL: Record<string, string> = {
  added: ar.audit.added,
  removed: ar.audit.removed,
  changed: ar.audit.changed,
}

export function AuditDiff({ entry }: { entry: AuditEntryDto }) {
  const rows = diffAuditEntry(entry)

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-xs">{ar.audit.noChanges}</p>
  }

  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.field} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <dt className="font-mono text-[11px]" dir="ltr">
            {row.field}
          </dt>
          <span
            {...(TONE_HUE[row.kind] ? { 'data-hue': TONE_HUE[row.kind] } : {})}
            className={`text-[11px] ${TONE[row.kind] ?? ''}`}
          >
            {LABEL[row.kind] ?? row.kind}
          </span>
          <dd className="flex flex-wrap items-baseline gap-2 text-xs">
            {row.kind !== 'added' ? (
              <span className="text-muted-foreground line-through">
                {renderValue(row.before)}
              </span>
            ) : null}
            {row.kind !== 'removed' ? <span>{renderValue(row.after)}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
