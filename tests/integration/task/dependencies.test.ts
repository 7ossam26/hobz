import { describe, expect, it } from 'vitest'

import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import {
  addDependency,
  getDependencyWarnings,
  removeDependency,
  startTask,
} from '@/modules/task/service'
import type { TaskStatus } from '@/modules/task/state-machine'

import {
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const NOW = cairo('2026-03-02T09:00')

/**
 * SPEC §4 and §5.1: finish-to-start dependencies "produce a **warning banner**,
 * never a block". Every test in the first block below is really one assertion
 * said twice — the call resolved, *and* the warning came back.
 */

async function fixture() {
  await seedPermissionCatalog(db)
  const manager = await createUserWithPermissions(db, ['task.edit', 'task.assign'])
  const worker = await createUserWithPermissions(db, ['task.edit'])
  const project = await createProject(db, { ownerId: manager.id })
  const actor = await actorFor(db, manager.id)
  return { manager, worker, project, actor }
}

describe('modules/task — الاعتماديات تنبّه ولا تمنع', () => {
  it('يبدأ التنفيذ رغم اعتمادية غير معتمدة ويعيد التنبيه', async () => {
    const { worker, project, actor } = await fixture()
    const blocker = await createTask(db, {
      projectId: project.id,
      title: 'التصميم المبدئي',
      status: 'IN_PROGRESS',
      assigneeId: worker.id,
    })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'ASSIGNED',
    })
    await addDependency(db, {
      actor,
      input: { taskId: task.id, dependsOnTaskId: blocker.id },
      now: NOW,
    })

    const result = await startTask(db, { actor, input: { taskId: task.id }, now: NOW })

    // Succeeded…
    expect(result.task.status).toBe('IN_PROGRESS')
    // …and said why a human should look.
    expect(result.warnings).toEqual([
      {
        taskId: blocker.id,
        title: 'التصميم المبدئي',
        status: 'IN_PROGRESS',
        projectId: project.id,
      },
    ])
  })

  it('ينبّه لكل حالة غير منتهية للاعتمادية', async () => {
    const { worker, project, actor } = await fixture()
    const unfinished: TaskStatus[] = [
      'BACKLOG',
      'ASSIGNED',
      'IN_PROGRESS',
      'SUBMITTED',
      'IN_REVIEW',
      'REVISION_REQUESTED',
      'BLOCKED',
      // A cancelled dependency still warns: the thing this task was waiting on
      // is never going to be delivered, which is exactly when a human should
      // look at it.
      'CANCELLED',
    ]

    for (const status of unfinished) {
      const blocker = await createTask(db, { projectId: project.id, status })
      const task = await createTask(db, {
        projectId: project.id,
        assigneeId: worker.id,
        status: 'ASSIGNED',
      })
      await addDependency(db, {
        actor,
        input: { taskId: task.id, dependsOnTaskId: blocker.id },
        now: NOW,
      })

      const result = await startTask(db, { actor, input: { taskId: task.id }, now: NOW })

      expect(result.task.status, `${status} must not block the start`).toBe('IN_PROGRESS')
      expect(result.warnings, `${status} must warn`).toHaveLength(1)
    }
  })

  it('لا ينبّه حين تكون الاعتمادية معتمدة أو منتهية', async () => {
    const { worker, project, actor } = await fixture()

    for (const status of ['APPROVED', 'DONE'] as TaskStatus[]) {
      const blocker = await createTask(db, { projectId: project.id, status })
      const task = await createTask(db, {
        projectId: project.id,
        assigneeId: worker.id,
        status: 'ASSIGNED',
      })
      await addDependency(db, {
        actor,
        input: { taskId: task.id, dependsOnTaskId: blocker.id },
        now: NOW,
      })

      const result = await startTask(db, { actor, input: { taskId: task.id }, now: NOW })
      expect(result.warnings, `${status} must not warn`).toEqual([])
    }
  })

  it('ينبّه بكل الاعتماديات غير المكتملة دفعة واحدة', async () => {
    const { worker, project, actor } = await fixture()
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'ASSIGNED',
    })

    for (const status of ['BACKLOG', 'IN_PROGRESS', 'DONE'] as TaskStatus[]) {
      const blocker = await createTask(db, { projectId: project.id, status })
      await addDependency(db, {
        actor,
        input: { taskId: task.id, dependsOnTaskId: blocker.id },
        now: NOW,
      })
    }

    const result = await startTask(db, { actor, input: { taskId: task.id }, now: NOW })
    expect(result.warnings).toHaveLength(2)
  })

  it('لا يعيد تنبيهًا لاعتمادية محذوفة ناعمًا', async () => {
    const { worker, project, actor } = await fixture()
    const blocker = await createTask(db, { projectId: project.id, status: 'BACKLOG' })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'ASSIGNED',
    })
    await addDependency(db, {
      actor,
      input: { taskId: task.id, dependsOnTaskId: blocker.id },
      now: NOW,
    })
    await db.task.update({ where: { id: blocker.id }, data: { deletedAt: new Date() } })

    expect(await getDependencyWarnings(db, task.id)).toEqual([])
  })

  it('يقبل اعتمادية عبر مشروع آخر', async () => {
    const { manager, worker, project, actor } = await fixture()
    const other = await createProject(db, { ownerId: manager.id, code: 'PRJ-OTHER' })
    const blocker = await createTask(db, { projectId: other.id, status: 'BACKLOG' })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'ASSIGNED',
    })

    await addDependency(db, {
      actor,
      input: { taskId: task.id, dependsOnTaskId: blocker.id },
      now: NOW,
    })

    const warnings = await getDependencyWarnings(db, task.id)
    expect(warnings[0]?.projectId).toBe(other.id)
  })
})

