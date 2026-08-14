import { describe, expect, it } from 'vitest'

import { verifyPassword } from '@/lib/auth/password'
import { getPasswordPolicy } from '@/lib/auth/policy'
import {
  createDbThrottleStore,
  createLoginThrottle,
  createMemoryThrottleStore,
  type ThrottlePolicy,
} from '@/lib/auth/rate-limit'
import { DomainError } from '@/lib/errors'
import { authenticate, changeOwnPassword } from '@/modules/auth/service'
import { adminResetPassword } from '@/modules/user/service'

import {
  SHARED_TEST_PASSWORD,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

const POLICY: ThrottlePolicy = {
  maxAttempts: 3,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
}

const NOW = new Date('2026-08-14T09:00:00.000Z')

/** Both real layers: the in-process map and the `login_throttles` table. */
function throttle() {
  return createLoginThrottle({
    stores: [createMemoryThrottleStore(), createDbThrottleStore(db)],
    policy: async () => POLICY,
  })
}

describe('modules/auth — الدخول مقابل قاعدة بيانات حقيقية', () => {
  it('يقبل بيانات صحيحة ويكتب سجل دخول', async () => {
    const user = await createUser(db, { username: 'ahmed' })

    const result = await authenticate(db, {
      username: 'ahmed',
      password: SHARED_TEST_PASSWORD,
      ip: '10.0.0.5',
      throttle: throttle(),
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, userId: user.id })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'auth.signedIn' },
    })
    expect(audit.actorId).toBe(user.id)
    expect(audit.ip).toBe('10.0.0.5')
  })

  it('لا يكتب تجزئة كلمة المرور في سجل التدقيق أبدًا', async () => {
    await createUser(db, { username: 'ahmed' })
    await authenticate(db, {
      username: 'ahmed',
      password: SHARED_TEST_PASSWORD,
      throttle: throttle(),
      now: NOW,
    })

    const rows = await db.auditLog.findMany()
    const serialised = JSON.stringify(rows)
    expect(serialised).not.toContain('$2b$')
    expect(serialised).not.toContain(SHARED_TEST_PASSWORD)
  })

  it('يحفظ العدّاد في قاعدة البيانات فيبقى بعد إعادة التشغيل', async () => {
    // The reason there are two layers: an in-memory-only limiter is reset by
    // `docker restart`, which an attacker can often provoke.
    await createUser(db, { username: 'ahmed' })
    const first = throttle()

    for (let i = 0; i < POLICY.maxAttempts; i += 1) {
      await authenticate(db, {
        username: 'ahmed',
        password: 'wrong-password',
        throttle: first,
        now: NOW,
      })
    }

    const row = await db.loginThrottle.findUniqueOrThrow({ where: { key: 'user:ahmed' } })
    expect(row.failures).toBe(POLICY.maxAttempts)
    expect(row.lockedUntil).not.toBeNull()

    // A brand-new limiter — the process restarted — still refuses.
    const afterRestart = throttle()
    const result = await authenticate(db, {
      username: 'ahmed',
      password: SHARED_TEST_PASSWORD,
      throttle: afterRestart,
      now: NOW,
    })
    expect(result).toMatchObject({ ok: false, reason: 'THROTTLED' })
  })

  it('يمسح صف العدّاد بعد دخول ناجح', async () => {
    await createUser(db, { username: 'ahmed' })
    const shared = throttle()

    await authenticate(db, {
      username: 'ahmed',
      password: 'wrong-password',
      throttle: shared,
      now: NOW,
    })
    expect(await db.loginThrottle.count()).toBe(1)

    await authenticate(db, {
      username: 'ahmed',
      password: SHARED_TEST_PASSWORD,
      throttle: shared,
      now: NOW,
    })
    expect(await db.loginThrottle.count()).toBe(0)
  })

  it('يرفض دخول حساب معطَّل بكلمة مرور صحيحة', async () => {
    await createUser(db, { username: 'ahmed', isActive: false })

    expect(
      await authenticate(db, {
        username: 'ahmed',
        password: SHARED_TEST_PASSWORD,
        throttle: throttle(),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'INACTIVE' })
  })

  it('يرفض دخول حساب محذوف ناعمًا كأنه غير موجود', async () => {
    await createUser(db, { username: 'ahmed', deletedAt: new Date('2026-01-01') })

    expect(
      await authenticate(db, {
        username: 'ahmed',
        password: SHARED_TEST_PASSWORD,
        throttle: throttle(),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' })
  })

  it('يقبل اسم المستخدم بأي حالة أحرف', async () => {
    await createUser(db, { username: 'ahmed.ibrahim' })

    expect(
      await authenticate(db, {
        username: '  AHMED.Ibrahim  ',
        password: SHARED_TEST_PASSWORD,
        throttle: throttle(),
        now: NOW,
      }),
    ).toMatchObject({ ok: true })
  })
})

describe('modules/auth — تغيير كلمة المرور', () => {
  it('يغيّر كلمة المرور ويرفع علامة التغيير الإجباري', async () => {
    const user = await createUser(db, { mustChangePassword: true })
    const policy = await getPasswordPolicy()

    await changeOwnPassword(db, {
      userId: user.id,
      currentPassword: SHARED_TEST_PASSWORD,
      newPassword: 'a-completely-new-password',
      policy,
    })

    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.mustChangePassword).toBe(false)
    expect(await verifyPassword('a-completely-new-password', row.passwordHash)).toBe(true)
    expect(await verifyPassword(SHARED_TEST_PASSWORD, row.passwordHash)).toBe(false)
  })

  it('يرفض تغيير كلمة المرور دون معرفة الحالية', async () => {
    const user = await createUser(db)
    const before = await db.user.findUniqueOrThrow({ where: { id: user.id } })

    await expect(
      changeOwnPassword(db, {
        userId: user.id,
        currentPassword: 'not-the-current-one',
        newPassword: 'a-completely-new-password',
        policy: await getPasswordPolicy(),
      }),
    ).rejects.toMatchObject({ messageKey: 'auth.invalidCredentials' })

    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(
      before.passwordHash,
    )
  })

  it('يرفض كلمة مرور أقصر من الحد الأدنى في الإعدادات', async () => {
    const user = await createUser(db)
    const policy = await getPasswordPolicy()

    await expect(
      changeOwnPassword(db, {
        userId: user.id,
        currentPassword: SHARED_TEST_PASSWORD,
        newPassword: 'short',
        policy,
      }),
    ).rejects.toMatchObject({
      messageKey: 'validation.passwordTooShort',
      details: { minLength: policy.minLength },
    })
  })

  it('يرفض إعادة استخدام كلمة المرور الحالية', async () => {
    const user = await createUser(db)

    await expect(
      changeOwnPassword(db, {
        userId: user.id,
        currentPassword: SHARED_TEST_PASSWORD,
        newPassword: SHARED_TEST_PASSWORD,
        policy: await getPasswordPolicy(),
      }),
    ).rejects.toMatchObject({ messageKey: 'auth.passwordSameAsOld' })
  })

  it('يكتب سجل تدقيق بلا أي قيمة من كلمة المرور', async () => {
    const user = await createUser(db)
    await changeOwnPassword(db, {
      userId: user.id,
      currentPassword: SHARED_TEST_PASSWORD,
      newPassword: 'a-completely-new-password',
      policy: await getPasswordPolicy(),
    })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'auth.passwordChanged' },
    })
    expect(audit.actorId).toBe(user.id)
    expect(JSON.stringify(audit)).not.toContain('a-completely-new-password')
  })
})

