import { describe, expect, it } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import { scopeTasks } from '@/lib/rbac'
import { listTasksSchema } from '@/modules/task/schema'
import { getTask, listTasks } from '@/modules/task/service'

import {
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
 * SPEC §6, as Phase 1 settled it: `task.view.assigned` is limited to tasks
 * where the user is **assignee or watcher** — literally, and per entity. The
 * enforcement is the `where` fragment, never a post-fetch filter, so the case
 * that matters is asking for someone else's task by direct id.
 */

const filters = listTasksSchema.parse({})

async function fixture() {
  await seedPermissionCatalog(db)
  const owner = await createUserWithPermissions(db, ['task.view.all'])
  const project = await createProject(db, { ownerId: owner.id })

  const assignee = await createUserWithPermissions(db, ['task.view.assigned'])
  const watcher = await createUserWithPermissions(db, ['task.view.assigned'])
  const stranger = await createUserWithPermissions(db, ['task.view.assigned'])
  const nobody = await createUserWithPermissions(db, [])

  const mine = await createTask(db, {
    projectId: project.id,
    title: 'مهمتي',
    assigneeId: assignee.id,
    status: 'ASSIGNED',
  })
  const watched = await createTask(db, {
    projectId: project.id,
    title: 'مهمة أتابعها',
    watcherIds: [watcher.id],
  })
  const theirs = await createTask(db, { projectId: project.id, title: 'مهمة غيري' })

  return { owner, project, assignee, watcher, stranger, nobody, mine, watched, theirs }
}

describe('modules/task — نطاق القراءة (SPEC §6)', () => {
  it('يرى صاحب task.view.all كل المهام', async () => {
    const { owner } = await fixture()
    const actor = await actorFor(db, owner.id)

    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })
    expect(page.total).toBe(3)
  })

  it('يرى المنفّذ مهامه فقط', async () => {
    const { assignee, mine } = await fixture()
    const actor = await actorFor(db, assignee.id)

    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })
    expect(page.items.map((t) => t.id)).toEqual([mine.id])
  })

  it('يرى المتابع المهام التي يتابعها فقط', async () => {
    const { watcher, watched } = await fixture()
    const actor = await actorFor(db, watcher.id)

    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })
    expect(page.items.map((t) => t.id)).toEqual([watched.id])
  })

  it('لا يرى صاحب النطاق المحدود شيئًا حين لا يكون منفّذًا ولا متابعًا', async () => {
    const { stranger } = await fixture()
    const actor = await actorFor(db, stranger.id)

    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })
    expect(page.total).toBe(0)
  })

  it('لا يرى من لا يملك أي صلاحية عرض أي مهمة', async () => {
    const { nobody } = await fixture()
    const actor = await actorFor(db, nobody.id)

    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })
    expect(page.total).toBe(0)
  })

  it('يرفض فتح مهمة غير مسنَدة إليه بالمعرّف المباشر', async () => {
    const { stranger, theirs } = await fixture()
    const actor = await actorFor(db, stranger.id)

    await expect(
      getTask(db, { scope: scopeTasks(actor), id: theirs.id, now: NOW }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يرفض فتح مهمة محذوفة ناعمًا حتى لصاحب الصلاحية الكاملة', async () => {
    const { owner, mine } = await fixture()
    const actor = await actorFor(db, owner.id)
    await db.task.update({ where: { id: mine.id }, data: { deletedAt: new Date() } })

    await expect(
      getTask(db, { scope: scopeTasks(actor), id: mine.id, now: NOW }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  /**
   * `deleteProject` only sets `deletedAt`; nothing at the database level hides
   * the tasks hanging off it. The same leak Phase 3's axis-11 sweep found in
   * the project facets, closed here before it can appear.
   */
  it('يخفي مهام مشروع محذوف ناعمًا من القائمة ومن الفتح المباشر', async () => {
    const { owner, project, mine } = await fixture()
    const actor = await actorFor(db, owner.id)
    await db.project.update({
      where: { id: project.id },
      data: { deletedAt: new Date() },
    })

    const page = await listTasks(db, { scope: scopeTasks(actor), filters, now: NOW })
    expect(page.total).toBe(0)

    await expect(
      getTask(db, { scope: scopeTasks(actor), id: mine.id, now: NOW }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/task — الترشيح والبحث', () => {
  it('يبحث بالعنوان مع توحيد صيغ الهمزة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['task.view.all'])
    const project = await createProject(db, { ownerId: owner.id })
    await createTask(db, { projectId: project.id, title: 'مراجعة تصميم أحمد' })
    await createTask(db, { projectId: project.id, title: 'مهمة أخرى' })
    const actor = await actorFor(db, owner.id)

    const page = await listTasks(db, {
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({ search: 'احمد' }),
      now: NOW,
    })

    expect(page.total).toBe(1)
    expect(page.items[0]?.title).toBe('مراجعة تصميم أحمد')
  })

  it('يرشّح المهام المتأخرة دون المهام المسلَّمة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['task.view.all'])
    const project = await createProject(db, { ownerId: owner.id })
    const past = cairo('2026-03-01T17:00')

    const late = await createTask(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: past,
    })
    // Delivered late is not "overdue": time in review never counts against the
    // worker (SPEC §5.3).
    await createTask(db, { projectId: project.id, status: 'IN_REVIEW', dueDate: past })
    await createTask(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: cairo('2026-04-01T17:00'),
    })
    const actor = await actorFor(db, owner.id)

    const page = await listTasks(db, {
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({ overdueOnly: true }),
      now: NOW,
    })

    expect(page.items.map((t) => t.id)).toEqual([late.id])
  })

  it('يميّز المهمة المتأخرة في نتيجة القراءة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['task.view.all'])
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      dueDate: cairo('2026-03-01T17:00'),
    })
    const actor = await actorFor(db, owner.id)

    const dto = await getTask(db, { scope: scopeTasks(actor), id: task.id, now: NOW })
    expect(dto.isOverdue).toBe(true)
  })

  it('يرشّح بالحالة والأولوية والتصنيف والمنفّذ', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['task.view.all'])
    const worker = await createUserWithPermissions(db, [])
    const project = await createProject(db, { ownerId: owner.id })
    const wanted = await createTask(db, {
      projectId: project.id,
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      categoryId: 'development',
      assigneeId: worker.id,
    })
    await createTask(db, { projectId: project.id, status: 'BACKLOG', priority: 'LOW' })
    const actor = await actorFor(db, owner.id)

    const page = await listTasks(db, {
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({
        status: ['IN_PROGRESS'],
        priority: ['URGENT'],
        categoryId: ['development'],
        assigneeId: [worker.id],
      }),
      now: NOW,
    })

    expect(page.items.map((t) => t.id)).toEqual([wanted.id])
  })

  it('يقسّم النتائج إلى صفحات', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['task.view.all'])
    const project = await createProject(db, { ownerId: owner.id })
    for (let i = 0; i < 5; i += 1) {
      await createTask(db, { projectId: project.id })
    }
    const actor = await actorFor(db, owner.id)

    const page = await listTasks(db, {
      scope: scopeTasks(actor),
      filters: listTasksSchema.parse({ page: 2, pageSize: 2 }),
      now: NOW,
    })

    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(5)
    expect(page.page).toBe(2)
  })
})
