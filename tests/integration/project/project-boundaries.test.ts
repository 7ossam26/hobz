import { describe, expect, it } from 'vitest'

import { scopeProjects } from '@/lib/rbac'
import {
  createProjectSchema,
  listProjectsSchema,
  setProjectHealthOverrideSchema,
} from '@/modules/project/schema'
import {
  createProject,
  listProjects,
  setProjectHealthOverride,
} from '@/modules/project/service'

import {
  createProject as createProjectRow,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

const ALL_ENGAGEMENT_TYPES = [
  'FIXED_PRICE',
  'RETAINER',
  'MILESTONE_BASED',
  'HOURLY',
] as const

function baseInput(
  overrides: Partial<Parameters<typeof createProject>[1]['input']> = {},
) {
  return {
    code: null,
    name: 'مشروع اختبار الحدود',
    clientId: null,
    ownerId: '',
    engagementType: 'FIXED_PRICE' as const,
    status: 'DRAFT' as const,
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    dueDate: new Date('2026-06-01T00:00:00.000Z'),
    gracePeriodHours: null,
    penalizeRevisionLateness: null,
    ...overrides,
  }
}

/**
 * Raw (pre-transform) input for `createProjectSchema.safeParse` /`.parse`.
 * Unlike `baseInput` above — which builds the already-parsed `CreateProjectInput`
 * shape for calling the service directly — `code` and `clientId` use
 * `.optional()` without `.nullable()`, so a raw zod parse must omit them
 * (leaving them `undefined`) rather than pass `null`.
 */
function rawInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'مشروع اختبار الحدود',
    ownerId: 'owner-x',
    engagementType: 'FIXED_PRICE',
    status: 'DRAFT',
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    dueDate: new Date('2026-06-01T00:00:00.000Z'),
    gracePeriodHours: null,
    penalizeRevisionLateness: null,
    ...overrides,
  }
}

const THRESHOLDS = {
  overdueTasksThreshold: 3,
  blockedDaysThreshold: 3,
  amberDaysBeforeDue: 3,
}
const FAR_PAST_NOW = new Date('2020-01-01T00:00:00.000Z')

describe('modules/project — حد المساواة: تاريخ البدء = تاريخ الاستحقاق', () => {
  it('مخطط الإنشاء يقبل مشروعًا يبدأ وينتهي في نفس اليوم', () => {
    const sameDay = new Date('2026-04-15T00:00:00.000Z')
    const result = createProjectSchema.safeParse(
      rawInput({ startDate: sameDay, dueDate: sameDay }),
    )
    expect(result.success).toBe(true)
  })

  it('مخطط الإنشاء يرفض تاريخ بدء بعد تاريخ الاستحقاق بيوم واحد فقط', () => {
    const start = new Date('2026-04-15T00:00:00.000Z')
    const oneDayBefore = new Date('2026-04-14T00:00:00.000Z')
    const result = createProjectSchema.safeParse(
      rawInput({ startDate: start, dueDate: oneDayBefore }),
    )
    expect(result.success).toBe(false)
  })

  it('الخدمة تُنشئ مشروعًا فعليًا بيوم واحد من البداية للنهاية دون رفض', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, admin.id)
    const sameDay = new Date('2026-04-15T00:00:00.000Z')

    const result = await createProject(db, {
      actor,
      input: baseInput({ ownerId: admin.id, startDate: sameDay, dueDate: sameDay }),
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    const row = await db.project.findUniqueOrThrow({ where: { id: result.id } })
    expect(row.startDate.getTime()).toBe(sameDay.getTime())
    expect(row.dueDate.getTime()).toBe(sameDay.getTime())
  })
})

