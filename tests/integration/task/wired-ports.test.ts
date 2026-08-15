import { describe, expect, it } from 'vitest'

import { ConflictError } from '@/lib/errors'
import { scopeProjects } from '@/lib/rbac'
import { taskHealthSignals } from '@/modules/project/health'
import { listProjectsSchema } from '@/modules/project/schema'
import { listProjects } from '@/modules/project/service'
import { OPEN_TASK_STATUSES, type TaskStatus } from '@/modules/task/state-machine'
import { openTasksForUser } from '@/modules/user/open-tasks'
import { deactivateUser } from '@/modules/user/service'

import {
  createBlockActivity,
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const NOW = cairo('2026-03-10T09:00')

/**
 * The two ports earlier phases built for Phase 4 to fill, now that `Task`
 * exists. Both were shipped with their *rule* already guarded and tested
 * (Phase 1's deactivation block, Phase 3's RAG computation) against injected
 * lookups; what is new here is that the real query behind each one answers
 * correctly, without either rule being touched.
 */

const THRESHOLDS = {
  overdueTasksThreshold: 3,
  blockedDaysThreshold: 3,
  amberDaysBeforeDue: 3,
}

describe('modules/user — منع تعطيل حساب لديه مهام مفتوحة (منفذ المرحلة الأولى)', () => {
  it('يمنع التعطيل ويسمّي المهام المفتوحة', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUserWithPermissions(db, [])
    const project = await createProject(db, { ownerId: admin.id })
    await createTask(db, {
      projectId: project.id,
      title: 'مهمة مفتوحة',
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
    })
    const actor = await actorFor(db, admin.id)

    await expect(deactivateUser(db, { actor, id: worker.id })).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  it('يسمح بالتعطيل حين تكون كل المهام منتهية أو ملغاة', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.deactivate'])
    const worker = await createUserWithPermissions(db, [])
    const project = await createProject(db, { ownerId: admin.id })
    await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'DONE',
    })
    await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'CANCELLED',
    })
    const actor = await actorFor(db, admin.id)

    await deactivateUser(db, { actor, id: worker.id })

    const row = await db.user.findUniqueOrThrow({ where: { id: worker.id } })
    expect(row.isActive).toBe(false)
  })

  it('يعتبر كل حالة غير نهائية مهمة مفتوحة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, [])
    const worker = await createUserWithPermissions(db, [])
    const project = await createProject(db, { ownerId: owner.id })

    for (const status of OPEN_TASK_STATUSES) {
      await createTask(db, { projectId: project.id, assigneeId: worker.id, status })
    }

    const open = await openTasksForUser(db, worker.id)
    expect(open).toHaveLength(OPEN_TASK_STATUSES.length)
  })

  it('لا يحتسب مهمة يتابعها فقط ولا مهمة على مشروع محذوف', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, [])
    const worker = await createUserWithPermissions(db, [])
    const live = await createProject(db, { ownerId: owner.id })
    const dead = await createProject(db, { ownerId: owner.id, code: 'PRJ-DEAD' })

    await createTask(db, {
      projectId: live.id,
      status: 'IN_PROGRESS',
      watcherIds: [worker.id],
    })
    await createTask(db, {
      projectId: dead.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
    })
    await db.project.update({ where: { id: dead.id }, data: { deletedAt: new Date() } })

    expect(await openTasksForUser(db, worker.id)).toEqual([])
  })

  it('لا يحتسب مهمة محذوفة ناعمًا', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, [])
    const worker = await createUserWithPermissions(db, [])
    const project = await createProject(db, { ownerId: owner.id })
    await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      deletedAt: new Date(),
    })

    expect(await openTasksForUser(db, worker.id)).toEqual([])
  })
})

