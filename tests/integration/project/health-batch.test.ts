import { describe, expect, it } from 'vitest'

import { noTaskHealthSignals, taskHealthSignals } from '@/modules/project/health'

import {
  createBlockActivity,
  createProject,
  createTask,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()
const NOW = cairo('2026-03-10T09:00')

/**
 * `taskHealthSignals` grew a `batch` capability so a list screen stops asking
 * three questions per row — `/projects` measured 25 statements for six
 * projects, and the manager dashboard and the project report go through the
 * same path.
 *
 * The only thing that matters is that it did not become a *second* definition
 * of project health. Every test here compares the batch answer against the
 * per-project answer on the same data, so the two cannot drift.
 */

async function fixture() {
  await seedPermissionCatalog(db)
  const owner = await createUserWithPermissions(db, ['project.view.all'])

  // A project with overdue work, an escalated task and a long-running block.
  const busy = await createProject(db, { ownerId: owner.id, code: 'PRJ-BUSY' })
  for (const days of [1, 5, 12]) {
    await createTask(db, {
      projectId: busy.id,
      status: 'ASSIGNED',
      dueDate: new Date(NOW.getTime() - days * 86_400_000),
    })
  }
  const blocked = await createTask(db, { projectId: busy.id, status: 'BLOCKED' })
  await createBlockActivity(db, {
    taskId: blocked.id,
    from: 'IN_PROGRESS',
    at: new Date(NOW.getTime() - 4 * 86_400_000),
  })
  const escalated = await createTask(db, {
    projectId: busy.id,
    status: 'ASSIGNED',
    dueDate: new Date(NOW.getTime() - 20 * 86_400_000),
  })
  // The factory has no `escalationLevel` option; the column is written by the
  // Phase 6 escalation job, so it is set directly here.
  await db.task.update({
    where: { id: escalated.id },
    data: { escalationLevel: 'ADMIN' },
  })

  // A healthy project — nothing overdue, nothing blocked.
  const calm = await createProject(db, { ownerId: owner.id, code: 'PRJ-CALM' })
  await createTask(db, {
    projectId: calm.id,
    status: 'ASSIGNED',
    dueDate: new Date(NOW.getTime() + 30 * 86_400_000),
  })

  // A project with no tasks at all.
  const empty = await createProject(db, { ownerId: owner.id, code: 'PRJ-EMPTY' })

  return { busy, calm, empty }
}

describe('modules/project/health — الدفعة تطابق الاستعلام الفردي', () => {
  it('تعطي كل مشروع نفس الإشارات التي يعطيها الاستعلام الفردي', async () => {
    const { busy, calm, empty } = await fixture()
    const lookup = taskHealthSignals(NOW)
    const ids = [busy.id, calm.id, empty.id]

    const batched = await lookup.batch?.(db, ids)
    expect(batched).toBeDefined()

    for (const id of ids) {
      expect(batched?.get(id), id).toEqual(await lookup(db, id))
    }
  })

  it('تحسب فعلًا ما هو متوقَّع، لا أصفارًا متطابقة', async () => {
    // Guards the trivial pass: two implementations that both return zero agree
    // perfectly and prove nothing.
    const { busy } = await fixture()
    const batched = await taskHealthSignals(NOW).batch?.(db, [busy.id])

    expect(batched?.get(busy.id)).toEqual({
      // Three overdue, plus the escalated one which is also overdue.
      overdueTaskCount: 4,
      maxBlockedDays: 4,
      adminEscalationCount: 1,
    })
  })

  it('تعيد أصفارًا لمشروع بلا مهام ولمعرّف غير موجود', async () => {
    const { empty } = await fixture()
    const zero = { overdueTaskCount: 0, maxBlockedDays: 0, adminEscalationCount: 0 }

    const batched = await taskHealthSignals(NOW).batch?.(db, [empty.id, 'no-such-id'])

    expect(batched?.get(empty.id)).toEqual(zero)
    // A missing project is not an error and not an absent key — an absent key
    // would make the caller's `?? fallback` the real definition of health.
    expect(batched?.get('no-such-id')).toEqual(zero)
  })

  it('تتعامل مع قائمة فارغة دون استعلام', async () => {
    await seedPermissionCatalog(db)
    expect(await taskHealthSignals(NOW).batch?.(db, [])).toEqual(new Map())
  })

  it('لا تخلط إشارات مشروع بمشروع آخر', async () => {
    const { busy, calm } = await fixture()
    const batched = await taskHealthSignals(NOW).batch?.(db, [busy.id, calm.id])

    expect(batched?.get(calm.id)).toEqual({
      overdueTaskCount: 0,
      maxBlockedDays: 0,
      adminEscalationCount: 0,
    })
    expect(batched?.get(busy.id)?.overdueTaskCount).toBeGreaterThan(0)
  })

  it('البديل الفارغ يوفّر دفعة أيضًا — الاختبارات التي تحقنه لا تتغيّر', async () => {
    const zero = { overdueTaskCount: 0, maxBlockedDays: 0, adminEscalationCount: 0 }

    expect(await noTaskHealthSignals(db, 'anything')).toEqual(zero)
    expect(await noTaskHealthSignals.batch?.(db, ['a', 'b'])).toEqual(
      new Map([
        ['a', zero],
        ['b', zero],
      ]),
    )
  })
})