describe('modules/project — gracePeriodHours: صفر صريح مختلف عن null', () => {
  it('المخطط يحافظ على صفر صريح كما هو ولا يحوّله إلى null', () => {
    const zero = createProjectSchema.parse(rawInput({ gracePeriodHours: 0 }))
    expect(zero.gracePeriodHours).toBe(0)

    const notProvided = createProjectSchema.parse(rawInput({ gracePeriodHours: null }))
    expect(notProvided.gracePeriodHours).toBeNull()
  })

  it('الخدمة تخزّن صفرًا صريحًا في العمود بدل الوقوع إلى الإعداد الافتراضي (null)', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, admin.id)

    const result = await createProject(db, {
      actor,
      input: baseInput({ ownerId: admin.id, gracePeriodHours: 0 }),
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    const row = await db.project.findUniqueOrThrow({ where: { id: result.id } })
    expect(row.gracePeriodHours).toBe(0)
    expect(row.gracePeriodHours).not.toBeNull()
  })
})

describe('modules/project — سبب تجاوز الحالة الصحية: الحد الأقصى 500 حرفًا', () => {
  it('يقبل سببًا طوله 500 حرفًا بالضبط', () => {
    const reason = 'س'.repeat(500)
    const result = setProjectHealthOverrideSchema.safeParse({
      id: 'p1',
      health: 'RED',
      reason,
    })
    expect(result.success).toBe(true)
  })

  it('يرفض سببًا طوله 501 حرفًا (أكثر بحرف واحد فقط)', () => {
    const reason = 'س'.repeat(501)
    const result = setProjectHealthOverrideSchema.safeParse({
      id: 'p1',
      health: 'RED',
      reason,
    })
    expect(result.success).toBe(false)
  })

  it('الخدمة تقبل وتخزّن سببًا بطول 500 حرفًا عبر الحفظ الفعلي', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-REASON-MAX',
    })
    const reason = 'س'.repeat(500)

    await setProjectHealthOverride(db, {
      actor,
      input: { id: project.id, health: 'RED', reason },
    })

    const row = await db.project.findUniqueOrThrow({ where: { id: project.id } })
    expect(row.healthReason).toBe(reason)
    expect(row.healthReason?.length).toBe(500)
  })
})

describe('modules/project — حد صفحة الترقيم (pageSize) بالضبط', () => {
  it('صفحة تحتوي بالضبط pageSize من الصفوف: الصفحة الثانية فارغة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const actor = await actorFor(db, owner.id)
    const scope = scopeProjects(actor)
    const PAGE_SIZE = 5

    for (let i = 0; i < PAGE_SIZE; i++) {
      await createProjectRow(db, { ownerId: owner.id, code: `PRJ-PAGE-A-${i}` })
    }

    const page1 = await listProjects(db, {
      scope,
      filters: { page: 1, pageSize: PAGE_SIZE },
      now: FAR_PAST_NOW,
      thresholds: THRESHOLDS,
    })
    expect(page1.items).toHaveLength(PAGE_SIZE)
    expect(page1.total).toBe(PAGE_SIZE)

    const page2 = await listProjects(db, {
      scope,
      filters: { page: 2, pageSize: PAGE_SIZE },
      now: FAR_PAST_NOW,
      thresholds: THRESHOLDS,
    })
    expect(page2.items).toHaveLength(0)
    expect(page2.total).toBe(PAGE_SIZE)
  })

  it('pageSize + 1 من الصفوف: الصفحة الثانية تحتوي على صف واحد بالضبط', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const actor = await actorFor(db, owner.id)
    const scope = scopeProjects(actor)
    const PAGE_SIZE = 5

    for (let i = 0; i < PAGE_SIZE + 1; i++) {
      await createProjectRow(db, { ownerId: owner.id, code: `PRJ-PAGE-B-${i}` })
    }

    const page2 = await listProjects(db, {
      scope,
      filters: { page: 2, pageSize: PAGE_SIZE },
      now: FAR_PAST_NOW,
      thresholds: THRESHOLDS,
    })
    expect(page2.items).toHaveLength(1)
    expect(page2.total).toBe(PAGE_SIZE + 1)
  })
})

