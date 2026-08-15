import { describe, expect, it } from 'vitest'

import { calendarFor } from '@/lib/calendar'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings'
import { computeLateness } from '@/modules/lateness/service'
import {
  decideLeave,
  findOverlappingLeave,
  leaveWarningsForWindow,
  listLeave,
  rangesOverlap,
  requestLeave,
} from '@/modules/leave/service'

import {
  createLeave,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

/** Read from the catalog, never typed in (docs/TESTING.md §5). */
const LEAVE_TYPES = SETTINGS_CATALOG['calendar.leaveTypes'].default
const TYPE = LEAVE_TYPES[0]!.id

const NOW = cairo('2026-02-20T09:00')

async function worker() {
  return createUser(db, { isWorker: true })
}

async function approver() {
  await seedPermissionCatalog(db)
  return actorFor(db, (await createUserWithPermissions(db, ['leave.manage'])).id)
}

describe('rangesOverlap', () => {
  it('يكشف التداخل بكل أشكاله', () => {
    expect(rangesOverlap('2026-03-01', '2026-03-05', '2026-03-05', '2026-03-09')).toBe(
      true,
    )
    expect(rangesOverlap('2026-03-01', '2026-03-05', '2026-02-20', '2026-03-01')).toBe(
      true,
    )
    expect(rangesOverlap('2026-03-01', '2026-03-05', '2026-03-02', '2026-03-03')).toBe(
      true,
    )
    expect(rangesOverlap('2026-03-01', '2026-03-05', '2026-02-01', '2026-04-01')).toBe(
      true,
    )
  })

  it('لا يعتبر النطاقين المتلاصقين متداخلين', () => {
    // Inclusive ranges: ending on the 5th and starting on the 6th touch but do
    // not overlap.
    expect(rangesOverlap('2026-03-01', '2026-03-05', '2026-03-06', '2026-03-09')).toBe(
      false,
    )
  })
})

describe('modules/leave — الطلب والتسجيل', () => {
  it('المنفّذ يطلب إجازة فتُنشأ قيد المراجعة', async () => {
    const user = await worker()
    const actor = await actorFor(db, user.id)

    const leave = await requestLeave(db, {
      actor,
      now: NOW,
      leaveTypes: LEAVE_TYPES,
      input: {
        userId: user.id,
        startDate: '2026-03-02',
        endDate: '2026-03-04',
        typeId: TYPE,
        note: null,
      },
    })

    expect(leave).toMatchObject({
      status: 'PENDING',
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      totalDays: 3,
    })
    expect(leave.decidedBy).toBeNull()
    expect(await db.auditLog.count({ where: { action: 'leave.requested' } })).toBe(1)
  })

  it('المدير يسجّل إجازة لمنفّذ فتُعتمد فورًا', async () => {
    const user = await worker()
    const actor = await approver()

    const leave = await requestLeave(db, {
      actor,
      now: NOW,
      leaveTypes: LEAVE_TYPES,
      autoApprove: true,
      input: {
        userId: user.id,
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        typeId: TYPE,
        note: 'مرض',
      },
    })

    expect(leave.status).toBe('APPROVED')
    expect(leave.totalDays).toBe(1)
    expect(leave.decidedBy?.id).toBe(actor.id)
    expect(leave.decidedAt).toEqual(NOW)
    expect(await db.auditLog.count({ where: { action: 'leave.recorded' } })).toBe(1)
  })

  it('يرفض نوع إجازة غير موجود في الإعدادات', async () => {
    const user = await worker()
    const actor = await actorFor(db, user.id)

    await expect(
      requestLeave(db, {
        actor,
        leaveTypes: LEAVE_TYPES,
        input: {
          userId: user.id,
          startDate: '2026-03-02',
          endDate: '2026-03-02',
          typeId: 'not-a-type',
          note: null,
        },
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض تسجيل إجازة لحساب معطّل أو محذوف', async () => {
    const actor = await approver()
    const inactive = await createUser(db, { isActive: false })
    const deleted = await createUser(db, { deletedAt: new Date('2026-01-01T00:00:00Z') })

    const input = {
      startDate: '2026-03-02',
      endDate: '2026-03-02',
      typeId: TYPE,
      note: null,
    }

    await expect(
      requestLeave(db, {
        actor,
        leaveTypes: LEAVE_TYPES,
        input: { ...input, userId: inactive.id },
      }),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      requestLeave(db, {
        actor,
        leaveTypes: LEAVE_TYPES,
        input: { ...input, userId: deleted.id },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/leave — كشف التداخل', () => {
  it('يرفض طلبًا يتداخل مع إجازة معتمدة', async () => {
    const user = await worker()
    const actor = await actorFor(db, user.id)
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-06',
      status: 'APPROVED',
    })

    await expect(
      requestLeave(db, {
        actor,
        leaveTypes: LEAVE_TYPES,
        input: {
          userId: user.id,
          startDate: '2026-03-05',
          endDate: '2026-03-09',
          typeId: TYPE,
          note: null,
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يرفض طلبًا يتداخل مع طلب آخر قيد المراجعة', async () => {
    const user = await worker()
    const actor = await actorFor(db, user.id)
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-06',
      status: 'PENDING',
    })

    await expect(
      requestLeave(db, {
        actor,
        leaveTypes: LEAVE_TYPES,
        input: {
          userId: user.id,
          startDate: '2026-03-06',
          endDate: '2026-03-06',
          typeId: TYPE,
          note: null,
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('الإجازة المرفوضة لا تمنع طلبًا جديدًا على نفس الأيام', async () => {
    const user = await worker()
    const actor = await actorFor(db, user.id)
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-06',
      status: 'REJECTED',
    })

    const leave = await requestLeave(db, {
      actor,
      leaveTypes: LEAVE_TYPES,
      input: {
        userId: user.id,
        startDate: '2026-03-02',
        endDate: '2026-03-06',
        typeId: TYPE,
        note: null,
      },
    })

    expect(leave.status).toBe('PENDING')
  })

  it('إجازة منفّذ آخر على نفس الأيام لا تتعارض', async () => {
    const first = await worker()
    const second = await worker()
    const actor = await actorFor(db, second.id)
    await createLeave(db, {
      userId: first.id,
      startDate: '2026-03-02',
      endDate: '2026-03-06',
      status: 'APPROVED',
    })

    await expect(
      requestLeave(db, {
        actor,
        leaveTypes: LEAVE_TYPES,
        input: {
          userId: second.id,
          startDate: '2026-03-02',
          endDate: '2026-03-06',
          typeId: TYPE,
          note: null,
        },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' })
  })

  it('يرفض اعتماد الثاني من طلبين متداخلين قيد المراجعة', async () => {
    const user = await worker()
    const actor = await approver()
    const first = await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'PENDING',
    })
    // Created directly: the request path would have refused the overlap, and
    // the point here is the *approval* path's own re-check.
    const second = await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-04',
      endDate: '2026-03-06',
      status: 'PENDING',
    })

    await decideLeave(db, {
      actor,
      now: NOW,
      input: { id: first.id, decision: 'APPROVED', decisionNote: null },
    })

    await expect(
      decideLeave(db, {
        actor,
        now: NOW,
        input: { id: second.id, decision: 'APPROVED', decisionNote: null },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('رفض الطلب الثاني المتداخل مسموح — الرفض لا يطالب بأيام', async () => {
    const user = await worker()
    const actor = await approver()
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'APPROVED',
    })
    const second = await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-03',
      endDate: '2026-03-06',
      status: 'PENDING',
    })

    await expect(
      decideLeave(db, {
        actor,
        now: NOW,
        input: { id: second.id, decision: 'REJECTED', decisionNote: 'مغطاة بالفعل' },
      }),
    ).resolves.toMatchObject({ status: 'REJECTED' })
  })

  it('findOverlappingLeave يتجاهل الصف المستثنى', async () => {
    const user = await worker()
    const leave = await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'APPROVED',
    })

    await expect(
      findOverlappingLeave(db, {
        userId: user.id,
        startDate: '2026-03-02',
        endDate: '2026-03-04',
        excludeId: leave.id,
      }),
    ).resolves.toBeNull()
  })
})

describe('modules/leave — الاعتماد والرفض', () => {
  it('الاعتماد يسجّل صاحب القرار ووقته وسطر تدقيق', async () => {
    const user = await worker()
    const actor = await approver()
    const leave = await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'PENDING',
    })

    const decided = await decideLeave(db, {
      actor,
      now: NOW,
      input: { id: leave.id, decision: 'APPROVED', decisionNote: 'موافق' },
    })

    expect(decided).toMatchObject({ status: 'APPROVED', decisionNote: 'موافق' })
    expect(decided.decidedBy?.id).toBe(actor.id)
    expect(decided.decidedAt).toEqual(NOW)

    const audit = await db.auditLog.findFirst({ where: { action: 'leave.approved' } })
    expect(audit?.reason).toBe('موافق')
  })

  it('لا يمكن البتّ مرتين', async () => {
    const user = await worker()
    const actor = await approver()
    const leave = await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'PENDING',
    })

    await decideLeave(db, {
      actor,
      now: NOW,
      input: { id: leave.id, decision: 'APPROVED', decisionNote: null },
    })

    await expect(
      decideLeave(db, {
        actor,
        now: NOW,
        input: { id: leave.id, decision: 'REJECTED', decisionNote: null },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يرفض البتّ في إجازة غير موجودة', async () => {
    const actor = await approver()
    await expect(
      decideLeave(db, {
        actor,
        input: { id: 'missing', decision: 'APPROVED', decisionNote: null },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/leave — الأثر على التقويم والتأخير', () => {
  const DUE = cairo('2026-03-01T17:00')
  const SUBMITTED = cairo('2026-03-05T09:00')

  async function lateDays(userId: string) {
    const result = await computeLateness(calendarFor(db), {
      task: {
        id: 'task-1',
        status: 'SUBMITTED',
        dueDate: DUE,
        originalDueDate: DUE,
        submittedAt: SUBMITTED,
        assigneeId: userId,
        blockedIntervals: [],
      },
      graceHours: 0,
      now: cairo('2026-03-31T12:00'),
    })
    return result.lateWorkingDays
  }

  it('الإجازة المعتمدة وحدها هي التي تُسقط أيام التأخير', async () => {
    const user = await worker()

    // Monday to Wednesday, which is every working day between the deadline and
    // the delivery except the Thursday.
    const pending = await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'PENDING',
    })

    expect(await lateDays(user.id)).toBe(4)

    await db.leave.update({ where: { id: pending.id }, data: { status: 'REJECTED' } })
    expect(await lateDays(user.id)).toBe(4)

    await db.leave.update({ where: { id: pending.id }, data: { status: 'APPROVED' } })
    expect(await lateDays(user.id)).toBe(1)
  })

  it('إجازة منفّذ آخر لا تُسقط شيئًا', async () => {
    const user = await worker()
    const other = await worker()
    await createLeave(db, {
      userId: other.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'APPROVED',
    })

    expect(await lateDays(user.id)).toBe(4)
  })
})

describe('modules/leave — تحذير الإسناد', () => {
  it('يعيد الإجازات المعتمدة المتداخلة مع نافذة المهمة', async () => {
    const user = await worker()
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'APPROVED',
    })

    const warnings = await leaveWarningsForWindow(db, {
      userId: user.id,
      from: cairo('2026-03-01T09:00'),
      to: cairo('2026-03-10T17:00'),
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ startDate: '2026-03-02', endDate: '2026-03-04' })
  })

  it('لا يعيد إجازة انتهت قبل النافذة ولا واحدة قيد المراجعة', async () => {
    const user = await worker()
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-01-02',
      endDate: '2026-01-04',
      status: 'APPROVED',
    })
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      status: 'PENDING',
    })

    await expect(
      leaveWarningsForWindow(db, {
        userId: user.id,
        from: cairo('2026-03-01T09:00'),
        to: cairo('2026-03-10T17:00'),
      }),
    ).resolves.toEqual([])
  })

  it('نافذة مقلوبة تعطي قائمة فارغة بدل أن تفشل', async () => {
    const user = await worker()
    await expect(
      leaveWarningsForWindow(db, {
        userId: user.id,
        from: cairo('2026-03-10T09:00'),
        to: cairo('2026-03-01T09:00'),
      }),
    ).resolves.toEqual([])
  })
})

describe('modules/leave — السرد والنطاق', () => {
  it('يقصر السرد على المنفّذ نفسه عند غياب صلاحية العرض', async () => {
    const mine = await worker()
    const theirs = await worker()
    await createLeave(db, {
      userId: mine.id,
      startDate: '2026-03-02',
      endDate: '2026-03-02',
    })
    await createLeave(db, {
      userId: theirs.id,
      startDate: '2026-03-03',
      endDate: '2026-03-03',
    })

    const own = await listLeave(db, {
      filters: { page: 1, pageSize: 25 },
      scope: { userId: mine.id },
    })
    expect(own.total).toBe(1)
    expect(own.items[0]?.user.id).toBe(mine.id)

    const all = await listLeave(db, { filters: { page: 1, pageSize: 25 }, scope: {} })
    expect(all.total).toBe(2)
  })

  it('يرشّح بالتداخل مع نافذة زمنية لا ببداية الإجازة', async () => {
    const user = await worker()
    // Starts before the window and ends inside it — very much in the window.
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-02-25',
      endDate: '2026-03-02',
    })

    const page = await listLeave(db, {
      filters: { from: '2026-03-01', to: '2026-03-31', page: 1, pageSize: 25 },
      scope: {},
    })

    expect(page.total).toBe(1)
  })
})
