import { describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'

import {
  createLedgerEntry,
  createPayout,
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

const {
  getMonthlyAgencySummary,
  getPayoutStatementReport,
  getProjectSummaryReport,
  getWorkerPerformanceReport,
} = await import('@/modules/report/queries')

const db = testDb()
const NOW = cairo('2026-03-15T12:00')

/**
 * Phase 10 phase brief: "Reports, all permission-gated... RBAC on every
 * report." Every function here is gated on `report.view` alone (see
 * `modules/report/queries.ts`'s module note) — never `payout.view`,
 * `project.view.*` or `user.view`, which a report reader may not hold.
 */

describe('modules/report — report.view مطلوب لكل التقارير', () => {
  it('يرفض كشف المستحقات بلا صلاحية', async () => {
    await seedPermissionCatalog(db)
    const nobody = await createUserWithPermissions(db, [])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(getPayoutStatementReport()).rejects.toBeInstanceOf(ForbiddenError)
    clearSessionActor()
  })

  it('يرفض ملخص المشاريع بلا صلاحية', async () => {
    await seedPermissionCatalog(db)
    const nobody = await createUserWithPermissions(db, [])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(getProjectSummaryReport(NOW)).rejects.toBeInstanceOf(ForbiddenError)
    clearSessionActor()
  })

  it('يرفض تقرير أداء المنفّذين بلا صلاحية', async () => {
    await seedPermissionCatalog(db)
    const nobody = await createUserWithPermissions(db, [])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(getWorkerPerformanceReport()).rejects.toBeInstanceOf(ForbiddenError)
    clearSessionActor()
  })

  it('يرفض ملخص الوكالة الشهري بلا صلاحية', async () => {
    await seedPermissionCatalog(db)
    const nobody = await createUserWithPermissions(db, [])
    setSessionActor(await actorFor(db, nobody.id))

    await expect(getMonthlyAgencySummary(undefined, NOW)).rejects.toBeInstanceOf(ForbiddenError)
    clearSessionActor()
  })

  it('يرفض كل التقارير لغير المسجَّل دخوله', async () => {
    clearSessionActor()
    await expect(getPayoutStatementReport()).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(getProjectSummaryReport(NOW)).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(getWorkerPerformanceReport()).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(
      getMonthlyAgencySummary(undefined, NOW),
    ).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('لا يحتاج تقرير كشف المستحقات إلى payout.view — report.view وحدها تكفي', async () => {
    // Regression guard: getPayoutStatementReport must go through
    // modules/payout/service's ungated listCycles/listPayouts, never through
    // the payout.view-gated getPayoutCycles query — see the module note.
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view'])
    setSessionActor(await actorFor(db, reporter.id))

    const report = await getPayoutStatementReport()
    expect(report).toEqual({ cycle: null, rows: [] })
    clearSessionActor()
  })
})

describe('modules/report — كشف المستحقات لكل دورة صرف', () => {
  it('يعيد صفوف الدورة المطلوبة مع بيانات المنفّذ', async () => {
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view'])
    const worker = await createUser(db, { fullName: 'هدى إبراهيم' })
    const cycle = await createPayoutCycle(db, {
      periodStart: cairo('2026-01-28T22:00'),
      periodEnd: cairo('2026-02-28T21:00'),
      status: 'CLOSED',
    })
    await createPayout(db, {
      userId: worker.id,
      cycleId: cycle.id,
      gross: '1000.00',
      net: '900.00',
      status: 'APPROVED',
    })
    setSessionActor(await actorFor(db, reporter.id))

    const report = await getPayoutStatementReport(cycle.id)

    expect(report.cycle?.id).toBe(cycle.id)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]?.user?.fullName).toBe('هدى إبراهيم')
    expect(report.rows[0]?.net).toBe('900.00')
    clearSessionActor()
  })

  it('بلا دورات على الإطلاق: يعيد قائمة فارغة لا خطأ', async () => {
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view'])
    setSessionActor(await actorFor(db, reporter.id))

    const report = await getPayoutStatementReport()

    expect(report.cycle).toBeNull()
    expect(report.rows).toEqual([])
    clearSessionActor()
  })
})

describe('modules/report — ملخص المشاريع', () => {
  it('يحسب الإجمالي والمكتمل والمتأخر ونسبة الإنجاز', async () => {
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view', 'project.view.all'])
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id, status: 'ACTIVE' })

    await createTask(db, {
      projectId: project.id,
      status: 'APPROVED',
      dueDate: cairo('2026-02-01T12:00'),
    })
    await createTask(db, {
      projectId: project.id,
      status: 'DONE',
      dueDate: cairo('2026-02-01T12:00'),
    })
    // Overdue: still undelivered, past due.
    await createTask(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: cairo('2026-03-01T12:00'),
    })
    // Not overdue: due in the future.
    await createTask(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: cairo('2026-06-01T12:00'),
    })

    setSessionActor(await actorFor(db, reporter.id))
    const report = await getProjectSummaryReport(NOW)

    const row = report.rows.find((r) => r.projectId === project.id)
    expect(row?.totalTasks).toBe(4)
    expect(row?.completedTasks).toBe(2)
    expect(row?.overdueTasks).toBe(1)
    expect(row?.completionPercent).toBe(50)
    clearSessionActor()
  })

  it('مشروع بلا مهام: نسبة الإنجاز صفر لا خطأ قسمة على صفر', async () => {
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view', 'project.view.all'])
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    setSessionActor(await actorFor(db, reporter.id))

    const report = await getProjectSummaryReport(NOW)

    const row = report.rows.find((r) => r.projectId === project.id)
    expect(row?.totalTasks).toBe(0)
    expect(row?.completionPercent).toBe(0)
    clearSessionActor()
  })
})

