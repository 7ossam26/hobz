import { describe, expect, it, vi } from 'vitest'

import {
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { setSessionActor } from '../../helpers/session-mock'
import { advanceMinutes, cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))

const { getGlobalCalendarEvents } = await import('@/modules/calendar/queries')

const db = testDb()
const NOW = cairo('2026-03-15T09:00')
const FROM = cairo('2026-03-01T00:00')
const TO = cairo('2026-03-31T23:59:59.999')
const IN_RANGE = cairo('2026-03-15T12:00')
const OUT_OF_RANGE = cairo('2026-06-15T12:00')

async function allAccessFixture() {
  await seedPermissionCatalog(db)
  const viewer = await createUserWithPermissions(db, [
    'project.view.all',
    'task.view.all',
  ])
  const responsible = await createUser(db, { fullName: 'مسؤول المشروع المختار' })
  setSessionActor(await actorFor(db, viewer.id))
  return { viewer, responsible }
}

describe('modules/calendar/queries — getGlobalCalendarEvents', () => {
  it('يعرض مشروعًا يملكه الشخص المختار ويحمل بيانات مسؤول المشروع في الحدث', async () => {
    const { responsible } = await allAccessFixture()
    const project = await createProject(db, {
      ownerId: responsible.id,
      dueDate: IN_RANGE,
    })

    const calendar = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { workerId: responsible.id },
      NOW,
    )

    expect(calendar.events).toEqual([
      expect.objectContaining({
        id: `project:${project.id}`,
        type: 'PROJECT',
        workerId: responsible.id,
        workerName: responsible.fullName,
      }),
    ])
    expect(calendar.truncated).toBe(false)
  })

  it('يجمع مهمة مسندة للشخص مع مشروع يملكه تحت نفس تصفية المسؤول', async () => {
    const { responsible } = await allAccessFixture()
    const otherOwner = await createUser(db)
    const ownedProject = await createProject(db, {
      ownerId: responsible.id,
      dueDate: IN_RANGE,
    })
    const otherProject = await createProject(db, {
      ownerId: otherOwner.id,
      dueDate: IN_RANGE,
    })
    const assignedTask = await createTask(db, {
      projectId: otherProject.id,
      assigneeId: responsible.id,
      status: 'ASSIGNED',
      dueDate: advanceMinutes(IN_RANGE, 1),
    })

    const calendar = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { workerId: responsible.id },
      NOW,
    )

    expect(calendar.events.map((event) => event.id)).toEqual([
      `project:${ownedProject.id}`,
      `task:${assignedTask.id}`,
    ])
    expect(calendar.events.map((event) => event.type)).toEqual(['PROJECT', 'TASK'])
  })

  it('يستبعد مشروعًا يملكه شخص آخر عند تصفية مسؤول المشروع', async () => {
    const { responsible } = await allAccessFixture()
    const thirdParty = await createUser(db)
    await createProject(db, { ownerId: thirdParty.id, dueDate: IN_RANGE })

    const calendar = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { workerId: responsible.id },
      NOW,
    )

    expect(calendar.events).toEqual([])
    expect(calendar.truncated).toBe(false)
  })

  it('يشمل استحقاق المشروع عند بداية النطاق ويستبعد ما قبله بمللي ثانية', async () => {
    const { responsible } = await allAccessFixture()
    const atFrom = await createProject(db, { ownerId: responsible.id, dueDate: FROM })
    await createProject(db, {
      ownerId: responsible.id,
      dueDate: new Date(FROM.getTime() - 1),
    })

    const calendar = await getGlobalCalendarEvents({ from: FROM, to: TO }, {}, NOW)

    expect(calendar.events.map((event) => event.id)).toEqual([`project:${atFrom.id}`])
  })

  it('يشمل استحقاق المشروع عند نهاية النطاق ويستبعد ما بعده بمللي ثانية', async () => {
    const { responsible } = await allAccessFixture()
    const atTo = await createProject(db, { ownerId: responsible.id, dueDate: TO })
    await createProject(db, {
      ownerId: responsible.id,
      dueDate: new Date(TO.getTime() + 1),
    })

    const calendar = await getGlobalCalendarEvents({ from: FROM, to: TO }, {}, NOW)

    expect(calendar.events.map((event) => event.id)).toEqual([`project:${atTo.id}`])
  })

  it('يدفع نطاق الاستحقاق إلى قاعدة البيانات فلا تسقط نتيجة الشهر خلف مئة مشروع خارجه', async () => {
    const { responsible } = await allAccessFixture()
    const inRange = await createProject(db, {
      ownerId: responsible.id,
      dueDate: IN_RANGE,
    })
    for (let index = 0; index < 100; index += 1) {
      await createProject(db, {
        ownerId: responsible.id,
        code: `PRJ-OUTSIDE-${index}`,
        dueDate: OUT_OF_RANGE,
      })
    }

    const calendar = await getGlobalCalendarEvents({ from: FROM, to: TO }, {}, NOW)

    expect(calendar.events.map((event) => event.id)).toEqual([`project:${inRange.id}`])
    expect(calendar.truncated).toBe(false)
  })

  it('يعرض أقدم مئة استحقاق داخل النطاق ويحذف الأحدث مع إعلان الاقتطاع', async () => {
    const { responsible } = await allAccessFixture()
    const projects: Array<{ id: string; dueDate: Date }> = []

    for (let index = 0; index < 101; index += 1) {
      const dueDate = advanceMinutes(FROM, index)
      const project = await createProject(db, {
        ownerId: responsible.id,
        code: `PRJ-DUE-ORDER-${String(index).padStart(3, '0')}`,
        dueDate,
      })
      // Explicit timestamps make the default `createdAt desc` order the exact
      // opposite of the required `dueDate asc` order. The assertion therefore
      // fails deterministically if the calendar stops sending its sort fields.
      await db.project.update({
        where: { id: project.id },
        data: { createdAt: dueDate },
      })
      projects.push({ id: project.id, dueDate })
    }

    const calendar = await getGlobalCalendarEvents({ from: FROM, to: TO }, {}, NOW)
    const projectEvents = calendar.events.filter((event) => event.type === 'PROJECT')

    expect(projectEvents.map((event) => event.id)).toEqual(
      projects.slice(0, 100).map((project) => `project:${project.id}`),
    )
    expect(projectEvents.map((event) => event.date)).toEqual(
      projects.slice(0, 100).map((project) => project.dueDate),
    )
    expect(projectEvents).toHaveLength(100)
    expect(
      projectEvents.some((event) => event.id === `project:${projects[100]!.id}`),
    ).toBe(false)
    expect(calendar.truncated).toBe(true)
  })

  it('يقصر واجهة المشروع على موعد المشروع المختار دون غيره', async () => {
    const { responsible } = await allAccessFixture()
    const selected = await createProject(db, {
      ownerId: responsible.id,
      dueDate: IN_RANGE,
    })
    await createProject(db, {
      ownerId: responsible.id,
      dueDate: advanceMinutes(IN_RANGE, 1),
    })

    const calendar = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { projectId: selected.id },
      NOW,
    )

    expect(calendar.events.map((event) => event.id)).toEqual([`project:${selected.id}`])
  })

  it('يجمع واجهتي المشروع والمسؤول بالتقاطع ولا تجعل إحداهما الأخرى بلا أثر', async () => {
    const { responsible } = await allAccessFixture()
    const otherOwner = await createUser(db)
    const selected = await createProject(db, {
      ownerId: responsible.id,
      dueDate: IN_RANGE,
    })

    const matching = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { projectId: selected.id, workerId: responsible.id },
      NOW,
    )
    const mismatching = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { projectId: selected.id, workerId: otherOwner.id },
      NOW,
    )

    expect(matching.events.map((event) => event.id)).toEqual([`project:${selected.id}`])
    expect(mismatching).toEqual({ events: [], truncated: false })
  })

  it('يبقي نطاق project.view.assigned أقوى من تصفية مسؤول مشروع آخر', async () => {
    await seedPermissionCatalog(db)
    const viewer = await createUserWithPermissions(db, ['project.view.assigned'])
    const responsible = await createUser(db)
    await createProject(db, { ownerId: responsible.id, dueDate: IN_RANGE })
    setSessionActor(await actorFor(db, viewer.id))

    const calendar = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { workerId: responsible.id },
      NOW,
    )

    expect(calendar).toEqual({ events: [], truncated: false })
  })

  it('لا يعرض مشروعًا محذوفًا يملكه الشخص المختار', async () => {
    const { responsible } = await allAccessFixture()
    await createProject(db, {
      ownerId: responsible.id,
      dueDate: IN_RANGE,
      deletedAt: cairo('2026-03-10T10:00'),
    })

    const calendar = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { workerId: responsible.id },
      NOW,
    )

    expect(calendar).toEqual({ events: [], truncated: false })
  })

  it('يعيد نتيجة فارغة دون خطأ عند تمرير معرّف مسؤول غير معروف', async () => {
    await allAccessFixture()

    const calendar = await getGlobalCalendarEvents(
      { from: FROM, to: TO },
      { workerId: 'user-does-not-exist' },
      NOW,
    )

    expect(calendar).toEqual({ events: [], truncated: false })
  })
})
