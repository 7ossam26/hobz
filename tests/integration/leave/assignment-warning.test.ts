import { describe, expect, it } from 'vitest'

import { SETTINGS_CATALOG } from '@/lib/settings'
import { prismaLeaveLookup } from '@/modules/leave/lookup'
import { assignTask, createTask } from '@/modules/task/service'

import {
  createLeave,
  createProject,
  createUser,
  createTask as seedTask,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * The phase brief: "a warning (not a block) when assigning a task that falls
 * inside approved leave."
 *
 * Both words carry weight, and both are asserted here. **Warning**: the caller
 * gets the leave back and the audit log records that the manager was told.
 * **Not a block**: the assignment lands regardless — the منفّذ is on the task,
 * the status moved, and nothing threw. Somebody assigning work to a person on
 * leave usually made a mistake and occasionally did it deliberately, and the
 * system is not in a position to know which.
 */

const db = testDb()
const NOW = cairo('2026-03-01T09:00')
const DUE = cairo('2026-03-10T17:00')
const CATEGORIES = SETTINGS_CATALOG['tasks.categories'].default

async function fixture() {
  const owner = await createUser(db)
  const worker = await createUser(db)
  const project = await createProject(db, { ownerId: owner.id })
  return { owner: await actorFor(db, owner.id), worker, project }
}

describe('إسناد مهمة خلال إجازة معتمدة', () => {
  it('يحذّر ولا يمنع', async () => {
    const { owner, worker, project } = await fixture()
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-04',
      endDate: '2026-03-08',
      status: 'APPROVED',
    })
    const task = await seedTask(db, { projectId: project.id, dueDate: DUE })

    const result = await assignTask(db, {
      actor: owner,
      now: NOW,
      leave: prismaLeaveLookup,
      input: { taskId: task.id, assigneeId: worker.id, taskValue: null },
    })

    expect(result.leaveWarnings).toHaveLength(1)
    expect(result.leaveWarnings[0]).toMatchObject({
      userId: worker.id,
      startDate: '2026-03-04',
      endDate: '2026-03-08',
    })

    // Not a block: the assignment stands.
    expect(result.task.assignee?.id).toBe(worker.id)
    expect(result.task.status).toBe('ASSIGNED')
  })

  it('يسجّل التحذير في سجل التدقيق', async () => {
    const { owner, worker, project } = await fixture()
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-04',
      endDate: '2026-03-08',
      status: 'APPROVED',
    })
    const task = await seedTask(db, { projectId: project.id, dueDate: DUE })

    await assignTask(db, {
      actor: owner,
      now: NOW,
      leave: prismaLeaveLookup,
      input: { taskId: task.id, assigneeId: worker.id, taskValue: null },
    })

    // "Who was warned and assigned anyway" is a question a manager will be
    // asked one day; it is an indexed lookup on `action`, not a JSON scan.
    const audit = await db.auditLog.findFirst({
      where: { action: 'task.assignedDuringLeave' },
    })
    expect(audit?.entityId).toBe(task.id)
  })

  it('لا يحذّر من إجازة قيد المراجعة أو مرفوضة', async () => {
    const { owner, worker, project } = await fixture()
    for (const status of ['PENDING', 'REJECTED'] as const) {
      await createLeave(db, {
        userId: worker.id,
        startDate: status === 'PENDING' ? '2026-03-04' : '2026-03-06',
        endDate: status === 'PENDING' ? '2026-03-05' : '2026-03-07',
        status,
      })
    }
    const task = await seedTask(db, { projectId: project.id, dueDate: DUE })

    const result = await assignTask(db, {
      actor: owner,
      now: NOW,
      leave: prismaLeaveLookup,
      input: { taskId: task.id, assigneeId: worker.id, taskValue: null },
    })

    expect(result.leaveWarnings).toEqual([])
    expect(
      await db.auditLog.count({ where: { action: 'task.assignedDuringLeave' } }),
    ).toBe(0)
  })

  it('لا يحذّر من إجازة خارج نافذة المهمة', async () => {
    const { owner, worker, project } = await fixture()
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      status: 'APPROVED',
    })
    const task = await seedTask(db, { projectId: project.id, dueDate: DUE })

    const result = await assignTask(db, {
      actor: owner,
      now: NOW,
      leave: prismaLeaveLookup,
      input: { taskId: task.id, assigneeId: worker.id, taskValue: null },
    })

    expect(result.leaveWarnings).toEqual([])
  })

  it('مهمة متأخرة تسأل عن اليوم نفسه — "هو مريض الآن" يصل للمدير', async () => {
    const { owner, worker, project } = await fixture()
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-01',
      endDate: '2026-03-02',
      status: 'APPROVED',
    })
    // Deadline already behind us: the window collapses to today, and today is
    // exactly what a manager reassigning an overdue task needs to know about.
    const task = await seedTask(db, {
      projectId: project.id,
      dueDate: cairo('2026-02-20T17:00'),
    })

    const result = await assignTask(db, {
      actor: owner,
      now: NOW,
      leave: prismaLeaveLookup,
      input: { taskId: task.id, assigneeId: worker.id, taskValue: null },
    })

    expect(result.leaveWarnings).toHaveLength(1)
  })

  it('الإنشاء مع منفّذ يحذّر أيضًا — الإنشاء بإسناد هو إسناد', async () => {
    const { owner, worker, project } = await fixture()
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-04',
      endDate: '2026-03-08',
      status: 'APPROVED',
    })

    const result = await createTask(db, {
      actor: owner,
      now: NOW,
      categories: CATEGORIES,
      leave: prismaLeaveLookup,
      input: {
        projectId: project.id,
        title: 'مهمة جديدة',
        description: null,
        milestoneId: null,
        priority: 'MEDIUM',
        categoryId: CATEGORIES[0]!.id,
        estimatedHours: 4,
        dueDate: DUE,
        assigneeId: worker.id,
        taskValue: null,
        watcherIds: [],
      },
    })

    expect(result.leaveWarnings).toHaveLength(1)
    expect(result.task.status).toBe('ASSIGNED')
  })

  it('بلا منفذ إجازات لا تُصدر تحذيرات أصلًا', async () => {
    const { owner, worker, project } = await fixture()
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-04',
      endDate: '2026-03-08',
      status: 'APPROVED',
    })
    const task = await seedTask(db, { projectId: project.id, dueDate: DUE })

    // The default port answers "nothing to warn about", which is what a caller
    // with no leave module wired in must get — never a fabricated warning.
    const result = await assignTask(db, {
      actor: owner,
      now: NOW,
      input: { taskId: task.id, assigneeId: worker.id, taskValue: null },
    })

    expect(result.leaveWarnings).toEqual([])
  })
})
