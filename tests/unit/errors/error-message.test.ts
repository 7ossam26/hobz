import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { toActionResult, type ActionFailure } from '@/lib/action-result'
import { messageForError, messageForFailure } from '@/lib/error-message'
import {
  AppError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from '@/lib/errors'

/**
 * `lib/errors` promises the taxonomy exists "so that server actions can map a
 * thrown error to an Arabic message without string matching". These are the
 * tests for the layer that finally does it — and for the one thing it must
 * *not* do, which is turn an access denial into a renderable field message.
 */

const failure = (messageKey: string, details?: Record<string, unknown>): ActionFailure => ({
  ok: false,
  messageKey,
  ...(details ? { details } : {}),
})

describe('lib/error-message — ترجمة الأخطاء المكتوبة إلى العربية', () => {
  it('يحلّ مفتاح الرسالة إلى النص العربي', () => {
    expect(messageForFailure(failure('validation.usernameTaken'))).toBe(
      ar.validation.usernameTaken,
    )
    expect(messageForFailure(failure('users.superAdminRoleRestricted'))).toBe(
      ar.users.superAdminRoleRestricted,
    )
  })

  it('يعوّض {min} من minLength — الرسالة تذكر الرقم', () => {
    const text = messageForFailure(
      failure('validation.passwordTooShort', { minLength: 10 }),
    )

    expect(text).toBe(ar.validation.passwordTooShort.replace('{min}', '10'))
    expect(text).toContain('10')
    expect(text).not.toContain('{min}')
  })

  it('يترك العنصر النائب كما هو حين لا توجد قيمة له', () => {
    // Better a visible `{min}` than a sentence that silently claims a wrong
    // number. The placeholder is a bug report; a fabricated 0 is a lie.
    expect(messageForFailure(failure('validation.passwordTooShort'))).toContain('{min}')
  })

  it('يعود إلى الرسالة العامة عند مفتاح غير معروف', () => {
    expect(messageForFailure(failure('nope.not.a.key'))).toBe(ar.errors.unexpected)
    // A key that resolves to an object, not a string, is equally unusable.
    expect(messageForFailure(failure('validation'))).toBe(ar.errors.unexpected)
  })

  it('يقرأ الخطأ المرمي مباشرة حين يحمل مفتاحًا', () => {
    expect(messageForError(new ConflictError('validation.usernameTaken'))).toBe(
      ar.validation.usernameTaken,
    )
    expect(messageForError(new NotFoundError('PenaltyProfile', 'x'))).toBe(
      ar.errors.notFound,
    )
    expect(messageForError(new ForbiddenError('user.create'))).toBe(ar.errors.forbidden)
  })

  it('يعود إلى الرسالة العامة لأي شيء ليس خطأً مكتوبًا', () => {
    expect(messageForError(new Error('boom'))).toBe(ar.errors.unexpected)
    expect(messageForError('boom')).toBe(ar.errors.unexpected)
    expect(messageForError(null)).toBe(ar.errors.unexpected)
    expect(messageForError(undefined)).toBe(ar.errors.unexpected)
  })
})

describe('lib/action-result — ما يُحوَّل إلى نتيجة وما يظل يُرمى', () => {
  it('يعيد القيمة عند النجاح', async () => {
    await expect(toActionResult(async () => 42)).resolves.toEqual({ ok: true, data: 42 })
  })

  it('يحوّل خطأ القاعدة التجارية إلى بيانات قابلة للنقل', async () => {
    const result = await toActionResult(async () => {
      throw new DomainError('validation.passwordTooShort', { minLength: 12 })
    })

    // Plain data: this has to survive `JSON` across the Server Action boundary,
    // which an `Error` instance does not.
    expect(result).toEqual({
      ok: false,
      messageKey: 'validation.passwordTooShort',
      details: { minLength: 12 },
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('يحوّل التعارض وعدم الوجود أيضًا', async () => {
    await expect(
      toActionResult(async () => {
        throw new ConflictError('validation.usernameTaken', { username: 'a' })
      }),
    ).resolves.toMatchObject({ ok: false, messageKey: 'validation.usernameTaken' })

    await expect(
      toActionResult(async () => {
        throw new NotFoundError('PenaltyProfile', 'ghost')
      }),
    ).resolves.toMatchObject({ ok: false, messageKey: 'errors.notFound' })
  })

  it('لا يبتلع رفض الصلاحية — يظل يُرمى', async () => {
    // The whole point of the split. A permission denial is not a message to
    // render; it is a request that should never have been made, and the RBAC
    // suite asserts these reject.
    await expect(
      toActionResult(async () => {
        throw new ForbiddenError('user.create')
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    await expect(
      toActionResult(async () => {
        throw new UnauthenticatedError()
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError)

    // Including one that carries its own specific key, like the SUPER_ADMIN guard.
    await expect(
      toActionResult(async () => {
        throw new AppError('FORBIDDEN', 'users.superAdminRoleRestricted')
      }),
    ).rejects.toMatchObject({ messageKey: 'users.superAdminRoleRestricted' })
  })

  it('لا يبتلع الأخطاء غير المكتوبة — العطل يظل عطلًا', async () => {
    await expect(
      toActionResult(async () => {
        throw new Error('database is on fire')
      }),
    ).rejects.toThrow('database is on fire')
  })
})
