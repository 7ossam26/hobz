'use client'

import { ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { DateText } from '@/components/data/date-text'
import { MilestoneStatusChip } from '@/components/data/status-chip'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'
import {
  deleteMilestoneAction,
  reorderMilestonesAction,
} from '@/modules/milestone/actions'
import type { MilestoneDto } from '@/modules/milestone/types'

import { ProjectMilestoneDialog } from './project-milestone-dialog'

/**
 * Drag-to-reorder (SPEC §4). Native HTML5 drag events — no dependency, the
 * same "hand-written over a library" call Phase 2 made for the rest of the
 * component set. Because native drag has no keyboard story, every row also
 * carries up/down buttons that do the exact same reorder, so the feature
 * is not mouse-only.
 */
export function ProjectTimelineTab({
  projectId,
  milestones,
  canEdit,
}: {
  projectId: string
  milestones: MilestoneDto[]
  canEdit: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [items, setItems] = React.useState(milestones)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dialogTarget, setDialogTarget] = React.useState<MilestoneDto | null | 'new'>(
    null,
  )
  const [deleting, setDeleting] = React.useState<MilestoneDto | null>(null)

  // Reconcile with the server-refreshed list after any mutation, but never
  // fight a reorder that is still in flight against the previous snapshot.
  React.useEffect(() => {
    if (!pending) setItems(milestones)
  }, [milestones, pending])

  function persistOrder(next: MilestoneDto[]) {
    const previous = items
    setItems(next)
    startTransition(async () => {
      try {
        await reorderMilestonesAction({ projectId, orderedIds: next.map((m) => m.id) })
        toast({ title: ar.projects.milestones.reordered, tone: 'success' })
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
        setItems(previous)
      }
    })
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    persistOrder(next)
  }

  function onDrop(targetIndex: number) {
    if (dragId === null) return
    const fromIndex = items.findIndex((m) => m.id === dragId)
    setDragId(null)
    if (fromIndex === -1 || fromIndex === targetIndex) return
    const next = [...items]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(targetIndex, 0, moved!)
    persistOrder(next)
  }

  function confirmDelete() {
    if (!deleting) return
    startTransition(async () => {
      try {
        await deleteMilestoneAction({ id: deleting.id })
        toast({ title: ar.projects.milestones.deleted, tone: 'success' })
        setDeleting(null)
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{ar.projects.milestones.title}</h3>
        {canEdit ? (
          <Button size="sm" onClick={() => setDialogTarget('new')}>
            <Plus />
            {ar.projects.milestones.add}
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={ar.projects.milestones.empty}
          className="py-8"
          action={
            canEdit ? (
              <Button onClick={() => setDialogTarget('new')}>
                {ar.projects.milestones.emptyAction}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((milestone, index) => (
            <li
              key={milestone.id}
              draggable={canEdit}
              onDragStart={() => setDragId(milestone.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(index)}
              className={cn(
                'flex items-center gap-2 rounded-md border p-2 transition-opacity',
                dragId === milestone.id && 'opacity-50',
              )}
            >
              {canEdit ? (
                <span
                  aria-label={ar.projects.milestones.dragHandle}
                  className="text-fg-subtle cursor-grab"
                >
                  <GripVertical className="size-4" aria-hidden />
                </span>
              ) : null}

              <span className="text-fg-subtle w-5 shrink-0 text-center text-xs tabular-nums">
                {index + 1}
              </span>
              <span className="flex-1 truncate text-sm font-medium">
                {milestone.name}
              </span>
              <MilestoneStatusChip status={milestone.status} size="sm" />
              <DateText
                value={milestone.dueDate}
                variant="short"
                className="text-fg-muted w-24 text-end text-xs"
              />

              {canEdit ? (
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === 0 || pending}
                    aria-label={ar.projects.milestones.moveUp}
                    title={ar.projects.milestones.moveUp}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === items.length - 1 || pending}
                    aria-label={ar.projects.milestones.moveDown}
                    title={ar.projects.milestones.moveDown}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={ar.common.edit}
                    title={ar.common.edit}
                    onClick={() => setDialogTarget(milestone)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:text-destructive"
                    aria-label={ar.common.delete}
                    title={ar.common.delete}
                    onClick={() => setDeleting(milestone)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ProjectMilestoneDialog
        open={dialogTarget !== null}
        onClose={() => setDialogTarget(null)}
        projectId={projectId}
        milestone={dialogTarget === 'new' ? null : dialogTarget}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={ar.projects.milestones.deleteTitle}
        description={ar.projects.milestones.deleteDescription}
        confirmLabel={ar.common.delete}
        busy={pending}
      />
    </div>
  )
}
