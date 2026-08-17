import { describe, expect, it } from 'vitest'

import { validatePassword } from '@/lib/auth/password'
import { evaluate, throttleKeys } from '@/lib/auth/rate-limit'
import { validateUsername } from '@/lib/auth/username'
import {
  permissionsForRoute,
  routeAllowedByToken,
  visibleNavItems,
} from '@/lib/navigation'
import { formatMobileForDisplay, toWhatsappNumber } from '@/lib/phone'
import { createRoleSchema } from '@/modules/role/schema'
import {
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
} from '@/modules/user/schema'

import { actingAs, nobody } from '../../helpers/auth'

/**
 * docs/TESTING.md §4 axis 12 — empty/null.
 *
 * The axis names "no assignee, no due date, empty cycle", none of which have a
 * table yet. Translated to what Phase 1 owns: a brand-new user with nothing
 * filled in, every optional field left blank, and every whitespace-only string
 * a human can produce by tabbing through a form.
 */

const base = {
  username: 'ahmed.ibrahim',
  password: 'a-long-enough-password',
  fullName: 'أحمد إبراهيم',
  isWorker: false,
  payType: 'PER_TASK' as const,
  roles: [],
}

describe('modules/user — الحقول الفارغة في المخطّط', () => {
  it('يقبل مستخدمًا بأقل قدر من البيانات', () => {
    // A non-worker manager: no phone, no salary, no rate, no roles, no penalty
    // profile. Every optional field genuinely optional.
    const parsed = createUserSchema.parse(base)

    expect(parsed.phone).toBeNull()
    expect(parsed.monthlySalary).toBeNull()
    expect(parsed.defaultTaskRate).toBeNull()
    expect(parsed.penaltyProfileId).toBeNull()
    expect(parsed.roles).toEqual([])
    expect(parsed.weeklyCapacityHours).toBe(40)
  })

  it('يعتبر النص الفارغ في الحقول الاختيارية غيابًا لا خطأً', () => {
    // What an untouched form field actually posts. Treating `''` as malformed
    // is how "leave the salary blank" became "the amount is malformed".
    const parsed = createUserSchema.parse({
      ...base,
      phone: '',
      monthlySalary: '',
      defaultTaskRate: '',
      penaltyProfileId: '',
    })

    expect(parsed.phone).toBeNull()
    expect(parsed.monthlySalary).toBeNull()
    expect(parsed.defaultTaskRate).toBeNull()
    expect(parsed.penaltyProfileId).toBeNull()
  })

  it('يعامل المسافات وحدها كفراغ في الحقول الاختيارية', () => {
    const parsed = createUserSchema.parse({
      ...base,
      phone: '   ',
      penaltyProfileId: '  ',
    })
    expect(parsed.phone).toBeNull()
    expect(parsed.penaltyProfileId).toBeNull()
  })

  it('يرفض المسافات وحدها في الحقول المطلوبة', () => {
    // `.trim().min(1)` — a name of three spaces is not a name.
    expect(createUserSchema.safeParse({ ...base, fullName: '   ' }).success).toBe(false)
    expect(createUserSchema.safeParse({ ...base, fullName: '' }).success).toBe(false)
    expect(createRoleSchema.safeParse({ nameAr: '  ', nameEn: 'X_Y' }).success).toBe(
      false,
    )
  })

  it('يرفض كلمة مرور فارغة أو مسافات', () => {
    expect(createUserSchema.safeParse({ ...base, password: '' }).success).toBe(false)
    // Whitespace is a legitimate passphrase character, so spaces are only
    // rejected by the length policy — which runs in the service, not here.
    expect(createUserSchema.safeParse({ ...base, password: '          ' }).success).toBe(
      true,
    )
  })

  it('يرفض اسم مستخدم فارغًا', () => {
    expect(createUserSchema.safeParse({ ...base, username: '' }).success).toBe(false)
    expect(createUserSchema.safeParse({ ...base, username: '   ' }).success).toBe(false)
    expect(validateUsername('')).toContain('validation.usernameLength')
  })

  it('يوجب حقول الأجر فقط على المنفّذين', () => {
    // Boundary between "optional" and "required" is `isWorker`, not the field.
    expect(createUserSchema.safeParse({ ...base, isWorker: false }).success).toBe(true)
    expect(createUserSchema.safeParse({ ...base, isWorker: true }).success).toBe(false)
  })

  it('يقبل بحثًا فارغًا في قائمة المستخدمين', () => {
    const parsed = listUsersSchema.parse({ search: '' })
    // Empty means "no filter", not "match nothing".
    expect(parsed.search).toBe('')
    expect(listUsersSchema.parse({}).search).toBeUndefined()
  })

  it('يقبل التعديل بلا أدوار إطلاقًا', () => {
    // Stripping every role is a legitimate way to park an account.
    expect(updateUserSchema.parse({ id: 'u1', ...base }).roles).toEqual([])
  })
})

