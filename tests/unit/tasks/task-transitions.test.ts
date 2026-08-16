import { describe, expect, it, vi } from 'vitest'

import { classifyDrop } from '@/app/(app)/tasks/task-transitions'
import type { TaskPermissions } from '@/app/(app)/tasks/tasks-client'
import type { TaskStatus } from '@/modules/task/state-machine'

// `task-transitions.ts` imports the *real* named actions to build its
// direct-action table, and those live in a `'use server'` file that pulls in
// `lib/auth/session` → NextAuth → `next/server` — resolvable only inside
// Next's own bundler, not plain Vitest. `vi.mock` calls are hoisted above
// every import in this file (including the one above), so `classifyDrop`
// itself already sees the mock by the time this module finishes loading.
// Mocked for the same reason `board-view.test.tsx` mocks the same module:
// nothing under test calls through to a real server action here, only checks
// that a callable exists.
vi.mock('@/modules/task/actions', () => ({
  startTaskAction: vi.fn(),
  submitTaskAction: vi.fn(),
  reviewTaskAction: vi.fn(),
  completeTaskAction: vi.fn(),
}))

/**
 * `classifyDrop` is the entire legal/illegal decision behind a Kanban drop
 * (`board/board-view.tsx`) — pure, so this proves it without a DOM, a mouse,
 * or `dataTransfer` (which `jsdom` does not implement faithfully). The
 * component-level test (`board-view.test.tsx`) proves the same table wired
 * to real drag events; this proves the table itself is right at every edge.
 */

const ALL_PERMISSIONS: TaskPermissions = {
  canCreate: true,
  canAssign: true,
  canEdit: true,
  canApprove: true,
  canCancel: true,
  canComment: true,
  penaltyCreate: true,
  penaltyReverse: true,
}

const NO_PERMISSIONS: TaskPermissions = {
  canCreate: false,
  canAssign: false,
  canEdit: false,
  canApprove: false,
  canCancel: false,
  canComment: false,
  penaltyCreate: false,
  penaltyReverse: false,
}

describe('classifyDrop', () => {
  it('يتجاهل الإفلات في نفس العمود', () => {
    expect(classifyDrop('IN_PROGRESS', 'IN_PROGRESS', ALL_PERMISSIONS)).toEqual({
      kind: 'noop',
    })
  })

  it('يرفض الإفلات القادم من مهمة معلَّقة دائمًا', () => {
    // BLOCKED's one legal target depends on activity history a card summary
    // does not carry (SPEC §5.1 `BLOCKED → previous`) — never predictable
    // client-side, whatever the destination.
    for (const to of ['IN_PROGRESS', 'DONE', 'CANCELLED'] as TaskStatus[]) {
      expect(classifyDrop('BLOCKED', to, ALL_PERMISSIONS)).toEqual({ kind: 'illegal' })
    }
  })

  it('يرفض الإفلات القادم من حالة نهائية', () => {
    for (const from of ['DONE', 'CANCELLED'] as TaskStatus[]) {
      expect(classifyDrop(from, 'IN_PROGRESS', ALL_PERMISSIONS)).toEqual({
        kind: 'illegal',
      })
    }
  })

  it('يرفض حافة غير موجودة في آلة الحالة (BACKLOG ← IN_PROGRESS)', () => {
    // There is no ASSIGNED → BACKLOG edge (SPEC §5.1), so nothing may drop
    // onto BACKLOG at all — see `modules/task/state-machine.ts`.
    expect(classifyDrop('IN_PROGRESS', 'BACKLOG', ALL_PERMISSIONS)).toEqual({
      kind: 'illegal',
    })
  })

  it('يرفض قفزة تتخطى خطوات المسار الخطي (BACKLOG ← APPROVED)', () => {
    expect(classifyDrop('BACKLOG', 'APPROVED', ALL_PERMISSIONS)).toEqual({
      kind: 'illegal',
    })
  })

  it('يرفض إفلاتًا شرعيًا بلا صلاحية، بدل محاولته', () => {
    expect(classifyDrop('IN_PROGRESS', 'SUBMITTED', NO_PERMISSIONS)).toEqual({
      kind: 'forbidden',
    })
  })

  it.each([
    ['BACKLOG', 'ASSIGNED', 'assign'],
    ['IN_REVIEW', 'APPROVED', 'approve'],
    ['IN_REVIEW', 'REVISION_REQUESTED', 'revision'],
    ['IN_PROGRESS', 'BLOCKED', 'block'],
    ['IN_PROGRESS', 'CANCELLED', 'cancel'],
  ] as const)('يفتح حوار %s ← %s بدل التحريك المباشر', (from, to, dialogKind) => {
    expect(classifyDrop(from, to, ALL_PERMISSIONS)).toEqual({
      kind: 'dialog',
      dialogKind,
    })
  })

  it.each(['IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'DONE'] as const)(
    'يحرّك %s مباشرة بلا حوار',
    (to) => {
      const from: TaskStatus =
        to === 'IN_PROGRESS'
          ? 'ASSIGNED'
          : to === 'SUBMITTED'
            ? 'IN_PROGRESS'
            : to === 'IN_REVIEW'
              ? 'SUBMITTED'
              : 'APPROVED'

      const outcome = classifyDrop(from, to, ALL_PERMISSIONS)
      expect(outcome.kind).toBe('direct')
      if (outcome.kind === 'direct') expect(typeof outcome.run).toBe('function')
    },
  )
})
