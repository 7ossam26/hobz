import { describe, expect, it } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import { scopeProjects } from '@/lib/rbac'
import {
  createProject,
  deleteProject,
  getProject,
  getProjectFacetOptions,
  listProjects,
} from '@/modules/project/service'

import {
  createClient,
  createMilestone,
  createProject as createProjectRow,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

const THRESHOLDS = {
  overdueTasksThreshold: 3,
  blockedDaysThreshold: 3,
  amberDaysBeforeDue: 3,
}
const NOW = new Date('2026-03-01T00:00:00.000Z')

const ALL_ENGAGEMENT_TYPES = [
  'FIXED_PRICE',
  'RETAINER',
  'MILESTONE_BASED',
  'HOURLY',
] as const

/**
 * docs/TESTING.md §4 axis 11 — soft-delete: "deleted rows invisible
 * everywhere, but ledger/audit history intact" — CLAUDE.md invariant 8.
 *
 * `tests/integration/project/project.test.ts` already proves the basic shape
 * (soft-delete flips `deletedAt`, re-deleting throws). This file goes into
 * the corners the phase brief calls out by name: exclusion that survives an
 * otherwise-unique filter match, exclusion that is provably tied to
 * `deletedAt` rather than to an accident of row-level scoping, the one
 * relation (`Client`) this product *deliberately* keeps visible through a
 * soft-deleted row, and the one it must not (`getProjectFacetOptions`'s
 * client facet).
 */

describe('الحذف الناعم — المشروع: يختفي من كل قراءة حتى لو كان المطابقة الوحيدة', () => {
  it('يستثني المشروع المحذوف من نتائج البحث حتى لو كان المطابقة الوحيدة للكود', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const scope = scopeProjects(await actorFor(db, owner.id))
    await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-ONLY-MATCH',
      deletedAt: new Date('2026-01-01'),
    })

    const page = await listProjects(db, {
      scope,
      filters: { search: 'PRJ-ONLY-MATCH', page: 1, pageSize: 25 },
      now: NOW,
      thresholds: THRESHOLDS,
    })

    expect(page.total).toBe(0)
    expect(page.items).toEqual([])
  })

  it('يستثني المشروع المحذوف من نتيجة تصفية المالك حتى لو كان المطابقة الوحيدة', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const scope = scopeProjects(await actorFor(db, owner.id))
    await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-OWNER-FILTER',
      deletedAt: new Date('2026-01-01'),
    })

    const page = await listProjects(db, {
      scope,
      filters: { ownerId: [owner.id], page: 1, pageSize: 25 },
      now: NOW,
      thresholds: THRESHOLDS,
    })

    expect(page.total).toBe(0)
    expect(page.items).toEqual([])
  })

  it('يرمي NotFoundError عند قراءة مشروع محذوف مباشرة، حتى مع نطاق مفتوح project.view.all', async () => {
    // The scope here carries no ownership/membership restriction at all
    // (`project.view.all` resolves to `{ deletedAt: null }` exactly) — so if
    // this still excludes the row, the exclusion can only be `deletedAt`-
    // driven, never an accident of scope narrowing it to someone else's rows.
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const scope = scopeProjects(await actorFor(db, owner.id))
    expect(scope).toEqual({ deletedAt: null })

    const gone = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-WIDE-SCOPE',
      deletedAt: new Date('2026-01-01'),
    })

    await expect(
      getProject(db, { scope, id: gone.id, now: NOW, thresholds: THRESHOLDS }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('الحذف الناعم — المشروع المحذوف: لا يمسح المراحل، ليست هي المسؤولة عن حذفها', () => {
  it('لا يحذف مراحل المشروع عند حذف المشروع حذفًا ناعمًا (لا حذف فعلي، فلا cascade)', async () => {
    // prisma/schema.prisma declares `Milestone.project` with `onDelete:
    // Cascade` — but that FK action only fires on a real `DELETE FROM
    // projects`, and `deleteProject` never issues one; it only `UPDATE`s
    // `deletedAt`. The cascade therefore never triggers, and the milestone
    // rows must still be sitting in the table afterwards, untouched.
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.delete'])
    const actor = await actorFor(db, owner.id)
    const project = await createProjectRow(db, { ownerId: owner.id, code: 'PRJ-MS-DEL' })
    const m1 = await createMilestone(db, { projectId: project.id, order: 1 })
    const m2 = await createMilestone(db, { projectId: project.id, order: 2 })

    await deleteProject(db, { actor, id: project.id })

    const survivors = await db.milestone.findMany({ where: { projectId: project.id } })
    expect(survivors.map((m) => m.id).sort()).toEqual([m1.id, m2.id].sort())
  })
})

describe('الحذف الناعم — إشارة العميل داخل مشروع تابع له', () => {
  it('يُبقي اسم العميل المحذوف ظاهرًا داخل تفاصيل المشروع وقائمته (وصلة، لا قائمة عملاء)', async () => {
    // modules/client/service.ts's `deleteClient` comment: the relation is
    // `SetNull` only on a hard delete, which this product never performs, so
    // a project's join to its (now soft-deleted) client is left completely
    // alone. Only the client's *own* list/detail reads (client-soft-
    // delete.test.ts) stop finding it.
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const actor = await actorFor(db, owner.id)
    const scope = scopeProjects(actor)
    const client = await createClient(db, { name: 'عميل سيُحذف بعد الربط' })
    const project = await createProjectRow(db, {
      ownerId: owner.id,
      clientId: client.id,
      code: 'PRJ-CLIENT-GONE',
    })

    await db.client.update({
      where: { id: client.id },
      data: { deletedAt: new Date('2026-01-15') },
    })

    const detail = await getProject(db, {
      scope,
      id: project.id,
      now: NOW,
      thresholds: THRESHOLDS,
    })
    expect(detail.client).toMatchObject({ id: client.id, name: 'عميل سيُحذف بعد الربط' })

    const page = await listProjects(db, {
      scope,
      filters: { page: 1, pageSize: 25 },
      now: NOW,
      thresholds: THRESHOLDS,
    })
    expect(page.items.find((p) => p.id === project.id)?.client).toMatchObject({
      id: client.id,
      name: 'عميل سيُحذف بعد الربط',
    })
  })

  it('لا يعرض قائمة عملاء توليفة الفلاتر (facet) اسم عميل محذوف حتى لو أشار إليه مشروع نشط', async () => {
    // This is the one place a soft-deleted client must NOT surface: a filter
    // menu naming a client that no longer officially exists. Verified against
    // the real DB rather than assumed — see the diagnosis in the final report
    // if this fails.
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.view.all'])
    const scope = scopeProjects(await actorFor(db, owner.id))
    const deadClient = await createClient(db, { name: 'عميل يجب ألا يظهر في الفلتر' })
    await createProjectRow(db, {
      ownerId: owner.id,
      clientId: deadClient.id,
      code: 'PRJ-FACET-DEAD-CLIENT',
    })
    await db.client.update({
      where: { id: deadClient.id },
      data: { deletedAt: new Date('2026-01-15') },
    })

    const facets = await getProjectFacetOptions(db, scope)

    expect(facets.clients.map((c) => c.id)).not.toContain(deadClient.id)
  })
})

describe('الحذف الناعم — المشروع: يحتفظ بسجل التدقيق كاملًا بعد الحذف', () => {
  it('يحتفظ بسجلّي إنشاء المشروع وحذفه في سجل التدقيق بعد الحذف', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, [
      'project.create',
      'project.delete',
    ])
    const actor = await actorFor(db, admin.id)

    const created = await createProject(db, {
      actor,
      input: {
        code: 'PRJ-AUDIT-SURVIVE',
        name: 'مشروع للتدقيق',
        clientId: null,
        ownerId: admin.id,
        engagementType: 'FIXED_PRICE',
        status: 'DRAFT',
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        dueDate: new Date('2026-05-01T00:00:00.000Z'),
        gracePeriodHours: null,
        penalizeRevisionLateness: null,
      },
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    await deleteProject(db, { actor, id: created.id })

    const createdAudit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.created', entityId: created.id },
    })
    expect(createdAudit.actorId).toBe(admin.id)
    expect(createdAudit.after).toMatchObject({ code: 'PRJ-AUDIT-SURVIVE' })

    const deletedAudit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.deleted', entityId: created.id },
    })
    expect(deletedAudit.actorId).toBe(admin.id)
    expect(deletedAudit.after).toMatchObject({ code: 'PRJ-AUDIT-SURVIVE' })

    const allForProject = await db.auditLog.findMany({ where: { entityId: created.id } })
    expect(allForProject.map((a) => a.action).sort()).toEqual(
      ['project.created', 'project.deleted'].sort(),
    )
  })
})
