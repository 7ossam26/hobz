import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DomainError, ForbiddenError, UnauthenticatedError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings'

import {
  createLeave,
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const {
  createHolidayAction,
  deleteHolidayAction,
  importHolidaysAction,
  listHolidaysAction,
  updateHolidayAction,
} = await import('@/modules/holiday/actions')
const { decideLeaveAction, requestLeaveAction } = await import('@/modules/leave/actions')
const { decideExtensionAction, requestExtensionAction } =
  await import('@/modules/extension/actions')

/**
 * docs/TESTING.md §4 axis 4, for Phase 6's server actions.
 *
 * Both halves of the phase-1 contract are asserted: a caller lacking the
 * permission must throw **and must not mutate**. An action that throws after
 * writing has still written, and `expect(...).rejects` alone would not notice.
 *
 * Two of these actions are `requireAuth` rather than `requirePermission`, and
 * that is deliberate (SPEC §6 has no key for "ask for time off" or "read the
 * agency's holidays"). What they enforce instead — whose leave, whose task —
 * is asserted here too, because that check is the whole of their security.
 */

const db = testDb()
const TYPE = SETTINGS_CATALOG['calendar.leaveTypes'].default[0]!.id
const DUE = cairo('2026-03-01T17:00')

beforeEach(() => {
  clearSessionActor()
})

async function actorWith(permissions: Parameters<typeof createUserWithPermissions>[1]) {
  await seedPermissionCatalog(db)
  return actorFor(db, (await createUserWithPermissions(db, permissions)).id)
}

describe('العطلات — calendar.manage', () => {
  const validHoliday = { date: '2026-05-01', nameAr: 'عيد العمال', isRecurring: false }

  it('يرفض الإضافة والتعديل والحذف والاستيراد بلا صلاحية ولا يكتب شيئًا', async () => {
    setSessionActor(await actorWith([]))

    await expect(createHolidayAction(validHoliday)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      updateHolidayAction({ id: 'x', ...validHoliday }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(deleteHolidayAction({ id: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      importHolidaysAction({ rows: [validHoliday], dryRun: false }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await db.holiday.count()).toBe(0)
    expect(await db.auditLog.count()).toBe(0)
  })

  it('يرفض كل شيء بلا جلسة', async () => {
    await expect(createHolidayAction(validHoliday)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    )
    await expect(listHolidaysAction({})).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('يسمح بالقراءة لأي مستخدم مسجَّل — أيام إغلاق الوكالة ليست سرًّا', async () => {
    setSessionActor(await actorWith([]))
    await expect(listHolidaysAction({})).resolves.toEqual([])
  })

  it('يسمح بالكتابة لحامل calendar.manage', async () => {
    setSessionActor(await actorWith(['calendar.manage']))
    await expect(createHolidayAction(validHoliday)).resolves.toMatchObject({
      date: '2026-05-01',
    })
  })
})

describe('الإجازات — leave.manage', () => {
  it('المنفّذ يطلب لنفسه فقط', async () => {
    const someoneElse = await createUser(db)
    const actor = await actorWith([])
    setSessionActor(actor)

    await expect(
      requestLeaveAction({
        userId: someoneElse.id,
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        typeId: TYPE,
      }),
    ).rejects.toBeInstanceOf(DomainError)

    await expect(
      requestLeaveAction({
        userId: actor.id,
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        typeId: TYPE,
      }),
    ).resolves.toMatchObject({ status: 'PENDING' })

    // The refused call wrote nothing for the other person.
    expect(await db.leave.count({ where: { userId: someoneElse.id } })).toBe(0)
  })

  it('حامل leave.manage يسجّل لغيره وتُعتمد فورًا', async () => {
    const worker = await createUser(db)
    setSessionActor(await actorWith(['leave.manage']))

    await expect(
      requestLeaveAction({
        userId: worker.id,
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        typeId: TYPE,
      }),
    ).resolves.toMatchObject({ status: 'APPROVED' })
  })

  it('البتّ في الإجازة يتطلب leave.manage ولا يغيّر الحالة بدونها', async () => {
    const worker = await createUser(db)
    const leave = await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'PENDING',
    })
    setSessionActor(await actorWith([]))

    await expect(
      decideLeaveAction({ id: leave.id, decision: 'APPROVED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const after = await db.leave.findUniqueOrThrow({ where: { id: leave.id } })
    expect(after.status).toBe('PENDING')
    expect(after.decidedById).toBeNull()
    expect(await db.auditLog.count()).toBe(0)
  })
})

describe('التمديد — task.extend', () => {
  async function taskFor(assigneeId: string) {
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    return createTask(db, {
      projectId: project.id,
      assigneeId,
      status: 'IN_PROGRESS',
      dueDate: DUE,
      originalDueDate: DUE,
    })
  }

  it('غير المنفّذ لا يطلب تمديدًا ولا يُنشئ صفًّا', async () => {
    const assignee = await createUser(db)
    const task = await taskFor(assignee.id)
    setSessionActor(await actorWith([]))

    await expect(
      requestExtensionAction({
        taskId: task.id,
        newDueDate: cairo('2026-03-05T17:00'),
        reason: 'سبب',
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(await db.extensionRequest.count()).toBe(0)
  })

  it('البتّ يتطلب task.extend ولا يحرّك الموعد بدونها', async () => {
    await seedPermissionCatalog(db)
    const assignee = await createUserWithPermissions(db, [])
    const task = await taskFor(assignee.id)

    setSessionActor(await actorFor(db, assignee.id))
    const request = await requestExtensionAction({
      taskId: task.id,
      newDueDate: cairo('2026-03-05T17:00'),
      reason: 'سبب',
    })

    setSessionActor(await actorWith([]))
    await expect(
      decideExtensionAction({ id: request.id, decision: 'APPROVED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const after = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { dueDate: true },
    })
    expect(after.dueDate).toEqual(DUE)
    expect(
      await db.extensionRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toMatchObject({ status: 'PENDING' })
  })

  it('حامل task.extend يعتمد فينتقل الموعد', async () => {
    await seedPermissionCatalog(db)
    const assignee = await createUserWithPermissions(db, [])
    const task = await taskFor(assignee.id)

    setSessionActor(await actorFor(db, assignee.id))
    const request = await requestExtensionAction({
      taskId: task.id,
      newDueDate: cairo('2026-03-05T17:00'),
      reason: 'سبب',
    })

    setSessionActor(await actorWith(['task.extend']))
    await expect(
      decideExtensionAction({ id: request.id, decision: 'APPROVED' }),
    ).resolves.toMatchObject({ status: 'APPROVED' })

    const after = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { dueDate: true, originalDueDate: true },
    })
    expect(after.dueDate).toEqual(cairo('2026-03-05T17:00'))
    expect(after.originalDueDate).toEqual(DUE)
  })
})
