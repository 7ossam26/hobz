import {
  completeTaskAction,
  reviewTaskAction,
  startTaskAction,
  submitTaskAction,
} from '@/modules/task/actions'
import { canTransition, isFinal, type TaskStatus } from '@/modules/task/state-machine'

import type { TaskPermissions } from './tasks-client'

/**
 * Which of SPEC §5.1's ten statuses need a dialog to land in, and which of
 * the plain ones a board drop or a status-control click can fire directly —
 * shared by the Kanban board (`board/board-view.tsx`) and the detail sheet's
 * status control (`sheet/task-status-control.tsx`) so a transition looks and
 * behaves identically wherever it is made. There is no generic
 * `transitionTaskAction`: every entry below calls one of the *named* action
 * wrappers `modules/task/actions.ts` exports, because a bare `{taskId, to}`
 * from the client would let it construct any edge, including ones that need
 * a rating or a reason the server cannot invent.
 */

export type TransitionDialogKind = 'assign' | 'approve' | 'revision' | 'block' | 'cancel'

export const TRANSITION_DIALOG_TARGETS: Partial<
  Record<TaskStatus, TransitionDialogKind>
> = {
  ASSIGNED: 'assign',
  APPROVED: 'approve',
  REVISION_REQUESTED: 'revision',
  BLOCKED: 'block',
  CANCELLED: 'cancel',
}

export const TRANSITION_DIRECT_ACTIONS: Partial<
  Record<TaskStatus, (id: string) => Promise<unknown>>
> = {
  IN_PROGRESS: (id) => startTaskAction({ id }),
  SUBMITTED: (id) => submitTaskAction({ id }),
  IN_REVIEW: (id) => reviewTaskAction({ id }),
  DONE: (id) => completeTaskAction({ id }),
}

/**
 * SPEC §6, restated for the client the way `modules/task/service.ts`'s
 * `TRANSITION_PERMISSION` states it server-side — not imported from there,
 * because `service.ts` pulls in Prisma and `lib/audit`, which must never
 * reach a `'use client'` bundle. This table only decides whether to *attempt*
 * a transition and which toast to show; the server re-checks every one of
 * these permissions regardless (`requirePermission`, CLAUDE.md invariant 3),
 * so a stale entry here could make the UI feel wrong but never grant
 * anything.
 */
export const TRANSITION_PERMISSION: Record<TaskStatus, keyof TaskPermissions> = {
  BACKLOG: 'canEdit',
  ASSIGNED: 'canAssign',
  IN_PROGRESS: 'canWork',
  SUBMITTED: 'canWork',
  IN_REVIEW: 'canEdit',
  REVISION_REQUESTED: 'canApprove',
  APPROVED: 'canApprove',
  DONE: 'canApprove',
  BLOCKED: 'canWork',
  CANCELLED: 'canCancel',
}

export type DropOutcome =
  | { kind: 'noop' }
  | { kind: 'illegal' }
  | { kind: 'forbidden' }
  | { kind: 'dialog'; dialogKind: TransitionDialogKind }
  | { kind: 'direct'; run: (id: string) => Promise<unknown> }

/**
 * The one function every drag-and-drop decision runs through — pure, so it is
 * testable without a DOM, a mouse, or `dataTransfer` (none of which `jsdom`
 * implements faithfully). `board/board-view.tsx`'s `onDrop` handler is a thin
 * wrapper: call this, then act on the result.
 *
 * `from === 'BLOCKED'` and a final `from` are both `'illegal'` here rather
 * than throwing or asserting — `BoardColumn` already refuses to make either
 * draggable, so a caller only reaches this branch if something upstream
 * disagreed with that, and "illegal" is the correct, safe answer either way.
 */
export function classifyDrop(
  from: TaskStatus,
  to: TaskStatus,
  permissions: TaskPermissions,
): DropOutcome {
  if (from === to) return { kind: 'noop' }
  if (isFinal(from) || from === 'BLOCKED') return { kind: 'illegal' }
  if (!canTransition(from, to)) return { kind: 'illegal' }
  if (!permissions[TRANSITION_PERMISSION[to]]) return { kind: 'forbidden' }

  const dialogKind = TRANSITION_DIALOG_TARGETS[to]
  if (dialogKind) return { kind: 'dialog', dialogKind }

  const run = TRANSITION_DIRECT_ACTIONS[to]
  // Unreachable given the two tables above are complementary over every
  // non-BACKLOG status, and BACKLOG is never a legal `to` (nothing produces
  // it as an edge target outside `BLOCKED → previous`, already excluded
  // above) — kept as `'illegal'` rather than a thrown assertion so a future
  // status added to one table and not the other fails soft, as a rejected
  // drop, not a crash.
  return run ? { kind: 'direct', run } : { kind: 'illegal' }
}
