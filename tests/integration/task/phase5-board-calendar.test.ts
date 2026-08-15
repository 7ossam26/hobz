import { describe, expect, it, vi } from 'vitest'

import { scopeTasks } from '@/lib/rbac'
import { listTasksSchema } from '@/modules/task/schema'
import { listTasks } from '@/modules/task/service'
import { TASK_STATUSES } from '@/modules/task/state-machine'

import {
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { setSessionActor } from '../../helpers/session-mock'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))

const { getTaskBoard, getTaskCalendar } = await import('@/modules/task/queries')

const db = testDb()
const NOW = cairo('2026-03-10T09:00')

/**
 * Phase 5's board and calendar reads (`modules/task/queries.ts`): axis 1
 * (boundaries) and axis 12 (empty/null) of docs/TESTING.md §4, plus the exact
 * boundary `listTasks`'s `dueThisWeek` facet draws. `tests/integration/task/
 * phase5-reads.test.ts` already covers `dueThisWeek`'s ordinary in/out cases
 * and `getDependencyGraph`; this file adds only the edges that file does not:
 * a project with zero tasks, multi-status bucketing, calendar-range
 * millisecond boundaries, and the RBAC scope proof for these two new
 * functions specifically.
 */

async function fixture() {
  await seedPermissionCatalog(db)
  const owner = await createUserWithPermissions(db, ['task.view.all'])
  const project = await createProject(db, { ownerId: owner.id })
  setSessionActor(await actorFor(db, owner.id))
  return { owner, project }
}

describe('modules/task/queries — getTaskBoard', () => {
  it('يعيد الأعمدة العشرة كاملة وفارغة لمشروع بلا أي مهمة', async () => {
    const { project } = await fixture()

    const board = await getTaskBoard({ projectId: [project.id] }, NOW)

    expect(board.columns).toHaveLength(TASK_STATUSES.length)
    expect(board.columns.map((c) => c.status)).toEqual([...TASK_STATUSES])
    for (const column of board.columns) {
      expect(column.tasks).toEqual([])
    }
    expect(board.truncated).toBe(false)
  })

  it('يضع كل مهمة في عمود حالتها الصحيح دون أن تتسرّب إلى عمود آخر', async () => {
    const { project } = await fixture()

    const spread: Array<(typeof TASK_STATUSES)[number]> = [
      'BACKLOG',
      'IN_PROGRESS',
      'IN_REVIEW',
      'APPROVED',
      'BLOCKED',
      'CANCELLED',
    ]
    const created = new Map<string, string>()
    for (const status of spread) {
      const task = await createTask(db, {
        projectId: project.id,
        title: `مهمة بحالة ${status}`,
        status,
      })
      created.set(status, task.id)
    }

    const board = await getTaskBoard({ projectId: [project.id] }, NOW)

    for (const column of board.columns) {
      const expectedId = created.get(column.status)
      if (expectedId) {
        expect(column.tasks.map((t) => t.id)).toEqual([expectedId])
      } else {
        expect(column.tasks).toEqual([])
      }
    }
    expect(board.truncated).toBe(false)
  })

  it('يقصر اللوحة على نطاق صاحب task.view.assigned — كل الأعمدة فارغة لمن ليس منفّذًا ولا متابعًا', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['task.view.all'])
    const project = await createProject(db, { ownerId: owner.id })
    await createTask(db, {
      projectId: project.id,
      title: 'مهمة غيري',
      status: 'IN_PROGRESS',
    })

    const stranger = await createUserWithPermissions(db, ['task.view.assigned'])
    setSessionActor(await actorFor(db, stranger.id))

    const board = await getTaskBoard({ projectId: [project.id] }, NOW)

    expect(board.columns).toHaveLength(TASK_STATUSES.length)
    for (const column of board.columns) {
      expect(column.tasks).toEqual([])
    }
  })
})