describe('modules/project — إشارات صحة المشروع من المهام (منفذ المرحلة الثالثة)', () => {
  it('يحتسب المهام المتأخرة غير المسلَّمة فقط', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, [])
    const project = await createProject(db, { ownerId: owner.id })
    const past = cairo('2026-03-01T17:00')

    for (const status of ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS'] as TaskStatus[]) {
      await createTask(db, { projectId: project.id, status, dueDate: past })
    }
    // Delivered — the reviewer's queue is not the worker's problem (SPEC §5.3).
    await createTask(db, {
      projectId: project.id,
      status: 'IN_REVIEW',
      dueDate: past,
    })
    await createTask(db, { projectId: project.id, status: 'DONE', dueDate: past })

    const signals = await taskHealthSignals(NOW)(db, project.id)
    expect(signals.overdueTaskCount).toBe(3)
  })

  it('يقيس أطول مدة تعليق من سجل المهمة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, [])
    const project = await createProject(db, { ownerId: owner.id })

    const recent = await createTask(db, { projectId: project.id, status: 'BLOCKED' })
    await createBlockActivity(db, {
      taskId: recent.id,
      from: 'IN_PROGRESS',
      at: cairo('2026-03-08T09:00'),
    })
    const old = await createTask(db, { projectId: project.id, status: 'BLOCKED' })
    await createBlockActivity(db, {
      taskId: old.id,
      from: 'ASSIGNED',
      at: cairo('2026-03-01T09:00'),
    })

    const signals = await taskHealthSignals(NOW)(db, project.id)
    expect(signals.maxBlockedDays).toBe(9)
  })

  it('يعطي صفرًا لمشروع بلا مهام', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, [])
    const project = await createProject(db, { ownerId: owner.id })

    expect(await taskHealthSignals(NOW)(db, project.id)).toEqual({
      overdueTaskCount: 0,
      maxBlockedDays: 0,
      adminEscalationCount: 0,
    })
  })

  /**
   * The reason Phase 3's `healthWhereFragment` had to go: RED now has a cause
   * that no `WHERE` clause can express, and a facet filtering on the old SQL
   * would have disagreed with the badge on the row beside it.
   */
  it('يرشّح قائمة المشاريع على الأحمر الناتج عن المهام المتأخرة وحدها', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const actor = await actorFor(db, owner.id)
    const future = cairo('2026-12-01T17:00')
    const past = cairo('2026-03-01T17:00')

    // Not past its own due date — GREEN by dates alone…
    const sick = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-SICK',
      dueDate: future,
    })
    // …but four overdue tasks, one past the threshold of three.
    for (let i = 0; i < 4; i += 1) {
      await createTask(db, {
        projectId: sick.id,
        status: 'IN_PROGRESS',
        dueDate: past,
      })
    }
    await createProject(db, { ownerId: owner.id, code: 'PRJ-WELL', dueDate: future })

    const page = await listProjects(db, {
      scope: scopeProjects(actor),
      filters: listProjectsSchema.parse({ health: ['RED'] }),
      now: NOW,
      thresholds: THRESHOLDS,
      taskHealthLookup: taskHealthSignals(NOW),
    })

    expect(page.items.map((p) => p.code)).toEqual(['PRJ-SICK'])
    expect(page.total).toBe(1)
  })

  it('يحترم التقدير اليدوي فوق الإشارات المحتسبة في الترشيح', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const actor = await actorFor(db, owner.id)
    const past = cairo('2026-03-01T17:00')

    const overridden = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-OVERRIDE',
      dueDate: past,
      healthOverride: 'GREEN',
      healthReason: 'العميل مدرك للتأخير',
    })
    await createTask(db, {
      projectId: overridden.id,
      status: 'IN_PROGRESS',
      dueDate: past,
    })

    const red = await listProjects(db, {
      scope: scopeProjects(actor),
      filters: listProjectsSchema.parse({ health: ['RED'] }),
      now: NOW,
      thresholds: THRESHOLDS,
      taskHealthLookup: taskHealthSignals(NOW),
    })
    const green = await listProjects(db, {
      scope: scopeProjects(actor),
      filters: listProjectsSchema.parse({ health: ['GREEN'] }),
      now: NOW,
      thresholds: THRESHOLDS,
      taskHealthLookup: taskHealthSignals(NOW),
    })

    expect(red.total).toBe(0)
    expect(green.items.map((p) => p.code)).toEqual(['PRJ-OVERRIDE'])
  })
})