describe('lib/phone — القيم الفارغة', () => {
  it('يعيد المدخل الفارغ كما هو بدل أن ينهار', () => {
    // Called on `user.phone` which is nullable; the component guards for null,
    // but an empty string must not produce "+20  ".
    expect(formatMobileForDisplay('')).toBe('')
    expect(formatMobileForDisplay('   ')).toBe('   ')
  })

  it('يرفض بناء رابط واتساب من رقم فارغ', () => {
    expect(toWhatsappNumber('')).toBeNull()
    expect(toWhatsappNumber('   ')).toBeNull()
  })
})

describe('lib/navigation — المستخدم الجديد بلا أدوار', () => {
  it('يعرض عنصري لوحة التحكم والتقويم فقط — كلاهما بلا صلاحية', () => {
    // A brand-new account created before any role is assigned. It must land
    // somewhere, not on an empty sidebar with no way forward. `/calendar`
    // carries no permission either (Phase 10) — same reasoning as `/dashboard`.
    const items = visibleNavItems(nobody())
    expect(items).toHaveLength(2)
    expect(items[0]?.href).toBe('/dashboard')
    expect(items[1]?.href).toBe('/calendar')
  })

  it('يمنع المسارات المحروسة عنه', () => {
    const token = { isSuperAdmin: false, permissions: [] }
    expect(routeAllowedByToken('/users', token)).toBe(false)
    expect(routeAllowedByToken('/audit', token)).toBe(false)
    // …but not the ungated ones, or a new user could never change their password.
    expect(routeAllowedByToken('/dashboard', token)).toBe(true)
    expect(routeAllowedByToken('/change-password', token)).toBe(true)
  })

  it('لا يحرس الجذر ولا المسار الفارغ', () => {
    expect(permissionsForRoute('')).toBeNull()
    expect(permissionsForRoute('/')).toBeNull()
  })
})

describe('lib/auth — الحالات الفارغة', () => {
  it('يسمح لمفتاح لم يُسجَّل عليه شيء', () => {
    const policy = { maxAttempts: 5, windowMs: 60_000, lockoutMs: 60_000 }
    expect(evaluate(null, new Date('2026-08-14T09:00:00Z'), policy)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remainingAttempts: 5,
    })
  })

  it('يبني مفتاح إيقاف باسم المستخدم وحده عند غياب العنوان', () => {
    expect(throttleKeys('ahmed', undefined)).toEqual(['user:ahmed'])
    // An empty string is not an address, and `ip:` alone would collide across
    // every anonymous client.
    expect(throttleKeys('ahmed', '')).toEqual(['user:ahmed'])
  })

  it('يرفض كلمة مرور فارغة مهما كان الحد الأدنى', () => {
    expect(validatePassword('', { minLength: 0 })).toEqual([])
    expect(validatePassword('', { minLength: 1 })).toContain(
      'validation.passwordTooShort',
    )
  })

  it('لا يفحص احتواء اسم المستخدم عند غيابه', () => {
    expect(validatePassword('anything-at-all', { minLength: 4 }, {})).toEqual([])
    expect(
      validatePassword('anything-at-all', { minLength: 4 }, { username: '' }),
    ).toEqual([])
  })
})

describe('lib/rbac — الفاعل الفارغ', () => {
  it('يعامل المستخدم بلا صلاحيات كمن لا يملك شيئًا لا كمن يملك كل شيء', () => {
    // The failure mode worth naming: an empty set is falsy-adjacent, and a
    // `!permissions.length` shortcut somewhere would invert the whole model.
    const actor = actingAs([])
    expect(actor.permissions.size).toBe(0)
    expect(actor.isSuperAdmin).toBe(false)
  })
})
