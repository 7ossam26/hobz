// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BoardView } from '@/app/(app)/tasks/board/board-view'
import type { TaskPermissions } from '@/app/(app)/tasks/tasks-client'
import { ar } from '@/i18n/ar'
import type { TaskBoardDto } from '@/modules/task/queries'
import { TASK_STATUSES } from '@/modules/task/state-machine'
import type { TaskSummaryDto } from '@/modules/task/types'
import { fireEvent, render, screen, waitFor, within } from '@tests/helpers/render'

/**
 * Component-level proof of the Phase 5 drag interaction: illegal drops snap
 * back with a toast, legal ones move the card before the server answers
 * (CLAUDE.md: "no layout shift on optimistic update"), a server rejection
 * rolls the move back, and the columns sit in the DOM in pipeline order —
 * which is what makes RTL mirror them correctly (`board/board-column.tsx`'s
 * doc comment), a claim `tests/unit/design/palette-contrast.test.ts` proves
 * the same way Phase 1's e2e suite proved a physical-vs-logical border bug:
 * by asserting the computed fact, not by eyeballing a screenshot.
 *
 * The exhaustive legal/illegal/permission matrix lives in
 * `task-transitions.test.ts` against the pure `classifyDrop` this component
 * calls; this file proves the wiring around it, not the table itself again.
 */

const { startTaskAction, toastSpy } = vi.hoisted(() => ({
  startTaskAction: vi.fn(),
  toastSpy: vi.fn(),
}))

vi.mock('@/components/shared/toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn() }),
}))

// One module mock covers every named action `task-transitions.ts` and
// `transition-dialogs.tsx` import — including `'use server'`-only modules
// (`next/headers`, a live Prisma client) that must never actually load in a
// unit test.
vi.mock('@/modules/task/actions', () => ({
  startTaskAction: (...args: unknown[]) => startTaskAction(...args),
  submitTaskAction: vi.fn(),
  reviewTaskAction: vi.fn(),
  completeTaskAction: vi.fn(),
  approveTaskAction: vi.fn(),
  assignTaskAction: vi.fn(),
  blockTaskAction: vi.fn(),
  cancelTaskAction: vi.fn(),
  requestRevisionAction: vi.fn(),
  unblockTaskAction: vi.fn(),
}))

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

function buildTask(
  overrides: Partial<TaskSummaryDto> & { id: string; title: string },
): TaskSummaryDto {
  return {
    projectId: 'p1',
    projectName: 'مشروع تجريبي',
    projectCode: 'PRJ-0001',
    milestoneId: null,
    status: 'ASSIGNED',
    priority: 'MEDIUM',
    categoryId: 'design',
    assignee: null,
    taskValue: '500.00',
    estimatedHours: '8.00',
    dueDate: new Date('2026-08-20T00:00:00Z'),
    isOverdue: false,
    ...overrides,
  }
}

function buildBoard(tasks: TaskSummaryDto[]): TaskBoardDto {
  const byStatus = new Map(
    TASK_STATUSES.map((status) => [status, [] as TaskSummaryDto[]]),
  )
  for (const task of tasks) byStatus.get(task.status)?.push(task)
  return {
    columns: TASK_STATUSES.map((status) => ({
      status,
      tasks: byStatus.get(status) ?? [],
    })),
    truncated: false,
  }
}

function renderBoard(
  tasks: TaskSummaryDto[],
  overrides: { onMutated?: () => void } = {},
) {
  return render(
    <BoardView
      board={buildBoard(tasks)}
      userOptions={[]}
      permissions={ALL_PERMISSIONS}
      onOpenTask={vi.fn()}
      onQuickCreate={vi.fn()}
      onMutated={overrides.onMutated ?? vi.fn()}
    />,
  )
}

function dataTransferStub() {
  return { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() }
}