describe('modules/task/queries — getTaskCalendar', () => {
  it('يعيد قائمة فارغة — لا خطأ ولا undefined — لنطاق لا يقع فيه استحقاق أي مهمة', async () => {
    const { project } = await fixture()
    await createTask(db, {
      projectId: project.id,
      title: 'مستحقة بعد شهر',
      dueDate: cairo('2026-04-10T09:00'),
    })

    const range = {
      from: cairo('2026-03-01T00:00'),
      to: cairo('2026-03-05T23:59:59.999'),
    }
    const calendar = await getTaskCalendar({ projectId: [project.id] }, range, NOW)

    expect(calendar.items).toEqual([])
    expect(calendar.items).not.toBeUndefined()
    expect(calendar.truncated).toBe(false)
  })

  it('يشمل مهمة يقع استحقاقها عند بداية النطاق بالضبط ويستبعد ما قبلها بمللي ثانية واحدة', async () => {
    const { project } = await fixture()
    const from = cairo('2026-03-10T00:00')
    const to = cairo('2026-03-16T23:59:59.999')

    const atFrom = await createTask(db, {
      projectId: project.id,
      title: 'عند بداية النطاق بالضبط',
      dueDate: from,
    })
    await createTask(db, {
      projectId: project.id,
      title: 'قبل بداية النطاق بمللي ثانية',
      dueDate: new Date(from.getTime() - 1),
    })

    const calendar = await getTaskCalendar({ projectId: [project.id] }, { from, to }, NOW)

    expect(calendar.items.map((t) => t.id)).toEqual([atFrom.id])
  })

  it('يشمل مهمة يقع استحقاقها عند نهاية النطاق بالضبط ويستبعد ما بعدها بمللي ثانية واحدة', async () => {
    const { project } = await fixture()
    const from = cairo('2026-03-10T00:00')
    const to = cairo('2026-03-16T23:59:59.999')

    const atTo = await createTask(db, {
      projectId: project.id,
      title: 'عند نهاية النطاق بالضبط',
      dueDate: to,
    })
    await createTask(db, {
      projectId: project.id,
      title: 'بعد نهاية النطاق بمللي ثانية',
      dueDate: new Date(to.getTime() + 1),
    })

    const calendar = await getTaskCalendar({ projectId: [project.id] }, { from, to }, NOW)

    expect(calendar.items.map((t) => t.id)).toEqual([atTo.id])
  })

  it('يقصر التقويم على نطاق صاحب task.view.assigned — بلا مهام غيره', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['task.view.all'])
    const project = await createProject(db, { ownerId: owner.id })
    await createTask(db, {
      projectId: project.id,
      title: 'مهمة غيري مستحقة الآن',
      dueDate: NOW,
    })

    const stranger = await createUserWithPermissions(db, ['task.view.assigned'])
    setSessionActor(await actorFor(db, stranger.id))

    const range = {
      from: cairo('2026-03-01T00:00'),
      to: cairo('2026-03-31T23:59:59.999'),
    }
    const calendar = await getTaskCalendar({ projectId: [project.id] }, range, NOW)

    expect(calendar.items).toEqual([])
  })
})

describe('modules/task/service — listTasks(dueThisWeek) — الحدود الدقيقة', () => {
  async function serviceFixture() {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['task.view.all'])
    const project = await createProject(db, { ownerId: owner.id })
    const actor = await actorFor(db, owner.id)
    return { project, actor }
  }

  it('يشمل مهمة مستحقة عند اللحظة الحالية بالضبط (صفر أيام)', async () => {
    const { project, actor } = await serviceFixture()
    const dueNow = await createTask(db, {
      projectId: project.id,
      title: 'مستحقة الآن بالضبط',
      dueDate: NOW,
    })

    const filters = listTasksSchema.parse({ dueThisWeek: true })
    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })

    expect(page.items.map((t) => t.id)).toEqual([dueNow.id])
  })

  it('يشمل مهمة مستحقة عند الحد الخارجي بالضبط — الآن + ٧ أيام', async () => {
    const { project, actor } = await serviceFixture()
    const sevenDaysOut = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000)
    const atEdge = await createTask(db, {
      projectId: project.id,
      title: 'مستحقة عند الحد الخارجي',
      dueDate: sevenDaysOut,
    })

    const filters = listTasksSchema.parse({ dueThisWeek: true })
    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })

    expect(page.items.map((t) => t.id)).toEqual([atEdge.id])
  })

  it('يستبعد مهمة مستحقة بعد الحد الخارجي بدقيقة واحدة', async () => {
    const { project, actor } = await serviceFixture()
    const justPastEdge = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 1000)
    await createTask(db, {
      projectId: project.id,
      title: 'بعد الحد الخارجي بدقيقة',
      dueDate: justPastEdge,
    })

    const filters = listTasksSchema.parse({ dueThisWeek: true })
    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })

    expect(page.total).toBe(0)
  })

  it('يستبعد مهمة مضى موعدها بدقيقة واحدة فقط — ليست "قادمة هذا الأسبوع" بل متأخرة بالفعل', async () => {
    const { project, actor } = await serviceFixture()
    const justBeforeNow = new Date(NOW.getTime() - 60 * 1000)
    await createTask(db, {
      projectId: project.id,
      title: 'متأخرة بدقيقة واحدة',
      dueDate: justBeforeNow,
    })

    const filters = listTasksSchema.parse({ dueThisWeek: true })
    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })

    expect(page.total).toBe(0)
  })
})
