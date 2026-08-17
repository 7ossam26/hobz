import { CapacityBar } from '@/components/data/capacity-bar'
import { ar } from '@/i18n/ar'
import type { UserOptionDto } from '@/modules/user/queries'

/**
 * Workload/capacity (phase brief §"Workload/capacity"): "shown as a bar per
 * worker with over-capacity warning on the assignment screen." Shared by
 * every dialog that assigns a task — `AssignDialog`, `ReassignDialog`,
 * `TaskQuickCreateDialog` — so the warning reads identically wherever a
 * manager picks someone.
 *
 * `userOptions` already carries `utilisationPercent`/`overCapacity`
 * (`modules/user/queries.ts`'s `getUserOptions`), computed server-side — no
 * extra request fires when a selection changes.
 */
export function AssigneeCapacityHint({
  userOptions,
  assigneeId,
}: {
  userOptions: UserOptionDto[]
  assigneeId: string
}) {
  if (!assigneeId) return null
  const user = userOptions.find((option) => option.id === assigneeId)
  if (!user) return null

  return (
    <div className="flex flex-col gap-1.5">
      <CapacityBar utilisationPercent={user.utilisationPercent} />
      {user.overCapacity ? (
        <p data-hue="red" className="text-hue-text text-xs">
          {ar.workload.overCapacityWarning}
        </p>
      ) : null}
    </div>
  )
}
