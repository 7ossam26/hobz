import { describe, expect, it } from 'vitest'

import {
  createProjectFromTemplate,
  getProjectTemplate,
  saveProjectAsTemplate,
} from '@/modules/project-template/service'

import {
  createMilestone,
  createProject,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

const ALL_ENGAGEMENT_TYPES = [
  'FIXED_PRICE',
  'RETAINER',
  'MILESTONE_BASED',
  'HOURLY',
] as const

/**
 * Axis 1 — boundaries. `tests/integration/project-template/project-template.test.ts`
 * already proves a +7-day and a null-due-date offset round-trip. This covers
 * the offset-0 edge specifically: a milestone due exactly ON the source
 * project's `startDate` — the boundary where `Math.round((due - start) / DAY_MS)`
 * must land exactly on `0`, not `-0`, `1` or `null`.
 */
describe('modules/project-template — حدّ الإزاحة صفر: مرحلة مستحقة في يوم بدء المشروع نفسه', () => {
  it('يحفظ إزاحة 0 حين يتطابق موعد المرحلة مع تاريخ بدء المشروع المصدر', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit', 'project.create'])
    const actor = await actorFor(db, owner.id)
    const start = new Date('2026-02-01T00:00:00.000Z')
    const project = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-TPL-OFFSET0',
      startDate: start,
    })
    await createMilestone(db, {
      projectId: project.id,
      name: 'مرحلة يوم الانطلاق',
      order: 0,
      dueDate: start, // exactly the project's startDate — offset 0
    })

    const summary = await saveProjectAsTemplate(db, {
      actor,
      input: { projectId: project.id, name: 'قالب بإزاحة صفر' },
    })

    const detail = await getProjectTemplate(db, summary.id)
    expect(detail.payload.milestones).toEqual([
      { name: 'مرحلة يوم الانطلاق', order: 0, dueDateOffsetDays: 0, status: 'PENDING' },
    ])
    // Explicitly not null and not falsy-coerced: 0 is a real offset.
    expect(detail.payload.milestones[0]?.dueDateOffsetDays).toBe(0)
  })

  it('ينشئ مشروعًا من القالب فتقع المرحلة على تاريخ بدء المشروع الجديد بالضبط', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit', 'project.create'])
    const actor = await actorFor(db, owner.id)
    const sourceStart = new Date('2026-02-01T00:00:00.000Z')
    const source = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-TPL-OFFSET0-SRC',
      startDate: sourceStart,
    })
    await createMilestone(db, {
      projectId: source.id,
      name: 'مرحلة يوم الانطلاق',
      order: 0,
      dueDate: sourceStart,
    })
    const template = await saveProjectAsTemplate(db, {
      actor,
      input: { projectId: source.id, name: 'قالب للاستنساخ بإزاحة صفر' },
    })

    const newStart = new Date('2026-09-10T00:00:00.000Z')
    const { id: newProjectId } = await createProjectFromTemplate(db, {
      actor,
      input: {
        templateId: template.id,
        code: null,
        name: 'مشروع جديد بإزاحة صفر',
        clientId: null,
        ownerId: owner.id,
        engagementType: 'FIXED_PRICE',
        status: 'DRAFT',
        startDate: newStart,
        dueDate: new Date('2026-12-10T00:00:00.000Z'),
        gracePeriodHours: null,
        penalizeRevisionLateness: null,
      },
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    const milestones = await db.milestone.findMany({ where: { projectId: newProjectId } })
    expect(milestones).toHaveLength(1)
    // Offset 0 round-trips to exactly the new project's startDate, not one day
    // off in either direction.
    expect(milestones[0]?.dueDate?.toISOString()).toBe(newStart.toISOString())
  })
})
