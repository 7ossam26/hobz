import { describe, expect, it } from 'vitest'

import { DomainError, NotFoundError } from '@/lib/errors'
import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  reorderMilestones,
  updateMilestone,
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

describe('modules/milestone — الإنشاء والترتيب التلقائي', () => {
  it('يضيف كل مرحلة جديدة في نهاية القائمة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-CREATE' })

    const first = await createMilestone(db, {
      actor,
      input: {
        projectId: project.id,
        name: 'الاكتشاف',
        dueDate: null,
        status: 'PENDING',
      },
    })
    const second = await createMilestone(db, {
      actor,
      input: { projectId: project.id, name: 'التصميم', dueDate: null, status: 'PENDING' },
    })

    expect(first.order).toBe(0)
    expect(second.order).toBe(1)

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'milestone.created', entityId: second.id },
    })
    expect(audit.after).toMatchObject({ name: 'التصميم', order: 1 })
  })

  it('يرفض إنشاء مرحلة لمشروع غير موجود', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)

    await expect(
      createMilestone(db, {
        actor,
        input: {
          projectId: 'no-such-project',
          name: 'مرحلة',
          dueDate: null,
          status: 'PENDING',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/milestone — التعديل والحذف', () => {
  it('يعدّل الاسم والموعد والحالة ويسجّل الفرق', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-EDIT' })
    const milestone = await createMilestoneRow(db, {
      projectId: project.id,
      name: 'اسم قديم',
    })

    await updateMilestone(db, {
      actor,
      input: {
        id: milestone.id,
        name: 'اسم جديد',
        dueDate: new Date('2026-04-01'),
        status: 'DONE',
      },
    })

    const rows = await listMilestones(db, project.id)
    expect(rows[0]).toMatchObject({ name: 'اسم جديد', status: 'DONE' })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'milestone.updated', entityId: milestone.id },
    })
    expect(audit.before).toMatchObject({ name: 'اسم قديم' })
    expect(audit.after).toMatchObject({ name: 'اسم جديد', status: 'DONE' })
  })

  it('يحذف المرحلة حذفًا حقيقيًا (لا يوجد حذف ناعم لها في المواصفة)', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-DEL' })
    const milestone = await createMilestoneRow(db, { projectId: project.id })

    await deleteMilestone(db, { actor, id: milestone.id })

    expect(await db.milestone.findUnique({ where: { id: milestone.id } })).toBeNull()
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'milestone.deleted', entityId: milestone.id },
    })
    expect(audit.actorId).toBe(owner.id)
  })
})

describe('modules/milestone — السحب لإعادة الترتيب', () => {
  it('يعيد ترتيب المراحل حسب القائمة الجديدة ويسجّل الترتيبين', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-REORDER' })
    const a = await createMilestoneRow(db, { projectId: project.id, name: 'أ', order: 0 })
    const b = await createMilestoneRow(db, { projectId: project.id, name: 'ب', order: 1 })
    const c = await createMilestoneRow(db, { projectId: project.id, name: 'ج', order: 2 })

    const result = await reorderMilestones(db, {
      actor,
      input: { projectId: project.id, orderedIds: [c.id, a.id, b.id] },
    })

    expect(result.map((m) => m.name)).toEqual(['ج', 'أ', 'ب'])
    expect(result.map((m) => m.order)).toEqual([0, 1, 2])

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'milestone.reordered', entityId: project.id },
    })
    expect(audit.before).toEqual({ order: [a.id, b.id, c.id] })
    expect(audit.after).toEqual({ order: [c.id, a.id, b.id] })
  })

  it('يرفض قائمة إعادة ترتيب تحذف مرحلة موجودة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-PARTIAL' })
    const a = await createMilestoneRow(db, { projectId: project.id, order: 0 })
    const b = await createMilestoneRow(db, { projectId: project.id, order: 1 })

    await expect(
      reorderMilestones(db, {
        actor,
        input: { projectId: project.id, orderedIds: [a.id] },
      }),
    ).rejects.toBeInstanceOf(DomainError)

    // Rejected — the original order must be untouched.
    const rows = await listMilestones(db, project.id)
    expect(rows.map((m) => m.id)).toEqual([a.id, b.id])
  })

  it('يرفض قائمة إعادة ترتيب تحمل معرّفًا من مشروع آخر', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const projectA = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-MS-FOREIGN-A',
    })
    const projectB = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-MS-FOREIGN-B',
    })
    const a1 = await createMilestoneRow(db, { projectId: projectA.id, order: 0 })
    const foreign = await createMilestoneRow(db, { projectId: projectB.id, order: 0 })

    await expect(
      reorderMilestones(db, {
        actor,
        input: { projectId: projectA.id, orderedIds: [foreign.id] },
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect((await db.milestone.findUniqueOrThrow({ where: { id: a1.id } })).order).toBe(0)
  })

  it('يرفض قائمة تكرّر نفس المعرّف', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, { ownerId: owner.id, code: 'PRJ-MS-DUPID' })
    const a = await createMilestoneRow(db, { projectId: project.id, order: 0 })
    const b = await createMilestoneRow(db, { projectId: project.id, order: 1 })

    await expect(
      reorderMilestones(db, {
        actor,
        input: { projectId: project.id, orderedIds: [a.id, a.id] },
      }),
    ).rejects.toBeInstanceOf(DomainError)
    void b
  })
})
