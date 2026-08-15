import { describe, expect, it } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import {
  getProjectTemplate,
  saveProjectAsTemplate,
  createProjectFromTemplate,
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
const SOURCE_START = new Date('2026-01-01T00:00:00.000Z')

describe('modules/project-template — حفظ هيكل المراحل كقالب', () => {
  it('يحفظ ترتيب المراحل وإزاحاتها الزمنية عن تاريخ بدء المشروع المصدر', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-TPL-SRC',
      startDate: SOURCE_START,
    })
    await createMilestone(db, {
      projectId: project.id,
      name: 'الاكتشاف',
      order: 0,
      dueDate: new Date('2026-01-08T00:00:00.000Z'), // +7 days
    })
    await createMilestone(db, {
      projectId: project.id,
      name: 'التسليم',
      order: 1,
      dueDate: null,
    })

    const summary = await saveProjectAsTemplate(db, {
      actor,
      input: { projectId: project.id, name: 'قالب موقع تعريفي' },
    })
    expect(summary.milestoneCount).toBe(2)

    const detail = await getProjectTemplate(db, summary.id)
    expect(detail.payload.milestones).toEqual([
      { name: 'الاكتشاف', order: 0, dueDateOffsetDays: 7, status: 'PENDING' },
      { name: 'التسليم', order: 1, dueDateOffsetDays: null, status: 'PENDING' },
    ])
    expect(detail.payload.tasks).toEqual([])

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'projectTemplate.created', entityId: summary.id },
    })
    expect(audit.after).toMatchObject({ sourceProjectId: project.id, milestoneCount: 2 })
  })

  it('يرفض الحفظ من مشروع غير موجود', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)

    await expect(
      saveProjectAsTemplate(db, { actor, input: { projectId: 'nope', name: 'قالب' } }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('modules/project-template — إنشاء مشروع من قالب', () => {
  it('ينشئ مشروعًا ويطبّق إزاحات القالب على تاريخ البدء الجديد، بحالة معلَّقة دائمًا', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit', 'project.create'])
    const actor = await actorFor(db, owner.id)
    const source = await createProject(db, {
      ownerId: owner.id,
      code: 'PRJ-TPL-A',
      startDate: SOURCE_START,
    })
    await createMilestone(db, {
      projectId: source.id,
      name: 'مرحلة أولى',
      order: 0,
      dueDate: new Date('2026-01-11T00:00:00.000Z'), // +10 days
      status: 'DONE', // must NOT carry over — the new project has not started
    })
    const template = await saveProjectAsTemplate(db, {
      actor,
      input: { projectId: source.id, name: 'قالب للاستنساخ' },
    })

    const newStart = new Date('2026-06-01T00:00:00.000Z')
    const { id: newProjectId } = await createProjectFromTemplate(db, {
      actor,
      input: {
        templateId: template.id,
        code: null,
        name: 'مشروع من القالب',
        clientId: null,
        ownerId: owner.id,
        engagementType: 'FIXED_PRICE',
        status: 'DRAFT',
        startDate: newStart,
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        gracePeriodHours: null,
        penalizeRevisionLateness: null,
      },
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    const milestones = await db.milestone.findMany({ where: { projectId: newProjectId } })
    expect(milestones).toHaveLength(1)
    expect(milestones[0]?.name).toBe('مرحلة أولى')
    expect(milestones[0]?.status).toBe('PENDING')
    expect(milestones[0]?.dueDate?.toISOString()).toBe('2026-06-11T00:00:00.000Z')

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.createdFromTemplate', entityId: newProjectId },
    })
    expect(audit.after).toMatchObject({ templateId: template.id, milestoneCount: 1 })

    // The normal creation audit still lands too — creating from a template is
    // still creating a project (CLAUDE.md invariant 7).
    expect(
      await db.auditLog.count({
        where: { action: 'project.created', entityId: newProjectId },
      }),
    ).toBe(1)
  })

  it('يرفض الإنشاء من قالب غير موجود', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, owner.id)

    await expect(
      createProjectFromTemplate(db, {
        actor,
        input: {
          templateId: 'no-such-template',
          code: null,
          name: 'مشروع',
          clientId: null,
          ownerId: owner.id,
          engagementType: 'FIXED_PRICE',
          status: 'DRAFT',
          startDate: new Date('2026-01-01'),
          dueDate: new Date('2026-02-01'),
          gracePeriodHours: null,
          penalizeRevisionLateness: null,
        },
        enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('ينشئ مشروعًا بلا مراحل من قالب فارغ', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit', 'project.create'])
    const actor = await actorFor(db, owner.id)
    const source = await createProject(db, { ownerId: owner.id, code: 'PRJ-TPL-EMPTY' })
    const template = await saveProjectAsTemplate(db, {
      actor,
      input: { projectId: source.id, name: 'قالب فارغ' },
    })

    const { id: newProjectId } = await createProjectFromTemplate(db, {
      actor,
      input: {
        templateId: template.id,
        code: null,
        name: 'مشروع بلا مراحل',
        clientId: null,
        ownerId: owner.id,
        engagementType: 'FIXED_PRICE',
        status: 'DRAFT',
        startDate: new Date('2026-01-01'),
        dueDate: new Date('2026-02-01'),
        gracePeriodHours: null,
        penalizeRevisionLateness: null,
      },
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    expect(await db.milestone.count({ where: { projectId: newProjectId } })).toBe(0)
  })
})
