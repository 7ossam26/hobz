import { describe, expect, it } from 'vitest'

import { AppError, ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import { createUser, updateUser } from '@/modules/user/service'

import {
  createPenaltyProfile,
  createRole,
  createUser as createUserRow,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * The manual-QA bug: "creating a new user fails with حدث خطأ غير متوقع".
 *
 * Two independent causes, both of which reached the browser as the same
 * anonymous string. These assert on the *reason* rather than merely on the
 * failure, because "it threw" was never the problem — "it threw and nobody
 * could tell you why" was.
 */

const policy = { minLength: 10 }

const validInput = (overrides: Record<string, unknown> = {}) => ({
  username: 'new.person',
  password: 'a-sufficiently-long-password',
  fullName: 'شخص جديد',
  phone: null,
  isWorker: true,
  payType: 'PER_TASK' as const,
  monthlySalary: null,
  defaultTaskRate: '400.00',
  weeklyCapacityHours: 40,
  penaltyProfileId: null,
  roles: [],
  ...overrides,
})

async function countUsers(): Promise<number> {
  return db.user.count()
}

describe('modules/user — إنشاء مستخدم: سبب الفشل مذكور', () => {
  it('يرفض كلمة مرور أقصر من الحد ويسمّي الحد', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])
    const before = await countUsers()

    try {
      await createUser(db, {
        actor: await actorFor(db, admin.id),
        input: validInput({ password: 'short-123' }) as never,
        policy,
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError)
      expect((error as DomainError).messageKey).toBe('validation.passwordTooShort')
      // The number travels with the error, so the UI can say "at least 10"
      // rather than "too short" — which is the difference between an
      // actionable message and a shrug.
      expect((error as DomainError).details).toMatchObject({ minLength: 10 })
    }

    expect(await countUsers()).toBe(before)
  })

  it('يرفض كلمة مرور تحتوي اسم المستخدم', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])
    const before = await countUsers()

    await expect(
      createUser(db, {
        actor: await actorFor(db, admin.id),
        input: validInput({
          username: 'ahmed.samir',
          password: 'ahmed.samir-and-more',
        }) as never,
        policy,
      }),
    ).rejects.toMatchObject({ messageKey: 'validation.passwordContainsUsername' })

    expect(await countUsers()).toBe(before)
  })

  it('يقبل كلمة مرور بطول الحد بالضبط — الحد شامل', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])

    const created = await createUser(db, {
      actor: await actorFor(db, admin.id),
      input: validInput({ password: '0123456789' }) as never,
      policy,
    })

    expect(created.username).toBe('new.person')
  })

  it('يحفظ حالة اسم المستخدم ويمنع تكراره بأي حالة أخرى', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])
    const actor = await actorFor(db, admin.id)

    const created = await createUser(db, {
      actor,
      input: validInput({ username: 'Ahmed.Person' }) as never,
      policy,
    })
    expect(created.username).toBe('Ahmed.Person')
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: created.id } })).usernameCanonical,
    ).toBe('ahmed.person')

    await expect(
      createUser(db, {
        actor,
        input: validInput({ username: 'AHMED.PERSON' }) as never,
        policy,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يسند الدور الافتراضي الآمن تلقائيًا حين لا يحدد المدير دورًا', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])
    const defaultRole = await createRole(db, {
      nameEn: 'employee',
      isDefault: true,
      permissions: [
        'project.view.assigned',
        'task.view.assigned',
        'task.work.assigned',
        'task.comment',
        'ledger.view.own',
      ],
    })

    const created = await createUser(db, {
      actor: await actorFor(db, admin.id),
      input: validInput() as never,
      policy,
    })

    expect(created.roles.map((role) => role.id)).toEqual([defaultRole.id])
  })

  it('يسمّي اسم المستخدم المكرَّر بدل رسالة عامة', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])
    await createUserRow(db, { username: 'taken.name' })
    const before = await countUsers()

    await expect(
      createUser(db, {
        actor: await actorFor(db, admin.id),
        input: validInput({ username: 'taken.name' }) as never,
        policy,
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    expect(await countUsers()).toBe(before)
  })

  it('يرفض صيغة خصم غير موجودة بدل تمريرها إلى مفتاح أجنبي', async () => {
    // The reported second cause: `penaltyProfileId` was a free-text box writing
    // straight into a real FK, so a typed value came back as a raw P2003.
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])
    const before = await countUsers()

    try {
      await createUser(db, {
        actor: await actorFor(db, admin.id),
        input: validInput({ penaltyProfileId: 'not-a-real-profile' }) as never,
        policy,
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError)
      expect((error as NotFoundError).details).toMatchObject({
        entity: 'PenaltyProfile',
      })
    }

    expect(await countUsers()).toBe(before)
  })

  it('يرفض صيغة خصم محذوفة حذفًا ناعمًا', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])
    const profile = await createPenaltyProfile(db, { deletedAt: new Date() })

    await expect(
      createUser(db, {
        actor: await actorFor(db, admin.id),
        input: validInput({ penaltyProfileId: profile.id }) as never,
        policy,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يقبل صيغة خصم موجودة ويحفظها', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.create'])
    const profile = await createPenaltyProfile(db, { name: 'صيغة المبيعات' })

    const created = await createUser(db, {
      actor: await actorFor(db, admin.id),
      input: validInput({ penaltyProfileId: profile.id }) as never,
      policy,
    })

    expect(created.penaltyProfileId).toBe(profile.id)
  })

  it('التعديل يتحقق من صيغة الخصم أيضًا', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.edit'])
    const target = await createUserRow(db, { username: 'target.person' })

    await expect(
      updateUser(db, {
        actor: await actorFor(db, admin.id),
        input: {
          id: target.id,
          fullName: 'اسم معدَّل',
          phone: null,
          isWorker: false,
          payType: 'PER_TASK',
          monthlySalary: null,
          defaultTaskRate: null,
          weeklyCapacityHours: 40,
          penaltyProfileId: 'ghost-profile',
          roles: [],
        } as never,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('حارس دور مدير النظام يظل رفض صلاحية لا رسالة حقل', async () => {
    // It must keep *throwing*: `lib/action-result` turns business failures into
    // renderable data, and a privilege-escalation guard is not one of those.
    await seedPermissionCatalog(db)
    const editor = await createUserWithPermissions(db, ['user.create'])
    const superRole = await db.role.create({
      data: { nameAr: 'مدير النظام', nameEn: 'SUPER_ADMIN', isSystem: true },
      select: { id: true },
    })

    try {
      await createUser(db, {
        actor: await actorFor(db, editor.id),
        input: validInput({ roles: [superRole.id] }) as never,
        policy,
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('FORBIDDEN')
      expect((error as AppError).messageKey).toBe('users.superAdminRoleRestricted')
    }
  })
})
