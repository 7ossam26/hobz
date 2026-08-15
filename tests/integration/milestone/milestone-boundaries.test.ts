import { describe, expect, it } from 'vitest'

import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  reorderMilestones,
} from '@/modules/milestone/service'

import {
  createMilestone as createMilestoneRow,
  createProject,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * Axis 1 — boundaries on `Milestone.order`. `tests/integration/milestone/milestone.test.ts`
 * already covers append-order-on-create (0, then 1) and a 3-item drag reorder.
 * This file covers the edges that leaves: zero milestones, a single-element
 * reorder, a realistic maximum-size reorder, and the "order is never reused
 * after a delete" guarantee.
 */

describe('modules/milestone — حدود الترتيب: صفر، واحد، والحد الأقصى الواقعي', () => {
  it('لا توجد أي مرحلة في مشروع جديد — قائمة فارغة دون خطأ', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-ZERO' })

    const rows = await listMilestones(db, project.id)
    expect(rows).toEqual([])
  })

  it('إعادة الترتيب بقائمة فارغة على مشروع بلا مراحل تنجح دون تغيير', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-ZERO-RO' })

    const result = await reorderMilestones(db, {
      actor,
      input: { projectId: project.id, orderedIds: [] },
    })

    expect(result).toEqual([])
  })

  it('إعادة ترتيب عنصر واحد فقط لا تُغيّر شيئًا وتنجح', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-ONE' })
    const only = await createMilestoneRow(db, {
      projectId: project.id,
      name: 'المرحلة الوحيدة',
      order: 0,
    })

    const result = await reorderMilestones(db, {
      actor,
      input: { projectId: project.id, orderedIds: [only.id] },
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: only.id, order: 0 })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'milestone.reordered', entityId: project.id },
    })
    expect(audit.before).toEqual({ order: [only.id] })
    expect(audit.after).toEqual({ order: [only.id] })
  })

  it('إعادة ترتيب عشرين مرحلة تُنتج ترتيبًا متصلًا 0..19 دون أي فجوة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-MAX' })

    const COUNT = 20
    const milestones = []
    for (let i = 0; i < COUNT; i++) {
      milestones.push(
        await createMilestoneRow(db, {
          projectId: project.id,
          name: `مرحلة ${i}`,
          order: i,
        }),
      )
    }

    // Reverse the whole set — the largest realistic reshuffle in one drag.
    const reversedIds = [...milestones].reverse().map((m) => m.id)

    const result = await reorderMilestones(db, {
      actor,
      input: { projectId: project.id, orderedIds: reversedIds },
    })

    expect(result.map((m) => m.id)).toEqual(reversedIds)
    expect(result.map((m) => m.order)).toEqual(Array.from({ length: COUNT }, (_, i) => i))

    // Contiguous 0..n-1, no gaps, no duplicates — re-read from the DB directly
    // rather than trusting the service's own return value.
    const rows = await db.milestone.findMany({
      where: { projectId: project.id },
      select: { order: true },
      orderBy: { order: 'asc' },
    })
    expect(rows.map((r) => r.order)).toEqual(Array.from({ length: COUNT }, (_, i) => i))
  })
})

describe('modules/milestone — الترتيب لا يُعاد استخدامه بعد الحذف', () => {
  it('المرحلة الجديدة تكمل من max(order)+1 بعد حذف أول مرحلة، دون تصادم', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-NOREUSE' })

    const a = await createMilestone(db, {
      actor,
      input: { projectId: project.id, name: 'أ', dueDate: null, status: 'PENDING' },
    })
    const b = await createMilestone(db, {
      actor,
      input: { projectId: project.id, name: 'ب', dueDate: null, status: 'PENDING' },
    })
    const c = await createMilestone(db, {
      actor,
      input: { projectId: project.id, name: 'ج', dueDate: null, status: 'PENDING' },
    })
    expect([a.order, b.order, c.order]).toEqual([0, 1, 2])

    await deleteMilestone(db, { actor, id: a.id })

    const d = await createMilestone(db, {
      actor,
      input: { projectId: project.id, name: 'د', dueDate: null, status: 'PENDING' },
    })

    // Continues from max(order among survivors b=1, c=2) + 1 = 3 — order 0 is
    // never handed out again even though it is now free.
    expect(d.order).toBe(3)

    const orders = (
      await db.milestone.findMany({
        where: { projectId: project.id },
        select: { order: true },
      })
    ).map((r) => r.order)
    expect(orders.sort((x, y) => x - y)).toEqual([1, 2, 3])
    expect(new Set(orders).size).toBe(orders.length)
  })
})
