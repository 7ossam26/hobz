import * as React from 'react'

import { Chip, type ChipProps } from '@/components/data/chip'
import { ar } from '@/i18n/ar'
import { ledgerTypeHue, projectStatusHue, taskStatusHue } from '@/lib/palette'
import type { LedgerType, ProjectStatus, TaskStatus } from '@/lib/palette'

/**
 * Status, as a chip.
 *
 * The Arabic wording is editable in Settings (SPEC §2: "Arabic labels are
 * editable in Settings; the enum values are not"), which is why `label` is an
 * override rather than the only source. Until Phase 12 wires that screen,
 * `ar.enums` is the default — and an unrecognised status still renders its
 * enum value rather than an empty chip, because a blank cell in a task list is
 * worse than an untranslated one.
 *
 * Server components. A status chip is text with a border.
 */

type LabelledChipProps = Omit<ChipProps, 'hue' | 'children'> & {
  /** Overrides the default Arabic label — pass the Settings value once it exists. */
  label?: string
}

export function StatusChip({
  status,
  label,
  ...props
}: LabelledChipProps & { status: string }) {
  return (
    <Chip hue={taskStatusHue(status)} {...props}>
      {label ?? ar.enums.taskStatus[status as TaskStatus] ?? status}
    </Chip>
  )
}

export function ProjectStatusChip({
  status,
  label,
  ...props
}: LabelledChipProps & { status: string }) {
  return (
    <Chip hue={projectStatusHue(status)} {...props}>
      {label ?? ar.enums.projectStatus[status as ProjectStatus] ?? status}
    </Chip>
  )
}

/**
 * Ledger entry type. Defined in Phase 2 rather than left to Phase 7 because
 * the hue table already exists, and one shared component is what stops
 * `PENALTY` being red on one screen and orange on another — in the product
 * whose entire promise is that the money is explainable.
 */
export function LedgerTypeChip({ type, label, ...props }: LabelledChipProps & { type: string }) {
  return (
    <Chip hue={ledgerTypeHue(type)} {...props}>
      {label ?? ar.enums.ledgerType[type as LedgerType] ?? type}
    </Chip>
  )
}
