import { describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'
import { createRequireAuth, createRequirePermission } from '@/lib/rbac'

import { actingAs, nobody } from '../../helpers/auth'

/**
 * `requirePermission` is the wrapper every server action is built from, so the
 * property that matters is not "it throws" — it is **it throws before the
 * handler runs**. The phase brief's integration requirement ("must throw and
 * must not mutate") is guaranteed structurally by that ordering, and these
 * tests are what pin it down.
 */

describe('lib/rbac — requirePermission', () => {
  it('ينفّذ المعالج لصاحب الصلاحية ويمرّر الفاعل والوسائط', async () => {
    const actor = actingAs(['user.create'])
    const handler = vi.fn(async (_actor, name: string) => `created:${name}`)

    const action = createRequirePermission(async () => actor)('user.create', handler)
    const result = await action('ahmed')

    expect(result).toBe('created:ahmed')
    expect(handler).toHaveBeenCalledWith(actor, 'ahmed')
  })

  it('لا يستدعي المعالج إطلاقًا عند غياب الصلاحية', async () => {
    // The whole point. If the handler runs and then throws, a write may already
    // have happened.
    const handler = vi.fn()
    const action = createRequirePermission(async () => nobody())('user.create', handler)

    await expect(action()).rejects.toBeInstanceOf(ForbiddenError)
    expect(handler).not.toHaveBeenCalled()
  })

  it('يسمّي الصلاحية الناقصة في الخطأ', async () => {
    const action = createRequirePermission(async () => nobody())(
      'payout.approve',
      async () => undefined,
    )

    await expect(action()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'payout.approve' },
    })
  })

  it('يرمي خطأ عدم تسجيل الدخول قبل فحص الصلاحية', async () => {
    const handler = vi.fn()
    const action = createRequirePermission(async () => {
      throw new UnauthenticatedError()
    })('user.create', handler)

    await expect(action()).rejects.toBeInstanceOf(UnauthenticatedError)
    expect(handler).not.toHaveBeenCalled()
  })

  it('يحلّ الجلسة قبل الصلاحية في كل استدعاء', async () => {
    // Resolved per call, never cached at module scope: a role revoked between
    // two actions in the same request must take effect on the second.
    const resolve = vi.fn(async () => actingAs(['role.manage']))
    const action = createRequirePermission(resolve)('role.manage', async () => 'ok')

    await action()
    await action()
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('يمرّر كل صلاحيات الكتالوج لمدير النظام دون تخزينها', async () => {
    const { superAdmin } = await import('../../helpers/auth')
    const action = createRequirePermission(async () => superAdmin())(
      'audit.view',
      async () => 'ok',
    )
    await expect(action()).resolves.toBe('ok')
  })

  it('يعيد رمي خطأ المعالج كما هو دون ابتلاعه', async () => {
    const boom = new Error('service exploded')
    const action = createRequirePermission(async () => actingAs(['user.edit']))(
      'user.edit',
      async () => {
        throw boom
      },
    )

    await expect(action()).rejects.toBe(boom)
  })
})

describe('lib/rbac — requireAuth', () => {
  it('ينفّذ المعالج لأي مستخدم مسجَّل بلا أي صلاحية', async () => {
    // Sign out, change your own password, exit impersonation: actions every
    // authenticated user may take regardless of role.
    const actor = nobody()
    const handler = vi.fn(async () => 'ok')

    await expect(createRequireAuth(async () => actor)(handler)()).resolves.toBe('ok')
    expect(handler).toHaveBeenCalledWith(actor)
  })

  it('يرفض المستخدم غير المسجَّل', async () => {
    const handler = vi.fn()
    const action = createRequireAuth(async () => {
      throw new UnauthenticatedError()
    })(handler)

    await expect(action()).rejects.toBeInstanceOf(UnauthenticatedError)
    expect(handler).not.toHaveBeenCalled()
  })
})
