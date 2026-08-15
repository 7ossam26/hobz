import { describe, expect, it, vi } from 'vitest'

import { calendarFor } from '@/lib/calendar'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import {
  decideExtension,
  listExtensions,
  requestExtension,
} from '@/modules/extension/service'
import type { PenaltyPort } from '@/modules/lateness/ports'
import { computeLateness } from '@/modules/lateness/service'

import {
  createExtensionRequest,
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NEW_DUE = cairo('2026-03-05T17:00')
const NOW = cairo('2026-02-25T10:00')

async function scenario(overrides: { status?: 'IN_PROGRESS' | 'SUBMITTED' } = {}) {
  await seedPermissionCatalog(db)
  const manager = await createUserWithPermissions(db, ['task.extend'])
  const assignee = await createUser(db)
  const project = await createProject(db, { ownerId: manager.id })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: assignee.id,
    status: overrides.status ?? 'IN_PROGRESS',
    dueDate: DUE,
    originalDueDate: DUE,
    ...(overrides.status === 'SUBMITTED'
      ? { submittedAt: cairo('2026-03-04T09:00') }
      : {}),
  })

  return {
    task,
    project,
    assignee: await actorFor(db, assignee.id),
    manager: await actorFor(db, manager.id),
  }
}

describe('modules/extension — تقديم الطلب', () => {
  it('المنفّذ يطلب تمديدًا بسبب مكتوب', async () => {
    const { task, assignee } = await scenario()

    const request = await requestExtension(db, {
      actor: assignee,
      now: NOW,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'انتظار مواد من العميل' },
    })

    expect(request).toMatchObject({
      status: 'PENDING',
      oldDueDate: DUE,
      newDueDate: NEW_DUE,
      reason: 'انتظار مواد من العميل',
    })
    expect(request.requestedBy.id).toBe(assignee.id)
    expect(await db.auditLog.count({ where: { action: 'extension.requested' } })).toBe(1)
  })

  it('غير المنفّذ لا يطلب إلا إذا كان يملك task.extend', async () => {
    const { task, manager } = await scenario()
    const stranger = await actorFor(db, (await createUser(db)).id)

    await expect(
      requestExtension(db, {
        actor: stranger,
        input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
      }),
    ).rejects.toBeInstanceOf(DomainError)

    await expect(
      requestExtension(db, {
        actor: manager,
        mayRequestForOthers: true,
        input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' })
  })

  it('يرفض موعدًا ليس بعد الموعد الحالي', async () => {
    const { task, assignee } = await scenario()

    for (const candidate of [DUE, cairo('2026-02-27T17:00')]) {
      await expect(
        requestExtension(db, {
          actor: assignee,
          input: { taskId: task.id, newDueDate: candidate, reason: 'سبب' },
        }),
      ).rejects.toBeInstanceOf(DomainError)
    }
  })

  it('يرفض طلبًا ثانيًا بينما الأول قيد المراجعة', async () => {
    const { task, assignee } = await scenario()
    await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })

    await expect(
      requestExtension(db, {
        actor: assignee,
        input: { taskId: task.id, newDueDate: cairo('2026-03-09T17:00'), reason: 'آخر' },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يرفض تمديد مهمة تم تسليمها', async () => {
    const { task, assignee } = await scenario({ status: 'SUBMITTED' })

    await expect(
      requestExtension(db, {
        actor: assignee,
        input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض مهمة غير موجودة أو محذوفة ناعمًا', async () => {
    const { assignee, project } = await scenario()
    const deleted = await createTask(db, {
      projectId: project.id,
      assigneeId: assignee.id,
      status: 'IN_PROGRESS',
      deletedAt: new Date('2026-02-01T00:00:00Z'),
    })

    for (const id of ['missing', deleted.id]) {
      await expect(
        requestExtension(db, {
          actor: assignee,
          input: { taskId: id, newDueDate: NEW_DUE, reason: 'سبب' },
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    }
  })
})

describe('modules/extension — القرار', () => {
  it('الاعتماد ينقل الموعد ويحفظ الموعد الأصلي', async () => {
    const { task, assignee, manager } = await scenario()
    const request = await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })

    await decideExtension(db, {
      actor: manager,
      now: NOW,
      input: { id: request.id, decision: 'APPROVED', decisionNote: 'موافق' },
    })

    const after = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { dueDate: true, originalDueDate: true },
    })
    expect(after.dueDate).toEqual(NEW_DUE)
    // SPEC §5.3: `originalDueDate` never moves. It is the only surviving
    // record of what was first promised.
    expect(after.originalDueDate).toEqual(DUE)
  })

  it('الاعتماد يكتب سطر سجل ونشاط بتغيّر الموعد', async () => {
    const { task, assignee, manager } = await scenario()
    const request = await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })

    await decideExtension(db, {
      actor: manager,
      now: NOW,
      input: { id: request.id, decision: 'APPROVED', decisionNote: null },
    })

    const activity = await db.taskActivity.findFirst({
      where: { taskId: task.id, type: 'DUE_DATE_CHANGED' },
    })
    expect(activity).toMatchObject({
      from: DUE.toISOString(),
      to: NEW_DUE.toISOString(),
    })

    for (const action of ['extension.approved', 'task.dueDateExtended']) {
      expect(await db.auditLog.count({ where: { action } })).toBe(1)
    }
  })

  it('الرفض لا يمسّ موعد المهمة', async () => {
    const { task, assignee, manager } = await scenario()
    const request = await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })

    const decided = await decideExtension(db, {
      actor: manager,
      now: NOW,
      input: { id: request.id, decision: 'REJECTED', decisionNote: 'غير مبرر' },
    })

    expect(decided.status).toBe('REJECTED')
    const after = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { dueDate: true },
    })
    expect(after.dueDate).toEqual(DUE)
    expect(await db.taskActivity.count({ where: { type: 'DUE_DATE_CHANGED' } })).toBe(0)
  })

  it('لا يمكن البتّ مرتين', async () => {
    const { task, assignee, manager } = await scenario()
    const request = await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })

    await decideExtension(db, {
      actor: manager,
      input: { id: request.id, decision: 'APPROVED', decisionNote: null },
    })

    await expect(
      decideExtension(db, {
        actor: manager,
        input: { id: request.id, decision: 'REJECTED', decisionNote: null },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يرفض اعتماد طلب قديم بعد تحرّك الموعد', async () => {
    // A revision (SPEC T4) or a second extension moved the deadline between
    // the request and the decision. Approving would silently overwrite the
    // newer decision with a stale one.
    const { task, assignee, manager } = await scenario()
    const request = await createExtensionRequest(db, {
      taskId: task.id,
      requestedById: assignee.id,
      oldDueDate: DUE,
      newDueDate: NEW_DUE,
    })

    await db.task.update({
      where: { id: task.id },
      data: { dueDate: cairo('2026-03-03T17:00') },
    })

    await expect(
      decideExtension(db, {
        actor: manager,
        input: { id: request.id, decision: 'APPROVED', decisionNote: null },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('رفض طلب قديم مسموح — الرفض لا يكتب شيئًا على المهمة', async () => {
    const { task, assignee, manager } = await scenario()
    const request = await createExtensionRequest(db, {
      taskId: task.id,
      requestedById: assignee.id,
      oldDueDate: DUE,
      newDueDate: NEW_DUE,
    })
    await db.task.update({
      where: { id: task.id },
      data: { dueDate: cairo('2026-03-03T17:00') },
    })

    await expect(
      decideExtension(db, {
        actor: manager,
        input: { id: request.id, decision: 'REJECTED', decisionNote: null },
      }),
    ).resolves.toMatchObject({ status: 'REJECTED' })
  })
})

describe('modules/extension — السرد', () => {
  it('يسرد طلبات المهمة ويرشّح بالحالة، ضمن نطاق قراءة المهام', async () => {
    const { task, assignee, manager } = await scenario()
    const first = await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'الأول' },
    })
    await decideExtension(db, {
      actor: manager,
      input: { id: first.id, decision: 'REJECTED', decisionNote: null },
    })
    await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: cairo('2026-03-09T17:00'), reason: 'الثاني' },
    })

    const all = await listExtensions(db, {
      filters: { page: 1, pageSize: 25 },
      taskScope: {},
    })
    expect(all.total).toBe(2)
    expect(all.items[0]?.taskTitle).toBe(task.title)

    const pending = await listExtensions(db, {
      filters: { taskId: task.id, status: ['PENDING'], page: 1, pageSize: 25 },
      taskScope: {},
    })
    expect(pending.total).toBe(1)
    expect(pending.items[0]?.reason).toBe('الثاني')
  })

  it('نطاق المهام يخفي طلبات مهمة لا يراها المستخدم', async () => {
    const { task, assignee } = await scenario()
    await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })

    const scoped = await listExtensions(db, {
      filters: { page: 1, pageSize: 25 },
      taskScope: { assigneeId: 'somebody-else' },
    })
    expect(scoped.total).toBe(0)
  })

  it('لا يسرد طلبات مهمة محذوفة ناعمًا', async () => {
    const { task, assignee } = await scenario()
    await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })
    await db.task.update({
      where: { id: task.id },
      data: { deletedAt: new Date('2026-03-01T00:00:00Z') },
    })

    const page = await listExtensions(db, {
      filters: { page: 1, pageSize: 25 },
      taskScope: {},
    })
    expect(page.total).toBe(0)
  })
})