describe('modules/user — إعادة تعيين كلمة المرور إداريًا', () => {
  it('يفرض على المستخدم تغييرها عند أول دخول', async () => {
    // The admin knows the password they just set. `mustChangePassword` is what
    // stops them from holding a working credential for someone else's account
    // past the next login.
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.resetPassword'])
    const worker = await createUser(db, { username: 'worker' })

    await adminResetPassword(db, {
      actor: await actorFor(db, admin.id),
      id: worker.id,
      newPassword: 'temporary-password-1',
      policy: await getPasswordPolicy(),
    })

    const row = await db.user.findUniqueOrThrow({ where: { id: worker.id } })
    expect(row.mustChangePassword).toBe(true)
    expect(await verifyPassword('temporary-password-1', row.passwordHash)).toBe(true)

    // …and the new password does log in.
    expect(
      await authenticate(db, {
        username: 'worker',
        password: 'temporary-password-1',
        throttle: throttle(),
        now: NOW,
      }),
    ).toMatchObject({ ok: true })
  })

  it('يخضع لنفس سياسة الطول', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.resetPassword'])
    const worker = await createUser(db)
    const before = await db.user.findUniqueOrThrow({ where: { id: worker.id } })

    await expect(
      adminResetPassword(db, {
        actor: await actorFor(db, admin.id),
        id: worker.id,
        newPassword: 'x',
        policy: await getPasswordPolicy(),
      }),
    ).rejects.toBeInstanceOf(DomainError)

    expect(
      (await db.user.findUniqueOrThrow({ where: { id: worker.id } })).passwordHash,
    ).toBe(before.passwordHash)
  })

  it('لا يسجّل كلمة المرور الجديدة في سجل التدقيق', async () => {
    await seedPermissionCatalog(db)
    const admin = await createUserWithPermissions(db, ['user.resetPassword'])
    const worker = await createUser(db)

    await adminResetPassword(db, {
      actor: await actorFor(db, admin.id),
      id: worker.id,
      newPassword: 'temporary-password-1',
      policy: await getPasswordPolicy(),
    })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.passwordReset' },
    })
    expect(JSON.stringify(audit)).not.toContain('temporary-password-1')
    expect(audit.after).toEqual({ mustChangePassword: true })
  })
})
