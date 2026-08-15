import { describe, expect, it, vi } from 'vitest'

import { hashPassword } from '@/lib/auth/password'
import {
  createLoginThrottle,
  createMemoryThrottleStore,
  type LoginThrottle,
  type ThrottlePolicy,
} from '@/lib/auth/rate-limit'
import type { Db } from '@/lib/db'
import { authenticate } from '@/modules/auth/service'

/**
 * `authenticate` with a fake client. The real database path is covered by the
 * integration suite; what is asserted here is the *order* of the checks, which
 * is the part that has security consequences and the part a real database
 * cannot make more visible.
 */

const POLICY: ThrottlePolicy = {
  maxAttempts: 3,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
}

const NOW = new Date('2026-08-14T09:00:00.000Z')

function throttle(): LoginThrottle {
  return createLoginThrottle({
    stores: [createMemoryThrottleStore()],
    policy: async () => POLICY,
  })
}

interface FakeUser {
  id: string
  username: string
  passwordHash: string
  isActive: boolean
  deletedAt: Date | null
}

function fakeDb(user: FakeUser | null) {
  const auditCreate = vi.fn(async (args: unknown) => args)
  const userUpdate = vi.fn(async (args: unknown) => args)

  const db = {
    user: {
      findUnique: vi.fn(async () => user),
      update: userUpdate,
    },
    auditLog: { create: auditCreate },
  } as unknown as Db

  return { db, auditCreate, userUpdate }
}

const auditActions = (create: ReturnType<typeof vi.fn>): string[] =>
  create.mock.calls.map((call) => (call[0] as { data: { action: string } }).data.action)

