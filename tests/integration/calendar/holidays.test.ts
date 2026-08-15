import { describe, expect, it } from 'vitest'

import { calendarFor, snapshotCalendarSource } from '@/lib/calendar'
import { ConflictError, NotFoundError } from '@/lib/errors'
import {
  createHoliday,
  deleteHoliday,
  holidayKeysForYear,
  importHolidays,
  isHolidayCovered,
  listHolidays,
  updateHoliday,
} from '@/modules/holiday/service'

import {
  createHoliday as seedHoliday,
  createLeave,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { HOLIDAYS_2026 } from '../../fixtures/holidays-2026'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

async function manager() {
  await seedPermissionCatalog(db)
  return actorFor(db, (await createUserWithPermissions(db, ['calendar.manage'])).id)
}

describe('modules/holiday — إدارة العطلات', () => {
  it('يضيف عطلة ويكتب سطر تدقيق', async () => {
    const actor = await manager()

    const holiday = await createHoliday(db, {
      actor,
      input: { date: '2026-01-07', nameAr: 'عيد الميلاد المجيد', isRecurring: true },
    })

    expect(holiday).toMatchObject({
      date: '2026-01-07',
      nameAr: 'عيد الميلاد المجيد',
      isRecurring: true,
    })

    const audit = await db.auditLog.findMany({ where: { action: 'holiday.created' } })
    expect(audit).toHaveLength(1)
    expect(audit[0]?.entityId).toBe(holiday.id)
  })

  it('يرفض عطلة على يوم مسجَّل بالفعل', async () => {
    const actor = await manager()
    await createHoliday(db, {
      actor,
      input: { date: '2026-05-01', nameAr: 'عيد العمال', isRecurring: false },
    })

    await expect(
      createHoliday(db, {
        actor,
        input: { date: '2026-05-01', nameAr: 'تكرار', isRecurring: false },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يرفض عطلة يغطيها يوم متكرر في سنة أخرى', async () => {
    // The unique index cannot catch this: the two rows carry different dates.
    // Coverage — "is this day already a holiday?" — is the real question.
    const actor = await manager()
    await createHoliday(db, {
      actor,
      input: { date: '2026-01-07', nameAr: 'عيد الميلاد المجيد', isRecurring: true },
    })

    await expect(
      createHoliday(db, {
        actor,
        input: { date: '2028-01-07', nameAr: 'عيد الميلاد 2028', isRecurring: false },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يسمح بتعديل العطلة على تاريخها نفسه', async () => {
    const actor = await manager()
    const holiday = await createHoliday(db, {
      actor,
      input: { date: '2026-05-01', nameAr: 'عيد العمال', isRecurring: false },
    })

    const updated = await updateHoliday(db, {
      actor,
      input: {
        id: holiday.id,
        date: '2026-05-01',
        nameAr: 'عيد العمال المجيد',
        isRecurring: true,
      },
    })

    expect(updated.nameAr).toBe('عيد العمال المجيد')
    expect(updated.isRecurring).toBe(true)
  })

  it('يحذف العطلة حذفًا فعليًا', async () => {
    const actor = await manager()
    const holiday = await createHoliday(db, {
      actor,
      input: { date: '2026-05-01', nameAr: 'عيد العمال', isRecurring: false },
    })

    await deleteHoliday(db, { actor, id: holiday.id })

    expect(await db.holiday.count()).toBe(0)
    // Hard delete, not soft: a leftover row that one query forgot to filter
    // would keep being a day off.
    expect(await db.auditLog.count({ where: { action: 'holiday.deleted' } })).toBe(1)
  })

  it('يرفض تعديل أو حذف عطلة غير موجودة', async () => {
    const actor = await manager()
    await expect(deleteHoliday(db, { actor, id: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      updateHoliday(db, {
        actor,
        input: { id: 'missing', date: '2026-05-01', nameAr: 'x', isRecurring: false },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/holiday — التكرار السنوي', () => {
  it('العطلة المتكررة تغطي كل سنة', async () => {
    await seedHoliday(db, { date: '2026-01-07', isRecurring: true })

    for (const year of [2026, 2027, 2030]) {
      expect(await isHolidayCovered(db, `${year}-01-07`)).toBe(true)
      expect(await isHolidayCovered(db, `${year}-01-08`)).toBe(false)
    }
  })

  it('العطلة غير المتكررة تغطي سنتها وحدها', async () => {
    await seedHoliday(db, { date: '2026-03-20', isRecurring: false })

    expect(await isHolidayCovered(db, '2026-03-20')).toBe(true)
    expect(await isHolidayCovered(db, '2027-03-20')).toBe(false)
  })

  it('العطلة المتكررة في 29 فبراير تظهر في السنوات الكبيسة فقط', async () => {
    await seedHoliday(db, { date: '2028-02-29', isRecurring: true })

    expect(await holidayKeysForYear(db, 2028)).toContain('2028-02-29')
    // `2026-02-29` is not a date, so expanding the recurrence into 2026 must
    // produce nothing rather than a phantom day off.
    expect(await holidayKeysForYear(db, 2026)).toEqual([])
  })

  it('يسرد أيام السنة مع توسيع التكرار', async () => {
    await seedHoliday(db, { date: '2026-01-07', isRecurring: true })
    await seedHoliday(db, { date: '2026-03-20', isRecurring: false })

    expect(await holidayKeysForYear(db, 2026)).toEqual(['2026-01-07', '2026-03-20'])
    expect(await holidayKeysForYear(db, 2027)).toEqual(['2027-01-07'])
  })

  it('السرد بالسنة يشمل الصفوف المتكررة المخزَّنة تحت سنة أخرى', async () => {
    await seedHoliday(db, { date: '2020-01-07', isRecurring: true })
    const rows = await listHolidays(db, { year: 2026 })
    expect(rows.map((r) => r.date)).toEqual(['2020-01-07'])
  })
})

describe('modules/holiday — مسار الاستيراد', () => {
  const rows = HOLIDAYS_2026.slice(0, 5).map((h) => ({
    date: h.date,
    nameAr: h.nameAr,
    isRecurring: false,
  }))

  it('التشغيل التجريبي لا يكتب شيئًا', async () => {
    const actor = await manager()

    const result = await importHolidays(db, { actor, input: { rows, dryRun: true } })

    expect(result).toMatchObject({ dryRun: true, created: rows.length, skipped: 0 })
    expect(result.issues).toEqual([])
    expect(await db.holiday.count()).toBe(0)
  })

  it('التأكيد يكتب الصفوف الصالحة ويسجّل التدقيق', async () => {
    const actor = await manager()

    const result = await importHolidays(db, { actor, input: { rows, dryRun: false } })

    expect(result.created).toBe(rows.length)
    expect(await db.holiday.count()).toBe(rows.length)
    expect(await db.auditLog.count({ where: { action: 'holiday.imported' } })).toBe(1)
  })

  it('يتخطى الأيام المسجَّلة ولا يستبدلها', async () => {
    const actor = await manager()
    await seedHoliday(db, { date: rows[0]!.date, nameAr: 'الاسم الأصلي' })

    const result = await importHolidays(db, { actor, input: { rows, dryRun: false } })

    expect(result).toMatchObject({ created: rows.length - 1, skipped: 1 })
    const kept = await db.holiday.findFirst({
      where: { date: new Date(`${rows[0]!.date}T00:00:00.000Z`) },
      select: { nameAr: true },
    })
    expect(kept?.nameAr).toBe('الاسم الأصلي')
  })

  it('يبلّغ عن التكرار داخل الملف نفسه بدل حذفه بصمت', async () => {
    const actor = await manager()

    const result = await importHolidays(db, {
      actor,
      input: {
        rows: [
          { date: '2026-05-01', nameAr: 'عيد العمال', isRecurring: false },
          { date: '2026-05-01', nameAr: 'عيد العمال مكرر', isRecurring: false },
        ],
        dryRun: false,
      },
    })

    expect(result.created).toBe(1)
    expect(result.issues).toEqual([
      { row: 2, date: '2026-05-01', reason: 'duplicateInFile' },
    ])
  })
})

describe('modules/holiday — الصفوف غير الصالحة في الاستيراد', () => {
  it('يبلّغ عن تاريخ غير صالح واسم فارغ بدل رفض الملف كله', async () => {
    const actor = await manager()

    // The Zod schema catches both of these at the action boundary; the service
    // re-checks because it is callable directly (Phase 11's `.xlsx` path will
    // call it with rows it parsed itself), and a bad row must be *reported*
    // rather than take the whole import down.
    const result = await importHolidays(db, {
      actor,
      input: {
        rows: [
          { date: '2026-02-30', nameAr: 'يوم غير موجود', isRecurring: false },
          { date: '2026-05-01', nameAr: '   ', isRecurring: false },
          { date: '2026-05-01', nameAr: 'عيد العمال', isRecurring: false },
        ],
        dryRun: false,
      },
    })

    expect(result.created).toBe(1)
    expect(result.issues).toEqual([
      { row: 1, date: '2026-02-30', reason: 'invalidDate' },
      { row: 2, date: '2026-05-01', reason: 'nameRequired' },
    ])
    expect(await db.holiday.count()).toBe(1)
  })

  it('لا يكتب سطر تدقيق عندما لا ينجح أي صف', async () => {
    const actor = await manager()
    await seedHoliday(db, { date: '2026-05-01' })

    const result = await importHolidays(db, {
      actor,
      input: {
        rows: [{ date: '2026-05-01', nameAr: 'مكرر', isRecurring: false }],
        dryRun: false,
      },
    })

    expect(result).toMatchObject({ created: 0, skipped: 1 })
    expect(await db.auditLog.count({ where: { action: 'holiday.imported' } })).toBe(0)
  })
})

describe('lib/calendar — لقطة الدفعة', () => {
  it('اللقطة تجيب من الذاكرة داخل نافذتها وتعود للاستعلام خارجها', async () => {
    const user = await createUser(db)
    await seedHoliday(db, { date: '2026-03-03' })
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-03-09',
      endDate: '2026-03-10',
      status: 'APPROVED',
    })
    await createLeave(db, {
      userId: user.id,
      startDate: '2026-08-03',
      endDate: '2026-08-04',
      status: 'APPROVED',
    })

    const snapshot = await snapshotCalendarSource(db, {
      from: '2026-03-01',
      to: '2026-03-31',
      userIds: [user.id],
    })

    // Inside the window, answered from the two queries already made.
    expect([...(await snapshot.holidays('2026-03-01', '2026-03-31'))]).toEqual([
      '2026-03-03',
    ])
    expect([...(await snapshot.leaveDays(user.id, '2026-03-01', '2026-03-31'))]).toEqual([
      '2026-03-09',
      '2026-03-10',
    ])

    // Outside it — and for a user who was not preloaded — the snapshot must
    // fall through to a live query rather than answer with incomplete data.
    expect([...(await snapshot.leaveDays(user.id, '2026-08-01', '2026-08-31'))]).toEqual([
      '2026-08-03',
      '2026-08-04',
    ])
    const other = await createUser(db)
    expect((await snapshot.leaveDays(other.id, '2026-03-01', '2026-03-31')).size).toBe(0)
    expect((await snapshot.holidays('2026-01-01', '2026-12-31')).size).toBe(1)
  })

  it('لقطة بلا منفّذين لا تستعلم عن إجازات', async () => {
    const snapshot = await snapshotCalendarSource(db, {
      from: '2026-03-01',
      to: '2026-03-31',
      userIds: [],
    })
    const work = await snapshot.workCalendar()
    expect(work.workingDaysPerMonth).toBeGreaterThan(0)
  })
})

describe('lib/calendar — العطلات من قاعدة البيانات', () => {
  it('العطلة المخزَّنة تُسقط يوم العمل من الحساب', async () => {
    const calendar = calendarFor(db)
    const span = [cairo('2026-03-01T09:00'), cairo('2026-03-05T09:00')] as const

    expect(await calendar.workingDaysBetween(...span)).toBe(4)

    await seedHoliday(db, { date: '2026-03-03' })

    expect(await calendar.workingDaysBetween(...span)).toBe(3)
  })

  it('العطلة المتكررة تُسقط اليوم في سنة لاحقة', async () => {
    await seedHoliday(db, { date: '2026-01-07', isRecurring: true })
    const calendar = calendarFor(db)

    // 7 January 2027 is a Thursday — a working day but for the recurrence.
    expect(await calendar.isWorkingDay(cairo('2027-01-07T12:00'))).toBe(false)
  })
})
