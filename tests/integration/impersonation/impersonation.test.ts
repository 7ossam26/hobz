import { describe, expect, it } from 'vitest'

import { recordAudit } from '@/lib/audit'
import { resolveActor } from '@/lib/auth/resolve'
import { updateUser } from '@/modules/user/service'

import {
  createRole,
  createSuperAdmin,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * SPEC Phase 1 §5: "every action while impersonating is audit-logged with both
 * identities."
 *
 * The action *authorisation* (SUPER_ADMIN only, no nesting, no self) lives in
 * `modules/impersonation/actions.ts` and is re-checked in the `jwt` callback,
 * both of which need a real Auth.js request and are covered by the Playwright
 * flow. What is asserted here is the half that touches the database: that an
 * impersonated actor carries both identities and that every row it writes says
 * so.
 */

describe('العرض كمستخدم آخر — الهويتان في كل سجل', () => {
  it('يبني فاعلًا بصلاحيات المستخدم المعروض لا المنتحِل', async () => {
    // The point of "عرض كـ" is to see what that person sees. Giving the
    // impersonator their own permissions would defeat it entirely.
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const worker = await createUserWithPermissions(db, ['task.comment'], {
      username: 'worker',
      fullName: 'المنفّذ',
    })

    const adminActor = await actorFor(db, admin.id)
    const resolved = await resolveActor(db, worker.id, {
      impersonator: { id: adminActor.id, fullName: adminActor.fullName },
    })

    expect(resolved).not.toBeNull()
    const actor = resolved!.actor
    expect(actor.id).toBe(worker.id)
    expect(actor.isSuperAdmin).toBe(false)
    expect([...actor.permissions]).toEqual(['task.comment'])
    expect(actor.impersonatorId).toBe(admin.id)
    expect(actor.impersonatorName).toBe(adminActor.fullName)
  })

  it('يسجّل الهويتين في كل صف يكتبه الفاعل المنتحِل', async () => {
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const worker = await createUserWithPermissions(db, ['user.edit'], {
      username: 'worker',
    })
    const target = await createUser(db, { username: 'target' })
    const role = await createRole(db, { nameEn: 'SOME_ROLE' })

    const adminActor = await actorFor(db, admin.id)
    const impersonating = (await resolveActor(db, worker.id, {
      impersonator: { id: adminActor.id, fullName: adminActor.fullName },
    }))!.actor

    await updateUser(db, {
      actor: impersonating,
      input: {
        id: target.id,
        fullName: 'اسم معدَّل أثناء العرض',
        phone: null,
        isWorker: true,
        payType: 'PER_TASK',
        monthlySalary: null,
        defaultTaskRate: '500.00',
        weeklyCapacityHours: 40,
        penaltyProfileId: null,
        roles: [role.id],
      },
    })

    const row = await db.auditLog.findFirstOrThrow({
      where: { entity: 'User', entityId: target.id },
    })

    // The acting identity is the impersonated user; the real one is preserved
    // in its own column so both people are answerable for the change.
    expect(row.actorId).toBe(worker.id)
    expect(row.impersonatorId).toBe(admin.id)
  })

  it('يبقي حمولة الفرق نظيفة من بيانات الانتحال', async () => {
    // A dedicated column rather than a key inside `after`, so the diff view
    // shows the change and nothing but the change.
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const worker = await createUser(db, { username: 'worker' })

    const impersonating = (await resolveActor(db, worker.id, {
      impersonator: { id: admin.id, fullName: 'مدير النظام' },
    }))!.actor

    await recordAudit(db, {
      actor: impersonating,
      action: 'task.approved',
      entity: 'Task',
      entityId: 't1',
      after: { status: 'APPROVED' },
    })

    const row = await db.auditLog.findFirstOrThrow()
    expect(row.after).toEqual({ status: 'APPROVED' })
    expect(JSON.stringify(row.after)).not.toContain('__impersonator')
  })

  it('يتيح استخراج كل ما نُفِّذ أثناء العرض كاستعلام مفهرس', async () => {
    // The reason `impersonatorId` is a column: "show me everything done while
    // impersonating" must be answerable without scanning JSON.
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const worker = await createUser(db, { username: 'worker' })

    const plain = await actorFor(db, worker.id)
    const impersonating = (await resolveActor(db, worker.id, {
      impersonator: { id: admin.id, fullName: 'مدير النظام' },
    }))!.actor

    await recordAudit(db, {
      actor: plain,
      action: 'user.updated',
      entity: 'User',
      entityId: 'a',
    })
    await recordAudit(db, {
      actor: impersonating,
      action: 'user.updated',
      entity: 'User',
      entityId: 'b',
    })

    const viaImpersonation = await db.auditLog.findMany({
      where: { impersonatorId: admin.id },
    })
    expect(viaImpersonation).toHaveLength(1)
    expect(viaImpersonation[0]?.entityId).toBe('b')
  })

  it('يربط السجل بالمنتحِل عبر العلاقة فيظهر اسمه في العارض', async () => {
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, {
      username: 'root',
      fullName: 'مدير النظام',
    })
    const worker = await createUser(db, { username: 'worker' })

    const impersonating = (await resolveActor(db, worker.id, {
      impersonator: { id: admin.id, fullName: 'مدير النظام' },
    }))!.actor

    await recordAudit(db, {
      actor: impersonating,
      action: 'user.updated',
      entity: 'User',
      entityId: 'b',
    })

    const { listAuditEntries } = await import('@/modules/audit/service')
    const { auditFilterSchema } = await import('@/modules/audit/schema')
    const page = await listAuditEntries(db, auditFilterSchema.parse({}))

    expect(page.items[0]?.impersonator?.fullName).toBe('مدير النظام')
    expect(page.items[0]?.actor?.username).toBe('worker')
  })

  it('يرفض بناء فاعل معروض لمستخدم معطَّل', async () => {
    // Closes the "view as a disabled account" hole at the resolution layer, not
    // only in the action.
    await seedPermissionCatalog(db)
    const admin = await createSuperAdmin(db, { username: 'root' })
    const disabled = await createUser(db, { username: 'disabled', isActive: false })

    expect(
      await resolveActor(db, disabled.id, {
        impersonator: { id: admin.id, fullName: 'مدير النظام' },
      }),
    ).toBeNull()
  })
})