describe('modules/extension — منفذ إعادة احتساب الخصم', () => {
  it('الاعتماد يستدعي المنفذ ويسجّل الطلب قبله', async () => {
    const { task, assignee, manager } = await scenario()
    const request = await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })

    const penalty: PenaltyPort = { recompute: vi.fn(async () => {}) }

    await decideExtension(db, {
      actor: manager,
      now: NOW,
      penalty,
      input: { id: request.id, decision: 'APPROVED', decisionNote: null },
    })

    expect(penalty.recompute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskId: task.id,
        cause: 'extensionApproved',
        at: NOW,
        requestedById: manager.id,
      }),
    )

    // Recorded before the port call, so nothing raised while the port is dark
    // can evaporate before Phase 8 lands.
    const audit = await db.auditLog.findFirst({
      where: { action: 'extension.penaltyRecomputeRequested' },
    })
    expect(audit?.entityId).toBe(task.id)
  })

  it('الرفض لا يستدعي المنفذ', async () => {
    const { task, assignee, manager } = await scenario()
    const request = await requestExtension(db, {
      actor: assignee,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })

    const penalty: PenaltyPort = { recompute: vi.fn(async () => {}) }

    await decideExtension(db, {
      actor: manager,
      penalty,
      input: { id: request.id, decision: 'REJECTED', decisionNote: null },
    })

    expect(penalty.recompute).not.toHaveBeenCalled()
    expect(
      await db.auditLog.count({
        where: { action: 'extension.penaltyRecomputeRequested' },
      }),
    ).toBe(0)
  })
})

