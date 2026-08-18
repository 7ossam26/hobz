import { describe, expect, it } from 'vitest'

import { scopeTasks } from '@/lib/rbac'
import { SETTINGS_CATALOG } from '@/lib/settings'
import { listTasksSchema } from '@/modules/task/schema'
import { getDependencyGraph, listTasks } from '@/modules/task/service'

import {
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { advanceDays, cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/** The facet horizon, from the catalog rather than a literal (docs/TESTING.md §5). */
const DUE_SOON_DAYS = SETTINGS_CATALOG['tasks.dueSoonDays'].default

const db = testDb()
const NOW = cairo('2026-03-10T09:00')

/**
 * Phase 5's two additive reads on top of the settled Phase 4 domain:
 * `listTasks`'s `dueSoon` facet (mirrors the pre-existing `overdueOnly`
 * block exactly) and `getDependencyGraph` (the sheet's manage-able
 * dependency list, alongside the unchanged `getDependencyWarnings`).
 */

async function fixture() {
  await seedPermissionCatalog(db)
  const owner = await createUserWithPermissions(db, ['task.view.all'])
  const project = await createProject(db, { ownerId: owner.id })
  const actor = await actorFor(db, owner.id)
  return { owner, project, actor }
}

describe('modules/task/service — listTasks(dueSoon)', () => {
  it('يشمل مهمة مستحقة خلال ٧ أيام القادمة وتستبعد ما بعدها', async () => {
    const { project, actor } = await fixture()

    const dueTomorrow = await createTask(db, {
      projectId: project.id,
      title: 'مستحقة غدًا',
      dueDate: advanceDays(NOW, 1),
    })
    await createTask(db, {
      projectId: project.id,
      title: 'مستحقة بعد شهر',
      dueDate: advanceDays(NOW, 30),
    })

    const filters = listTasksSchema.parse({ dueSoon: true })
    const page = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope: scopeTasks(actor),
      filters,
      now: NOW,
    })

    expect(page.items.map((t) => t.id)).toEqual([dueTomorrow.id])
  })

  it('يستبعد مهمة مسلَّمة بالفعل ولو كان موعدها خلال الأسبوع', async () => {
    // Mirrors the SPEC §5.3 rule `isOverdue`/`overdueOnly` already encode:
    // delivered work no longer describes something still owed.
    const { project, actor } = await fixture()

    await createTask(db, {
      projectId: project.id,
      title: 'سُلِّمت بالفعل',
      status: 'SUBMITTED',
      dueDate: advanceDays(NOW, 2),
    })

    const filters = listTasksSchema.parse({ dueSoon: true })
    const page = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope: scopeTasks(actor),
      filters,
      now: NOW,
    })

    expect(page.total).toBe(0)
  })

  it('يستبعد مهمة مضى موعدها بالفعل — dueSoon ليس overdueOnly', async () => {
    const { project, actor } = await fixture()

    await createTask(db, {
      projectId: project.id,
      title: 'متأخرة بالفعل',
      dueDate: advanceDays(NOW, -1),
    })

    const filters = listTasksSchema.parse({ dueSoon: true })
    const page = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope: scopeTasks(actor),
      filters,
      now: NOW,
    })

    expect(page.total).toBe(0)
  })

  it('يعيد رمز المشروع (projectCode) مع كل ملخّص مهمة، لبطاقة اللوحة', async () => {
    const { project, actor } = await fixture()
    await createTask(db, { projectId: project.id, title: 'أي مهمة' })

    const filters = listTasksSchema.parse({})
    const page = await listTasks(db, {
      dueSoonDays: DUE_SOON_DAYS,
      scope: scopeTasks(actor),
      filters,
      now: NOW,
    })

    expect(page.items[0]?.projectCode).toBe(project.code)
  })
})

describe('modules/task/service — getDependencyGraph', () => {
  it('يفرّق بين الاعتماديات المحقَّقة وغير المحقَّقة في كلا الاتجاهين', async () => {
    const { project, actor } = await fixture()

    const target = await createTask(db, { projectId: project.id, title: 'المهمة نفسها' })
    const unsatisfied = await createTask(db, {
      projectId: project.id,
      title: 'تعتمد عليها — لم تُنجز بعد',
      status: 'IN_PROGRESS',
    })
    const satisfied = await createTask(db, {
      projectId: project.id,
      title: 'تعتمد عليها — منتهية',
      status: 'DONE',
    })
    const dependent = await createTask(db, {
      projectId: project.id,
      title: 'تعتمد على المهمة نفسها',
    })

    await db.taskDependency.createMany({
      data: [
        { taskId: target.id, dependsOnTaskId: unsatisfied.id },
        { taskId: target.id, dependsOnTaskId: satisfied.id },
        { taskId: dependent.id, dependsOnTaskId: target.id },
      ],
    })

    const graph = await getDependencyGraph(db, target.id)

    expect(graph.dependencies).toHaveLength(2)
    expect(graph.dependencies.find((d) => d.taskId === unsatisfied.id)?.satisfied).toBe(
      false,
    )
    expect(graph.dependencies.find((d) => d.taskId === satisfied.id)?.satisfied).toBe(
      true,
    )

    expect(graph.dependents).toHaveLength(1)
    expect(graph.dependents[0]?.taskId).toBe(dependent.id)

    void actor // scoping is asserted elsewhere (scoped-reads.test.ts); this
    // graph is reached only after `getTaskById` has already proven visibility
    // (`modules/task/queries.ts`'s `getTaskDependencyGraph`), matching the
    // precedent `getDependencyWarnings` already set.
  })

  it('يرجع قوائم فارغة لمهمة بلا اعتماديات في أي اتجاه', async () => {
    const { project } = await fixture()
    const lonely = await createTask(db, { projectId: project.id, title: 'مهمة منفردة' })

    const graph = await getDependencyGraph(db, lonely.id)

    expect(graph.dependencies).toEqual([])
    expect(graph.dependents).toEqual([])
  })

  it('يستبعد مهمة معتمَدة محذوفة ناعمًا من القائمة', async () => {
    const { project } = await fixture()
    const target = await createTask(db, { projectId: project.id, title: 'المهمة نفسها' })
    const deleted = await createTask(db, {
      projectId: project.id,
      title: 'محذوفة',
      deletedAt: NOW,
    })
    await db.taskDependency.create({
      data: { taskId: target.id, dependsOnTaskId: deleted.id },
    })

    const graph = await getDependencyGraph(db, target.id)

    expect(graph.dependencies).toEqual([])
  })
})
