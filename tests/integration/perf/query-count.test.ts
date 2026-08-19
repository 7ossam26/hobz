import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { taskHealthSignals } from '@/modules/project/health'
import { listProjects } from '@/modules/project/service'
import { listUsersWithDetails } from '@/modules/user/service'

import {
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const NOW = cairo('2026-03-10T09:00')

/**
 * An N+1 is not a slow query — it is a *correct* query issued N times, which
 * passes every functional test there is. Both of the ones this suite guards
 * shipped and survived twelve phases:
 *
 *  - `/users` called `getUser` per row, and `getUser` uses `findFirst`, which
 *    Prisma's DataLoader does not batch. Measured at 49 statements for 15 users.
 *  - `listProjects` called the health lookup per row, three statements each.
 *    Measured at 25 statements for six projects.
 *
 * The assertions are on the *shape* — a constant, not a multiple of the row
 * count — so they stay meaningful whatever the fixture size. A ceiling is
 * chosen with headroom so an extra legitimate query is not a failing test; the
 * thing that must fail is a count that scales with rows.
 */

/**
 * A second client, because query events need `log: ['query']` **at
 * construction** — the emitted event's type is inferred from that literal, so
 * the factory is what makes `$on('query')` type-check at all.
 */
const makeCountingClient = () =>
  new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })

let counter: ReturnType<typeof makeCountingClient>
let count = 0

beforeAll(() => {
  counter = makeCountingClient()
  counter.$on('query', (event) => {
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(event.query)) count += 1
  })
})

afterAll(async () => {
  await counter.$disconnect()
})

async function statementsFor(run: () => Promise<unknown>): Promise<number> {
  count = 0
  await run()
  return count
}

describe('أداء — عدد الاستعلامات ثابت لا يتناسب مع عدد الصفوف', () => {
  it('دليل المستخدمين: استعلام واحد للصفحة مهما بلغ عددهم', async () => {
    await seedPermissionCatalog(db)
    for (let i = 0; i < 20; i += 1) {
      await createUser(db, { username: `person.${i}` })
    }

    const statements = await statementsFor(() =>
      listUsersWithDetails(counter, { page: 1, pageSize: 100 }),
    )

    // Rows + count. Twenty users used to cost sixty-four.
    expect(statements).toBeLessThanOrEqual(4)
  })

  it('دليل المستخدمين: مضاعفة عدد المستخدمين لا تغيّر عدد الاستعلامات', async () => {
    // The assertion that actually catches a regression: not the ceiling, but
    // that the count does not move when the row count doubles.
    await seedPermissionCatalog(db)
    for (let i = 0; i < 10; i += 1) await createUser(db, { username: `a.${i}` })
    const small = await statementsFor(() =>
      listUsersWithDetails(counter, { page: 1, pageSize: 100 }),
    )

    for (let i = 0; i < 10; i += 1) await createUser(db, { username: `b.${i}` })
    const large = await statementsFor(() =>
      listUsersWithDetails(counter, { page: 1, pageSize: 100 }),
    )

    expect(large).toBe(small)
  })

  it('قائمة المشاريع: عدد الاستعلامات لا يتناسب مع عدد المشاريع', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])

    const listOnce = async () =>
      listProjects(counter, {
        scope: { deletedAt: null },
        now: NOW,
        filters: { page: 1, pageSize: 50 },
        thresholds: {
          overdueTasksThreshold: 3,
          blockedDaysThreshold: 3,
          amberDaysBeforeDue: 3,
        },
        taskHealthLookup: taskHealthSignals(NOW),
      })

    for (let i = 0; i < 3; i += 1) {
      const project = await createProject(db, { ownerId: owner.id, code: `PRJ-A${i}` })
      await createTask(db, { projectId: project.id, status: 'ASSIGNED' })
    }
    const three = await statementsFor(listOnce)

    for (let i = 0; i < 9; i += 1) {
      const project = await createProject(db, { ownerId: owner.id, code: `PRJ-B${i}` })
      await createTask(db, { projectId: project.id, status: 'ASSIGNED' })
    }
    const twelve = await statementsFor(listOnce)

    // Four times the projects, same statement count. Before the batch lookup
    // this went from ~13 to ~40.
    expect(twelve).toBe(three)
    expect(twelve).toBeLessThanOrEqual(8)
  })

  it('إشارات الصحة: دفعة واحدة مهما بلغ عدد المشاريع', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const ids: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const project = await createProject(db, { ownerId: owner.id, code: `PRJ-C${i}` })
      await createTask(db, { projectId: project.id, status: 'ASSIGNED' })
      ids.push(project.id)
    }

    const statements = await statementsFor(() =>
      taskHealthSignals(NOW).batch!(counter, ids),
    )

    // Two groupBys and one findMany — plus at most one for the nested activity
    // relation. Never three per project.
    expect(statements).toBeLessThanOrEqual(4)
  })
})