describe('modules/project — تصفية المعرّف ونطاق تاريخ الاستحقاق', () => {
  async function filterFixture() {
    await seedPermissionCatalog(db)
    const viewer = await createUserWithPermissions(db, ['project.view.all'])
    return { viewer, scope: scopeProjects(await actorFor(db, viewer.id)) }
  }

  it('يشمل تاريخي بداية ونهاية نطاق الاستحقاق ويستبعد ما خارجهما بمللي ثانية', async () => {
    const { viewer, scope } = await filterFixture()
    const from = cairo('2026-03-10T00:00')
    const to = cairo('2026-03-20T23:59:59.999')
    const atFrom = await createProjectRow(db, { ownerId: viewer.id, dueDate: from })
    const atTo = await createProjectRow(db, { ownerId: viewer.id, dueDate: to })
    await createProjectRow(db, {
      ownerId: viewer.id,
      dueDate: new Date(from.getTime() - 1),
    })
    await createProjectRow(db, {
      ownerId: viewer.id,
      dueDate: new Date(to.getTime() + 1),
    })

    const page = await listProjects(db, {
      scope,
      filters: listProjectsSchema.parse({ dueFrom: from, dueTo: to, sort: 'dueDate' }),
      now: FAR_PAST_NOW,
      thresholds: THRESHOLDS,
    })

    expect(page.items.map((project) => project.id)).toEqual([atFrom.id, atTo.id])
    expect(page.total).toBe(2)
  })

  it('يطبق بداية نطاق الاستحقاق وحدها دون اشتراط نهاية', async () => {
    const { viewer, scope } = await filterFixture()
    const from = cairo('2026-03-10T00:00')
    const atFrom = await createProjectRow(db, { ownerId: viewer.id, dueDate: from })
    const after = await createProjectRow(db, {
      ownerId: viewer.id,
      dueDate: cairo('2026-03-11T00:00'),
    })
    await createProjectRow(db, {
      ownerId: viewer.id,
      dueDate: cairo('2026-03-09T23:59:59.999'),
    })

    const page = await listProjects(db, {
      scope,
      filters: listProjectsSchema.parse({ dueFrom: from, sort: 'dueDate' }),
      now: FAR_PAST_NOW,
      thresholds: THRESHOLDS,
    })

    expect(page.items.map((project) => project.id)).toEqual([atFrom.id, after.id])
  })

  it('يطبق نهاية نطاق الاستحقاق وحدها دون اشتراط بداية', async () => {
    const { viewer, scope } = await filterFixture()
    const to = cairo('2026-03-20T23:59:59.999')
    const before = await createProjectRow(db, {
      ownerId: viewer.id,
      dueDate: cairo('2026-03-19T23:59:59.999'),
    })
    const atTo = await createProjectRow(db, { ownerId: viewer.id, dueDate: to })
    await createProjectRow(db, {
      ownerId: viewer.id,
      dueDate: cairo('2026-03-21T00:00'),
    })

    const page = await listProjects(db, {
      scope,
      filters: listProjectsSchema.parse({ dueTo: to, sort: 'dueDate' }),
      now: FAR_PAST_NOW,
      thresholds: THRESHOLDS,
    })

    expect(page.items.map((project) => project.id)).toEqual([before.id, atTo.id])
  })

  it('يجمع تصفية معرّف المشروع والمالك بالتقاطع', async () => {
    const { viewer, scope } = await filterFixture()
    const otherOwner = await createUserWithPermissions(db, [])
    const selected = await createProjectRow(db, { ownerId: viewer.id })
    await createProjectRow(db, { ownerId: viewer.id })

    const matching = await listProjects(db, {
      scope,
      filters: listProjectsSchema.parse({ id: [selected.id], ownerId: [viewer.id] }),
      now: FAR_PAST_NOW,
      thresholds: THRESHOLDS,
    })
    const mismatching = await listProjects(db, {
      scope,
      filters: listProjectsSchema.parse({ id: [selected.id], ownerId: [otherOwner.id] }),
      now: FAR_PAST_NOW,
      thresholds: THRESHOLDS,
    })

    expect(matching.items.map((project) => project.id)).toEqual([selected.id])
    expect(mismatching.items).toEqual([])
    expect(mismatching.total).toBe(0)
  })
})