describe('modules/extension — الأثر على التأخير (SPEC §5.3)', () => {
  async function lateDaysFor(taskId: string, now: Date) {
    const row = await db.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        dueDate: true,
        originalDueDate: true,
        submittedAt: true,
        assigneeId: true,
      },
    })
    const result = await computeLateness(calendarFor(db), {
      task: { ...row, status: row.status as 'IN_PROGRESS' },
      graceHours: 0,
      now,
    })
    return result.lateWorkingDays
  }

  it('تمديد معتمد قبل الموعد يمنع أي تأخير', async () => {
    const { task, assignee, manager } = await scenario()
    const before = cairo('2026-02-26T10:00')

    const request = await requestExtension(db, {
      actor: assignee,
      now: before,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })
    await decideExtension(db, {
      actor: manager,
      now: before,
      input: { id: request.id, decision: 'APPROVED', decisionNote: null },
    })

    // Measured on the original deadline day: without the extension this task
    // would have started accruing the next morning.
    expect(await lateDaysFor(task.id, cairo('2026-03-05T12:00'))).toBe(0)
  })

  it('تمديد معتمد بعد تراكم التأخير يعيد الحساب على الموعد الجديد', async () => {
    const { task, assignee, manager } = await scenario()
    const after = cairo('2026-03-04T10:00')

    expect(await lateDaysFor(task.id, after)).toBe(3)

    const request = await requestExtension(db, {
      actor: assignee,
      now: after,
      input: { taskId: task.id, newDueDate: NEW_DUE, reason: 'سبب' },
    })
    await decideExtension(db, {
      actor: manager,
      now: after,
      input: { id: request.id, decision: 'APPROVED', decisionNote: null },
    })

    expect(await lateDaysFor(task.id, after)).toBe(0)
  })
})