describe('modules/task — قيود إضافة الاعتمادية', () => {
  it('يرفض اعتماد المهمة على نفسها', async () => {
    const { project, actor } = await fixture()
    const task = await createTask(db, { projectId: project.id })

    await expect(
      addDependency(db, {
        actor,
        input: { taskId: task.id, dependsOnTaskId: task.id },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض تكرار نفس الاعتمادية', async () => {
    const { project, actor } = await fixture()
    const a = await createTask(db, { projectId: project.id })
    const b = await createTask(db, { projectId: project.id })

    await addDependency(db, {
      actor,
      input: { taskId: a.id, dependsOnTaskId: b.id },
      now: NOW,
    })

    await expect(
      addDependency(db, {
        actor,
        input: { taskId: a.id, dependsOnTaskId: b.id },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يرفض اعتمادية متبادلة بين مهمتين', async () => {
    const { project, actor } = await fixture()
    const a = await createTask(db, { projectId: project.id })
    const b = await createTask(db, { projectId: project.id })

    await addDependency(db, {
      actor,
      input: { taskId: a.id, dependsOnTaskId: b.id },
      now: NOW,
    })

    await expect(
      addDependency(db, {
        actor,
        input: { taskId: b.id, dependsOnTaskId: a.id },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  /**
   * Deeper cycles are allowed, deliberately. Warnings resolve one level deep,
   * so a cycle costs a confusing banner and never a hang — and walking the
   * graph on every write would be a real cost for a rule that never blocks.
   */
  it('يقبل حلقة أطول من مهمتين بلا توقف', async () => {
    const { project, actor } = await fixture()
    const a = await createTask(db, { projectId: project.id })
    const b = await createTask(db, { projectId: project.id })
    const c = await createTask(db, { projectId: project.id })

    await addDependency(db, {
      actor,
      input: { taskId: a.id, dependsOnTaskId: b.id },
      now: NOW,
    })
    await addDependency(db, {
      actor,
      input: { taskId: b.id, dependsOnTaskId: c.id },
      now: NOW,
    })
    await addDependency(db, {
      actor,
      input: { taskId: c.id, dependsOnTaskId: a.id },
      now: NOW,
    })

    expect(await getDependencyWarnings(db, a.id)).toHaveLength(1)
  })

  it('يرفض اعتمادية على مهمة غير موجودة', async () => {
    const { project, actor } = await fixture()
    const task = await createTask(db, { projectId: project.id })

    await expect(
      addDependency(db, {
        actor,
        input: { taskId: task.id, dependsOnTaskId: 'no-such-task' },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يزيل الاعتمادية ويسجّل الحركتين', async () => {
    const { project, actor } = await fixture()
    const a = await createTask(db, { projectId: project.id })
    const b = await createTask(db, { projectId: project.id })

    await addDependency(db, {
      actor,
      input: { taskId: a.id, dependsOnTaskId: b.id },
      now: NOW,
    })
    await removeDependency(db, {
      actor,
      input: { taskId: a.id, dependsOnTaskId: b.id },
      now: NOW,
    })

    expect(await db.taskDependency.count({ where: { taskId: a.id } })).toBe(0)
    const activity = await db.taskActivity.findMany({
      where: { taskId: a.id, type: { in: ['DEPENDENCY_ADDED', 'DEPENDENCY_REMOVED'] } },
    })
    expect(activity).toHaveLength(2)
  })

  it('يرفض إزالة اعتمادية غير موجودة', async () => {
    const { project, actor } = await fixture()
    const a = await createTask(db, { projectId: project.id })
    const b = await createTask(db, { projectId: project.id })

    await expect(
      removeDependency(db, {
        actor,
        input: { taskId: a.id, dependsOnTaskId: b.id },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