function dragCardTo(cardTitle: string, columnLabel: string) {
  const card = screen.getByText(cardTitle).closest('[role="button"]') as HTMLElement
  const column = screen.getByLabelText(columnLabel)
  const dataTransfer = dataTransferStub()
  fireEvent.dragStart(card, { dataTransfer })
  fireEvent.dragOver(column, { dataTransfer })
  fireEvent.drop(column, { dataTransfer })
  fireEvent.dragEnd(card, { dataTransfer })
}

beforeEach(() => {
  startTaskAction.mockReset()
  toastSpy.mockClear()
})

describe('BoardView — drag and drop', () => {
  it('يرفض إفلاتًا غير شرعي، يُبقي البطاقة في عمودها، ويعرض رسالة عربية', () => {
    renderBoard([buildTask({ id: 't1', title: 'مهمة أ', status: 'BACKLOG' })])

    dragCardTo('مهمة أ', ar.enums.taskStatus.DONE)

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: ar.tasks.board.illegalDrop, tone: 'error' }),
    )
    expect(startTaskAction).not.toHaveBeenCalled()
    const backlogColumn = screen.getByLabelText(ar.enums.taskStatus.BACKLOG)
    expect(within(backlogColumn).getByText('مهمة أ')).toBeInTheDocument()
  })

  it('يحرّك البطاقة فورًا عند إفلات شرعي مباشر، قبل أن يردّ الخادم', async () => {
    startTaskAction.mockImplementation(() => new Promise(() => {})) // never resolves
    renderBoard([buildTask({ id: 't1', title: 'مهمة ب', status: 'ASSIGNED' })])

    dragCardTo('مهمة ب', ar.enums.taskStatus.IN_PROGRESS)

    const inProgressColumn = screen.getByLabelText(ar.enums.taskStatus.IN_PROGRESS)
    expect(within(inProgressColumn).getByText('مهمة ب')).toBeInTheDocument()
    expect(startTaskAction).toHaveBeenCalledWith({ id: 't1' })
  })

  it('ينجح الإفلات الشرعي: الخادم يوافق فيُستدعى onMutated', async () => {
    startTaskAction.mockResolvedValueOnce({})
    const onMutated = vi.fn()
    renderBoard([buildTask({ id: 't1', title: 'مهمة ت', status: 'ASSIGNED' })], {
      onMutated,
    })

    dragCardTo('مهمة ت', ar.enums.taskStatus.IN_PROGRESS)

    await waitFor(() => expect(onMutated).toHaveBeenCalled())
  })

  it('يُرجع البطاقة لعمودها الأصلي عند رفض الخادم، مع رسالة خطأ', async () => {
    startTaskAction.mockRejectedValueOnce(new Error('server said no'))
    renderBoard([buildTask({ id: 't1', title: 'مهمة ث', status: 'ASSIGNED' })])

    dragCardTo('مهمة ث', ar.enums.taskStatus.IN_PROGRESS)

    // Optimistic move happens first...
    expect(
      within(screen.getByLabelText(ar.enums.taskStatus.IN_PROGRESS)).getByText('مهمة ث'),
    ).toBeInTheDocument()

    // ...then rolls back once the rejection is known.
    await waitFor(() => {
      expect(
        within(screen.getByLabelText(ar.enums.taskStatus.ASSIGNED)).getByText('مهمة ث'),
      ).toBeInTheDocument()
    })
    expect(
      within(screen.getByLabelText(ar.enums.taskStatus.IN_PROGRESS)).queryByText(
        'مهمة ث',
      ),
    ).not.toBeInTheDocument()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: ar.errors.unexpected, tone: 'error' }),
    )
  })
})

describe('BoardView — RTL column order', () => {
  it('يرسم الأعمدة بترتيب مسار الحالة في DOM، وهو ما يجعل dir="rtl" يعرضها من اليمين لليسار تلقائيًا', () => {
    const { container } = renderBoard([])
    const statuses = [...container.querySelectorAll('[data-status]')].map((el) =>
      el.getAttribute('data-status'),
    )
    expect(statuses).toEqual([...TASK_STATUSES])
  })
})
