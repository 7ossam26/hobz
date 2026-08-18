import { describe, expect, it } from 'vitest'

import type { HealthThresholds } from '@/modules/project/health'

import {
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

const THRESHOLDS: HealthThresholds = {
  overdueTasksThreshold: 3,
  blockedDaysThreshold: 3,
  amberDaysBeforeDue: 3,
}

const NOW = cairo('2026-08-16T10:00')

/**
 * Phase brief item 4: "Daily manager digest … overdue tasks, tasks awaiting
 * approval, at-risk projects." Each count is asserted against a scenario built
 * to have an unambiguous, hand-countable answer — the same reason the money
 * modules' tests never assert on a rounded intermediate.
 */
describe('modules/notification/digest — تجميع الملخص', () => {
  it('يحسب المهام المتأخرة والمنتظرة للاعتماد والمشاريع المتعثرة', async () => {
    const { buildManagerDigest } = await import('@/modules/notification/digest')
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.view.all'])
    const project = await createProject(db, {
      ownerId: manager.id,
      dueDate: cairo('2026-09-01T00:00'),
    })
    // Already past its due date — RED by `computeProjectHealth` alone, no
    // task signals needed.
    await createProject(db, { ownerId: manager.id, dueDate: cairo('2026-08-01T00:00') })

    // Two overdue tasks (the job-maintained column, set directly — the
    // nightly `calendar.recomputeSchedule` job is what writes it in
    // production; this test is about the digest reading it, not about that
    // job).
    const overdue1 = await createTask(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
    })
    const overdue2 = await createTask(db, { projectId: project.id, status: 'ASSIGNED' })
    await db.task.updateMany({
      where: { id: { in: [overdue1.id, overdue2.id] } },
      data: { overdueWorkingDays: 2 },
    })

    // One task awaiting approval.
    await createTask(db, { projectId: project.id, status: 'IN_REVIEW' })

    // A DONE task must never count as overdue or awaiting, regardless of its
    // stale `overdueWorkingDays` — it is a terminal status.
    const done = await createTask(db, { projectId: project.id, status: 'DONE' })
    await db.task.update({ where: { id: done.id }, data: { overdueWorkingDays: 9 } })

    const summary = await buildManagerDigest(db, {
      now: NOW,
      healthThresholds: THRESHOLDS,
    })

    expect(summary.overdueCount).toBe(2)
    expect(summary.awaitingApprovalCount).toBe(1)
    // The past-due project is RED; `project` above is not yet due — GREEN.
    expect(summary.atRiskProjectCount).toBe(1)
  })

  it('لا يحتسب مشروعًا مؤرشفًا أو ملغى ضمن المتعثرة', async () => {
    const { buildManagerDigest } = await import('@/modules/notification/digest')
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.view.all'])
    await createProject(db, {
      ownerId: manager.id,
      status: 'ARCHIVED',
      dueDate: cairo('2026-01-01T00:00'),
    })

    const summary = await buildManagerDigest(db, {
      now: NOW,
      healthThresholds: THRESHOLDS,
    })

    expect(summary.atRiskProjectCount).toBe(0)
  })
})

describe('modules/notification/digest — التسليم', () => {
  it('يسلّم إشعارًا واحدًا لكل مدير (project.view.all) ويتجاهل غير المدير', async () => {
    const { deliverManagerDigest } = await import('@/modules/notification/digest')
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.view.all'])
    const worker = await createUserWithPermissions(db, ['task.view.assigned'])

    const outcome = await deliverManagerDigest(db, {
      now: NOW,
      healthThresholds: THRESHOLDS,
    })

    expect(outcome.recipients).toBe(1)
    expect(outcome.delivered).toBe(1)
    expect(
      await db.notification.count({
        where: { userId: manager.id, type: 'MANAGER_DIGEST' },
      }),
    ).toBe(1)
    expect(
      await db.notification.count({
        where: { userId: worker.id, type: 'MANAGER_DIGEST' },
      }),
    ).toBe(0)
  })

  it('لا يكرر التسليم في نفس اليوم القاهري (idempotent)', async () => {
    const { deliverManagerDigest } = await import('@/modules/notification/digest')
    await seedPermissionCatalog(db)
    await createUserWithPermissions(db, ['project.view.all'])

    const first = await deliverManagerDigest(db, {
      now: NOW,
      healthThresholds: THRESHOLDS,
    })
    const second = await deliverManagerDigest(db, {
      now: cairo('2026-08-16T18:00'),
      healthThresholds: THRESHOLDS,
    })

    expect(first.delivered).toBe(1)
    expect(second.delivered).toBe(0)
  })

  it('يسلّم من جديد في يوم قاهري مختلف', async () => {
    const { deliverManagerDigest } = await import('@/modules/notification/digest')
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.view.all'])

    await deliverManagerDigest(db, { now: NOW, healthThresholds: THRESHOLDS })
    await deliverManagerDigest(db, {
      now: cairo('2026-08-17T10:00'),
      healthThresholds: THRESHOLDS,
    })

    expect(
      await db.notification.count({
        where: { userId: manager.id, type: 'MANAGER_DIGEST' },
      }),
    ).toBe(2)
  })
})