describe('modules/report — أداء المنفّذين', () => {
  it('يقرأ من ذاكرة التخزين المؤقت PerformanceScore ولا يحتسب من جديد', async () => {
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view'])
    const scored = await createUser(db, { fullName: 'كريم عادل' })
    const unscored = await createUser(db, { fullName: 'ليلى حسن' })

    await db.performanceScore.create({
      data: {
        userId: scored.id,
        score: '87.50',
        onTimeRate: '90.00',
        qualityScore: '80.00',
        volumeScore: '100.00',
        estimateAccuracy: '75.00',
        taskCount: 5,
        computedAt: cairo('2026-03-10T04:00'),
      },
    })

    setSessionActor(await actorFor(db, reporter.id))
    const report = await getWorkerPerformanceReport()

    const scoredRow = report.rows.find((r) => r.userId === scored.id)
    const unscoredRow = report.rows.find((r) => r.userId === unscored.id)

    expect(scoredRow?.score).toBe('87.5')
    expect(scoredRow?.taskCount).toBe(5)
    expect(unscoredRow?.score).toBeNull()
    expect(unscoredRow?.computedAt).toBeNull()
    clearSessionActor()
  })

  it('لا يضم منفّذين معطَّلين أو غير عاملين', async () => {
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view'])
    const inactive = await createUser(db, { isActive: false })
    const notWorker = await createUser(db, { isWorker: false })
    setSessionActor(await actorFor(db, reporter.id))

    const report = await getWorkerPerformanceReport()

    expect(report.rows.some((r) => r.userId === inactive.id)).toBe(false)
    expect(report.rows.some((r) => r.userId === notWorker.id)).toBe(false)
    clearSessionActor()
  })
})

describe('modules/report — ملخص الوكالة الشهري', () => {
  it('يحسب المهام المكتملة ونسبة الالتزام والمدفوع والخصومات لشهر بعينه', async () => {
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view'])
    const owner = await createUser(db)
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })

    await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'APPROVED',
      approvedAt: cairo('2026-03-05T10:00'),
      elapsedMinutesWorking: 0,
    })
    const late = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'DONE',
      approvedAt: cairo('2026-03-06T10:00'),
    })
    await db.task.update({ where: { id: late.id }, data: { overdueWorkingDays: 2 } })

    await createLedgerEntry(db, {
      userId: worker.id,
      type: 'PAYOUT',
      amount: '-500.00',
      createdAt: cairo('2026-03-10T09:00'),
    })
    await createLedgerEntry(db, {
      userId: worker.id,
      type: 'PENALTY',
      amount: '-50.00',
      isAutoGenerated: true,
      createdAt: cairo('2026-03-10T09:00'),
    })

    setSessionActor(await actorFor(db, reporter.id))
    const report = await getMonthlyAgencySummary('2026-03', NOW)

    expect(report.completedTasks).toBe(2)
    expect(report.onTimeRate).toBe(50)
    expect(report.totalPaid).toBe('500.00')
    expect(report.totalDeductions).toBe('50.00')
    clearSessionActor()
  })

  it('شهر بلا أي نشاط: كل الأرقام صفر', async () => {
    await seedPermissionCatalog(db)
    const reporter = await createUserWithPermissions(db, ['report.view'])
    setSessionActor(await actorFor(db, reporter.id))

    const report = await getMonthlyAgencySummary('2020-01', NOW)

    expect(report.completedTasks).toBe(0)
    expect(report.onTimeRate).toBe(0)
    expect(report.totalPaid).toBe('0.00')
    expect(report.totalDeductions).toBe('0.00')
    clearSessionActor()
  })
})