describe('modules/auth — التحقق من بيانات الدخول', () => {
  it('يقبل بيانات صحيحة ويسجّل الدخول في سجل التدقيق', async () => {
    const passwordHash = await hashPassword('right-password-here')
    const { db, auditCreate } = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash,
      isActive: true,
      deletedAt: null,
    })

    const result = await authenticate(db, {
      username: 'AHMED',
      password: 'right-password-here',
      throttle: throttle(),
      now: NOW,
    })

    expect(result).toEqual({ ok: true, userId: 'u1', username: 'ahmed' })
    expect(auditActions(auditCreate)).toEqual(['auth.signedIn'])
  })

  it('يطبّع اسم المستخدم قبل البحث', async () => {
    const { db } = fakeDb(null)
    await authenticate(db, {
      username: '  Ahmed  ',
      password: 'x',
      throttle: throttle(),
      now: NOW,
    })

    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'ahmed' } }),
    )
  })

  it('يرفض كلمة مرور خاطئة ويسجّل المحاولة', async () => {
    const passwordHash = await hashPassword('right-password-here')
    const { db, auditCreate } = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash,
      isActive: true,
      deletedAt: null,
    })

    const result = await authenticate(db, {
      username: 'ahmed',
      password: 'wrong-password',
      throttle: throttle(),
      now: NOW,
    })

    expect(result).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' })
    expect(auditActions(auditCreate)).toEqual(['auth.signInFailed'])
  })

  it('يعطي نفس الجواب لمستخدم غير موجود', async () => {
    // No username oracle: "no such user" and "wrong password" are the same
    // answer, and `burnPasswordTime` makes them the same duration too.
    const { db } = fakeDb(null)

    expect(
      await authenticate(db, {
        username: 'ghost',
        password: 'anything',
        throttle: throttle(),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' })
  })

  it('يعامل المستخدم المحذوف ناعمًا كغير موجود', async () => {
    // CLAUDE.md invariant 8.
    const passwordHash = await hashPassword('right-password-here')
    const { db } = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash,
      isActive: true,
      deletedAt: new Date('2026-01-01'),
    })

    expect(
      await authenticate(db, {
        username: 'ahmed',
        password: 'right-password-here',
        throttle: throttle(),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' })
  })

  it('لا يكشف تعطيل الحساب إلا لمن يعرف كلمة المرور', async () => {
    // Order matters: password first, status second. Reversing the two turns the
    // login form into a directory of deactivated staff.
    const passwordHash = await hashPassword('right-password-here')

    const wrong = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash,
      isActive: false,
      deletedAt: null,
    })
    expect(
      await authenticate(wrong.db, {
        username: 'ahmed',
        password: 'wrong-password',
        throttle: throttle(),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' })

    const right = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash,
      isActive: false,
      deletedAt: null,
    })
    expect(
      await authenticate(right.db, {
        username: 'ahmed',
        password: 'right-password-here',
        throttle: throttle(),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'INACTIVE' })
  })

  it('لا يحتسب الحساب المعطّل محاولة فاشلة', async () => {
    // The credentials were right. Counting it would lock out an account whose
    // owner is doing nothing wrong.
    const passwordHash = await hashPassword('right-password-here')
    const shared = throttle()

    for (let i = 0; i < 5; i += 1) {
      const { db } = fakeDb({
        id: 'u1',
        username: 'ahmed',
        passwordHash,
        isActive: false,
        deletedAt: null,
      })
      const result = await authenticate(db, {
        username: 'ahmed',
        password: 'right-password-here',
        throttle: shared,
        now: NOW,
      })
      expect(result).toEqual({ ok: false, reason: 'INACTIVE' })
    }
  })

  it('يوقف الحساب بعد بلوغ حد المحاولات', async () => {
    const passwordHash = await hashPassword('right-password-here')
    const shared = throttle()
    const results = []

    for (let i = 0; i < POLICY.maxAttempts; i += 1) {
      const { db } = fakeDb({
        id: 'u1',
        username: 'ahmed',
        passwordHash,
        isActive: true,
        deletedAt: null,
      })
      results.push(
        await authenticate(db, {
          username: 'ahmed',
          password: 'wrong',
          throttle: shared,
          now: NOW,
        }),
      )
    }

    expect(
      results.slice(0, -1).every((r) => !r.ok && r.reason === 'INVALID_CREDENTIALS'),
    ).toBe(true)
    expect(results.at(-1)).toEqual({
      ok: false,
      reason: 'THROTTLED',
      retryAfterMinutes: 15,
    })
  })

  it('يرفض المحاولة الموقوفة قبل الوصول إلى قاعدة البيانات', async () => {
    // A locked key must not reach bcrypt at all, or the lockout still costs the
    // server 250 ms of CPU per attempt and becomes its own denial of service.
    const shared = throttle()
    for (let i = 0; i < POLICY.maxAttempts; i += 1) {
      const { db } = fakeDb(null)
      await authenticate(db, {
        username: 'ahmed',
        password: 'wrong',
        throttle: shared,
        now: NOW,
      })
    }

    const { db, auditCreate } = fakeDb(null)
    const result = await authenticate(db, {
      username: 'ahmed',
      password: 'wrong',
      throttle: shared,
      now: NOW,
    })

    expect(result).toMatchObject({ ok: false, reason: 'THROTTLED' })
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(auditActions(auditCreate)).toEqual(['auth.throttled'])
  })

  it('يمسح العدّاد بعد دخول ناجح', async () => {
    const passwordHash = await hashPassword('right-password-here')
    const shared = throttle()

    const bad = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash,
      isActive: true,
      deletedAt: null,
    })
    await authenticate(bad.db, {
      username: 'ahmed',
      password: 'wrong',
      throttle: shared,
      now: NOW,
    })

    const good = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash,
      isActive: true,
      deletedAt: null,
    })
    await authenticate(good.db, {
      username: 'ahmed',
      password: 'right-password-here',
      throttle: shared,
      now: NOW,
    })

    expect((await shared.check(['user:ahmed'], NOW)).remainingAttempts).toBe(
      POLICY.maxAttempts,
    )
  })

  it('يوقف على عنوان IP كما على اسم المستخدم', async () => {
    // Otherwise a credential-stuffing run rotates usernames and never trips.
    const shared = throttle()
    for (let i = 0; i < POLICY.maxAttempts; i += 1) {
      const { db } = fakeDb(null)
      await authenticate(db, {
        username: `victim${i}`,
        password: 'wrong',
        ip: '10.0.0.5',
        throttle: shared,
        now: NOW,
      })
    }

    const { db } = fakeDb(null)
    expect(
      await authenticate(db, {
        username: 'someone-new',
        password: 'wrong',
        ip: '10.0.0.5',
        throttle: shared,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'THROTTLED' })
  })

  it('يرقّي تجزئة قديمة عند الدخول الناجح', async () => {
    // The one moment the plaintext exists.
    const weak = '$2b$10$' + 'a'.repeat(53)
    const { db, userUpdate } = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash: weak,
      isActive: true,
      deletedAt: null,
    })

    // bcrypt.compare against a fabricated hash returns false, so drive the
    // upgrade path with a genuine cost-10 hash instead.
    const realWeak = await import('bcryptjs').then((m) => m.default.hash('pw-here', 10))
    const { db: db2, userUpdate: update2 } = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash: realWeak,
      isActive: true,
      deletedAt: null,
    })

    await authenticate(db, {
      username: 'ahmed',
      password: 'pw-here',
      throttle: throttle(),
      now: NOW,
    })
    expect(userUpdate).not.toHaveBeenCalled()

    await authenticate(db2, {
      username: 'ahmed',
      password: 'pw-here',
      throttle: throttle(),
      now: NOW,
    })
    expect(update2).toHaveBeenCalledOnce()
  })

  it('لا يعيد تجزئة كلمة مرور بالكلفة الحالية', async () => {
    const passwordHash = await hashPassword('pw-here-long')
    const { db, userUpdate } = fakeDb({
      id: 'u1',
      username: 'ahmed',
      passwordHash,
      isActive: true,
      deletedAt: null,
    })

    await authenticate(db, {
      username: 'ahmed',
      password: 'pw-here-long',
      throttle: throttle(),
      now: NOW,
    })
    expect(userUpdate).not.toHaveBeenCalled()
  })
})
