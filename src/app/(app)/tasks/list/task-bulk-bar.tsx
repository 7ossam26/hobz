import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'

/** Appears above the table the moment a row is selected; gone at zero. */
export function TaskBulkBar({
  count,
  onClear,
  canAssign,
  canEdit,
  onAssign,
  onPriority,
  onDueDate,
}: {
  count: number
  onClear: () => void
  canAssign: boolean
  canEdit: boolean
  onAssign: () => void
  onPriority: () => void
  onDueDate: () => void
}) {
  if (count === 0) return null

  return (
    <div
      data-hue="sky"
      className="bg-hue-surface flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <span className="text-hue-text font-medium tabular-nums">
        {ar.table.selectedCount.replace('{count}', String(count))}
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        <X />
        {ar.common.clearSelection}
      </Button>

      <div className="ms-auto flex items-center gap-2">
        {canAssign ? (
          <Button type="button" variant="outline" size="sm" onClick={onAssign}>
            {ar.tasks.list.bulkAssign}
          </Button>
        ) : null}
        {canEdit ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onPriority}>
              {ar.tasks.list.bulkPriority}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDueDate}>
              {ar.tasks.list.bulkDueDate}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
