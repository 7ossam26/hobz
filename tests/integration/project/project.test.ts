import { describe, expect, it } from 'vitest'

import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import {
  addProjectMember,
  createProject,
  deleteProject,
  getProject,
  removeProjectMember,
  updateProject,
  updateProjectMemberRole,
} from '@/modules/project/service'

import {
  createClient,
  createProject as createProjectRow,
  createUser,
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

const START = new Date('2026-02-01T00:00:00.000Z')
const DUE = new Date('2026-05-01T00:00:00.000Z')

function baseInput(
  overrides: Partial<Parameters<typeof createProject>[1]['input']> = {},
) {
  return {
    code: null,
    name: 'مشروع اختبار',
    clientId: null,
    ownerId: '',
    engagementType: 'FIXED_PRICE' as const,
    status: 'DRAFT' as const,
    startDate: START,
    dueDate: DUE,
    gracePeriodHours: null,
    penalizeRevisionLateness: null,
    ...overrides,
  }
}

describe('modules/project — الإنشاء والكود التلقائي', () => {
  it('يولّد كودًا تلقائيًا حين لا يُمرَّر كود', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, admin.id)

    const result = await createProject(db, {
      actor,
      input: baseInput({ ownerId: admin.id }),
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    const row = await db.project.findUniqueOrThrow({ where: { id: result.id } })
    expect(row.code).toMatch(/^PRJ-\d{4}$/)

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.created', entityId: result.id },
    })
    expect(audit.actorId).toBe(admin.id)
  })

  it('يستخدم الكود المُمرَّر يدويًا حين يكون متاحًا', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, admin.id)

    const result = await createProject(db, {
      actor,
      input: baseInput({ ownerId: admin.id, code: 'ACME-01' }),
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    const row = await db.project.findUniqueOrThrow({ where: { id: result.id } })
    expect(row.code).toBe('ACME-01')
  })

  it('يرفض كودًا يدويًا مستخدمًا بالفعل بخطأ تعارض واضح', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, admin.id)
    await createProjectRow(db, { ownerId: admin.id, code: 'DUP-01' })

    await expect(
      createProject(db, {
        actor,
        input: baseInput({ ownerId: admin.id, code: 'DUP-01' }),
        enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يرفض نوع تعاقد غير مفعَّل في الإعدادات', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, admin.id)

    await expect(
      createProject(db, {
        actor,
        input: baseInput({ ownerId: admin.id, engagementType: 'HOURLY' }),
        enabledEngagementTypes: ['FIXED_PRICE', 'RETAINER'],
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('يرفض مالكًا غير موجود أو محذوفًا ناعمًا', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, admin.id)
    const gone = await createUser(db, { deletedAt: new Date('2026-01-01') })

    await expect(
      createProject(db, {
        actor,
        input: baseInput({ ownerId: gone.id }),
        enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    await expect(
      createProject(db, {
        actor,
        input: baseInput({ ownerId: 'no-such-user' }),
        enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يرفض عميلًا غير موجود ويسمح بترك العميل فارغًا', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['project.create'])
    const actor = await actorFor(db, admin.id)

    await expect(
      createProject(db, {
        actor,
        input: baseInput({ ownerId: admin.id, clientId: 'no-such-client' }),
        enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const client = await createClient(db, { name: 'عميل حقيقي' })
    const withClient = await createProject(db, {
      actor,
      input: baseInput({ ownerId: admin.id, clientId: client.id }),
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })
    const row = await db.project.findUniqueOrThrow({ where: { id: withClient.id } })
    expect(row.clientId).toBe(client.id)
  })
})

describe('modules/project — التعديل والحذف الناعم', () => {
  it('يعدّل الحقول ويسجّل الفرق قبل وبعد', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-EDIT-1',
      name: 'اسم قديم',
    })

    await updateProject(db, {
      actor,
      input: {
        id: project.id,
        code: project.code,
        name: 'اسم جديد',
        clientId: null,
        ownerId: owner.id,
        engagementType: 'RETAINER',
        status: 'ACTIVE',
        startDate: START,
        dueDate: DUE,
        gracePeriodHours: 48,
        penalizeRevisionLateness: false,
      },
      enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
    })

    const updated = await db.project.findUniqueOrThrow({ where: { id: project.id } })
    expect(updated.name).toBe('اسم جديد')
    expect(updated.gracePeriodHours).toBe(48)
    expect(updated.penalizeRevisionLateness).toBe(false)

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.updated', entityId: project.id },
    })
    expect(audit.before).toMatchObject({ name: 'اسم قديم' })
    expect(audit.after).toMatchObject({ name: 'اسم جديد' })
  })

  it('يرفض تغيير الكود إلى كود مستخدم في مشروع آخر', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    await createProjectRow(db, { ownerId: owner.id, code: 'TAKEN-01' })
    const project = await createProjectRow(db, { ownerId: owner.id, code: 'FREE-01' })

    await expect(
      updateProject(db, {
        actor,
        input: {
          id: project.id,
          code: 'TAKEN-01',
          name: project.name,
          clientId: null,
          ownerId: owner.id,
          engagementType: 'FIXED_PRICE',
          status: 'DRAFT',
          startDate: START,
          dueDate: DUE,
          gracePeriodHours: null,
          penalizeRevisionLateness: null,
        },
        enabledEngagementTypes: ALL_ENGAGEMENT_TYPES,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يحذف المشروع حذفًا ناعمًا ويسجّل تدقيقًا', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, [
      'project.delete',
      'project.view.all',
    ])
    const actor = await actorFor(db, owner.id)
    const project = await createProjectRow(db, { ownerId: owner.id, code: 'PRJ-DEL-1' })

    await deleteProject(db, { actor, id: project.id })

    const row = await db.project.findUniqueOrThrow({ where: { id: project.id } })
    expect(row.deletedAt).not.toBeNull()

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.deleted', entityId: project.id },
    })
    expect(audit.actorId).toBe(owner.id)
  })

  it('يرفض حذف مشروع محذوف بالفعل', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.delete'])
    const actor = await actorFor(db, owner.id)
    const project = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-DEL-2',
      deletedAt: new Date('2026-01-01'),
    })

    await expect(deleteProject(db, { actor, id: project.id })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('modules/project — فريق المشروع', () => {
  it('يضيف عضوًا بدور محدَّد ويسجّل تدقيقًا', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const project = await createProjectRow(db, { ownerId: owner.id, code: 'PRJ-TEAM-1' })
    const worker = await createUser(db, { username: 'team.worker' })

    await addProjectMember(db, {
      actor,
      input: { projectId: project.id, userId: worker.id, role: 'MANAGER' },
    })

    const detail = await getProject(db, {
      scope: {},
      id: project.id,
      now: new Date(),
      thresholds: {
        overdueTasksThreshold: 3,
        blockedDaysThreshold: 3,
        amberDaysBeforeDue: 3,
      },
    })
    expect(detail.members).toHaveLength(1)
    expect(detail.members[0]).toMatchObject({ userId: worker.id, role: 'MANAGER' })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.membersChanged', entityId: project.id },
    })
    expect(audit.after).toMatchObject({ added: { userId: worker.id, role: 'MANAGER' } })
  })

  it('يرفض إضافة نفس العضو مرتين', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const worker = await createUser(db, { username: 'dup.member' })
    const project = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-TEAM-2',
      memberIds: [worker.id],
    })

    await expect(
      addProjectMember(db, {
        actor,
        input: { projectId: project.id, userId: worker.id, role: 'VIEWER' },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يعدّل دور عضو موجود ويزيل عضوًا', async () => {
    await seedPermissionCatalog(db)
    const owner = await createUserWithPermissions(db, ['project.edit'])
    const actor = await actorFor(db, owner.id)
    const worker = await createUser(db, { username: 'role.change.member' })
    const project = await createProjectRow(db, {
      ownerId: owner.id,
      code: 'PRJ-TEAM-3',
      memberIds: [worker.id],
    })

    await updateProjectMemberRole(db, {
      actor,
      input: { projectId: project.id, userId: worker.id, role: 'MANAGER' },
    })
    const afterRoleChange = await db.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: project.id, userId: worker.id } },
    })
    expect(afterRoleChange.role).toBe('MANAGER')

    await removeProjectMember(db, {
      actor,
      input: { projectId: project.id, userId: worker.id },
    })
    expect(
      await db.projectMember.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: worker.id } },
      }),
    ).toBeNull()
  })
})
