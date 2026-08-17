import { describe, expect, it, vi } from 'vitest'

import {
  createLedgerEntry,
  createPayoutCycle,
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))

const { getManagerDashboard, getWorkerDashboard, isManagerAudience } = await import(
  '@/modules/dashboard/queries'
)

const db = testDb()
const NOW = cairo('2026-03-15T12:00')

/**
 * Phase 10: the manager and worker dashboards. `isManagerAudience` is the
 * routing signal (`task.view.all` or `project.view.all`); every widget below
 * that composition reuses is what these tests actually exercise.
 */

describe('isManagerAudience', () => {
  it('يعتبر صاحب task.view.all مديرًا', async () => {
    await seedPermissionCatalog(db)
    const user = await createUserWithPermissions(db, ['task.view.all'])
    expect(isManagerAudience(await actorFor(db, user.id))).toBe(true)
  })

  it('يعتبر صاحب project.view.all مديرًا', async () => {
    await seedPermissionCatalog(db)
    const user = await createUserWithPermissions(db, ['project.view.all'])
    expect(isManagerAudience(await actorFor(db, user.id))).toBe(true)
  })

  it('لا يعتبر صاحب task.view.assigned فقط مديرًا', async () => {
    await seedPermissionCatalog(db)
    const user = await createUserWithPermissions(db, ['task.view.assigned'])
    expect(isManagerAudience(await actorFor(db, user.id))).toBe(false)
  })
})

describe('getManagerDashboard — المهام المتأخرة ونطاق الرؤية', () => {
  it('يرى مدير يملك task.view.all كل المهام المتأخرة عبر كل المشاريع', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['task.view.all', 'project.view.all'])
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: manager.id })
    await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      dueDate: cairo('2026-03-01T12:00'),
    })

    setSessionActor(await actorFor(db, manager.id))
    const dashboard = await getManagerDashboard(NOW)

    expect(dashboard.overdueTasks.total).toBe(1)
    clearSessionActor()
  })

  it('لا يرى مدير محدود النطاق مهام مشروع لا يملكه أو ينتمي إليه', async () => {
    await seedPermissionCatalog(db)
    // Holds neither whole-company key — scopeTasks resolves to "assigned",
    // and this actor is neither the assignee nor a watcher of the task below.
    const limited = await createUserWithPermissions(db, ['task.view.assigned'])
    const owner = await createUser(db)
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      dueDate: cairo('2026-03-01T12:00'),
    })

    setSessionActor(await actorFor(db, limited.id))
    const dashboard = await getManagerDashboard(NOW)

    expect(dashboard.overdueTasks.total).toBe(0)
    clearSessionActor()
  })
})

describe('getManagerDashboard — الأدوات الثانوية المحمية بصلاحيات', () => {
  it('يخفي العبء الوظيفي والمستحقات والخصومات عن مدير بلا صلاحياتها', async () => {
    await seedPermissionCatalog(db)
    // task.view.all makes this a manager; none of the three secondary
    // permissions are granted.
    const manager = await createUserWithPermissions(db, ['task.view.all'])
    setSessionActor(await actorFor(db, manager.id))

    const dashboard = await getManagerDashboard(NOW)

    expect(dashboard.workload).toBeNull()
    expect(dashboard.pendingPayouts).toBeNull()
    expect(dashboard.monthDeductions).toBeNull()
    clearSessionActor()
  })

  it('يظهر العبء الوظيفي لمن يملك user.view', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['task.view.all', 'user.view'])
    await createUser(db, { isWorker: true, isActive: true })
    setSessionActor(await actorFor(db, manager.id))

    const dashboard = await getManagerDashboard(NOW)

    expect(dashboard.workload).not.toBeNull()
    expect(dashboard.workload?.length).toBeGreaterThan(0)
    clearSessionActor()
  })

  it('يظهر مستحقات الدورة لمن يملك payout.view', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['task.view.all', 'payout.view'])
    await createPayoutCycle(db, { status: 'OPEN' })
    setSessionActor(await actorFor(db, manager.id))

    const dashboard = await getManagerDashboard(NOW)

    expect(dashboard.pendingPayouts).not.toBeNull()
    clearSessionActor()
  })

  it('يظهر خصومات الشهر لمن يملك report.view', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['task.view.all', 'report.view'])
    const worker = await createUser(db)
    await createLedgerEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-30.00',
      isAutoGenerated: true,
      // Strictly before `NOW`: the report's range is `[from, to)` and this
      // dashboard passes `now` itself as `to`, so an entry timestamped
      // exactly `now` would fall outside its own window.
      createdAt: cairo('2026-03-10T09:00'),
    })
    setSessionActor(await actorFor(db, manager.id))

    const dashboard = await getManagerDashboard(NOW)

    expect(dashboard.monthDeductions).not.toBeNull()
    expect(dashboard.monthDeductions?.amount).toBe('30.00')
    clearSessionActor()
  })
})

describe('getWorkerDashboard — نطاق شخصي بلا أي مبلغ مالي', () => {
  it('يرى المنفّذ مهامه النشطة الخاصة فقط', async () => {
    await seedPermissionCatalog(db)
    const worker = await createUserWithPermissions(db, ['task.view.assigned'])
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'IN_PROGRESS',
      dueDate: cairo('2026-04-01T12:00'),
    })
    // Someone else's task — must not appear.
    const stranger = await createUser(db)
    await createTask(db, {
      projectId: project.id,
      assigneeId: stranger.id,
      status: 'IN_PROGRESS',
      dueDate: cairo('2026-04-01T12:00'),
    })

    setSessionActor(await actorFor(db, worker.id))
    const dashboard = await getWorkerDashboard(NOW)

    expect(dashboard.activeTasks.total).toBe(1)
    clearSessionActor()
  })

  it('لا يحمل الكائن الناتج أي حقل مالي — المستحقات في مستحقاتي فقط (SPEC B6/J3)', async () => {
    await seedPermissionCatalog(db)
    const worker = await createUserWithPermissions(db, ['task.view.assigned'])
    setSessionActor(await actorFor(db, worker.id))

    const dashboard = await getWorkerDashboard(NOW)

    const keys = Object.keys(dashboard)
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/earning|balance|salary|payout/)
    }
    clearSessionActor()
  })

  it('يحمل مؤشر الأداء الخاص بالمنفّذ نفسه', async () => {
    await seedPermissionCatalog(db)
    const worker = await createUserWithPermissions(db, ['task.view.assigned'])
    setSessionActor(await actorFor(db, worker.id))

    const dashboard = await getWorkerDashboard(NOW)

    expect(dashboard.performance.userId).toBe(worker.id)
    expect(dashboard.performance.taskCount).toBe(0)
    expect(dashboard.performance.score).toBe('0.0')
    clearSessionActor()
  })
})
