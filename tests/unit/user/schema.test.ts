import { describe, expect, it } from 'vitest'

import {
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
} from '@/modules/user/schema'

/**
 * The schema is the boundary where normalisation happens — the username the
 * throttle keys on, the username stored, and the username typed at login are
 * all produced here, which is the only way they are guaranteed to match.
 */

const valid = {
  username: 'ahmed.ibrahim',
  password: 'a-long-enough-password',
  fullName: 'أحمد إبراهيم',
  phone: '01012345678',
  isWorker: true,
  payType: 'PER_TASK' as const,
  defaultTaskRate: '500.00',
  weeklyCapacityHours: 40,
  roles: [],
}

describe('modules/user — مخطّط الإنشاء', () => {
  it('يقبل مدخلًا صحيحًا ويطبّع الهاتف واسم المستخدم', () => {
    const parsed = createUserSchema.parse({ ...valid, username: '  Ahmed.Ibrahim ' })

    expect(parsed.username).toBe('ahmed.ibrahim')
    expect(parsed.phone).toBe('+201012345678')
  })

  it('يقبل غياب الهاتف ويعتبر الفراغ غيابًا', () => {
    // An untouched form field sends `''`. Treating that as a validation failure
    // would make an optional field effectively required.
    expect(createUserSchema.parse({ ...valid, phone: '' }).phone).toBeNull()
    expect(createUserSchema.parse({ ...valid, phone: undefined }).phone).toBeNull()
  })

  it('يرفض رقمًا ليس موبايلًا مصريًا', () => {
    expect(createUserSchema.safeParse({ ...valid, phone: '0223456789' }).success).toBe(
      false,
    )
    expect(createUserSchema.safeParse({ ...valid, phone: '+966501234567' }).success).toBe(
      false,
    )
  })

  it('يرفض اسم مستخدم بصيغة غير صالحة', () => {
    for (const username of ['ah med', '.ahmed', 'أحمد', 'ab']) {
      expect(
        createUserSchema.safeParse({ ...valid, username }).success,
        `accepted "${username}"`,
      ).toBe(false)
    }
  })

  it('يوجب الراتب الشهري لأصحاب الأجر الشهري', () => {
    // A SALARY worker with no salary makes dailyRate() — and therefore every
    // PCT_DAILY_RATE_PER_DAY penalty in Phase 8 — divide by nothing.
    const result = createUserSchema.safeParse({
      ...valid,
      payType: 'SALARY',
      monthlySalary: undefined,
      defaultTaskRate: undefined,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path.includes('monthlySalary'))).toBe(true)
  })

  it('يوجب أجر المهمة لأصحاب الأجر بالمهمة', () => {
    const result = createUserSchema.safeParse({
      ...valid,
      payType: 'PER_TASK',
      defaultTaskRate: undefined,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path.includes('defaultTaskRate'))).toBe(
      true,
    )
  })

  it('يوجب الحقلين معًا للأجر المختلط', () => {
    expect(
      createUserSchema.safeParse({
        ...valid,
        payType: 'HYBRID',
        monthlySalary: '8000.00',
        defaultTaskRate: '300.00',
      }).success,
    ).toBe(true)

    expect(
      createUserSchema.safeParse({
        ...valid,
        payType: 'HYBRID',
        monthlySalary: '8000.00',
        defaultTaskRate: undefined,
      }).success,
    ).toBe(false)
  })

  it('لا يوجب أي حقل أجر لغير المنفّذين', () => {
    // A manager who never receives a task has no pay profile to fill in.
    expect(
      createUserSchema.safeParse({
        ...valid,
        isWorker: false,
        payType: 'SALARY',
        monthlySalary: undefined,
        defaultTaskRate: undefined,
      }).success,
    ).toBe(true)
  })

  it('يبقي المال نصًا ولا يحوّله إلى رقم', () => {
    // CLAUDE.md invariant 2. A `number` here would lose precision before the
    // value ever reached the Decimal column.
    const parsed = createUserSchema.parse({ ...valid, defaultTaskRate: '1234.56' })
    expect(parsed.defaultTaskRate).toBe('1234.56')
    expect(typeof parsed.defaultTaskRate).toBe('string')
  })

  it('يرفض المال بصيغة غير صالحة', () => {
    for (const amount of ['-1', '12.345', 'abc', '1,000']) {
      expect(
        createUserSchema.safeParse({ ...valid, defaultTaskRate: amount }).success,
        `accepted "${amount}"`,
      ).toBe(false)
    }
  })

  it('يحدّ الطاقة الأسبوعية بين ساعة و168 ساعة', () => {
    // Boundaries: a week has 168 hours; zero capacity would divide by nothing
    // in Phase 10's utilisation maths.
    expect(createUserSchema.safeParse({ ...valid, weeklyCapacityHours: 0 }).success).toBe(
      false,
    )
    expect(createUserSchema.safeParse({ ...valid, weeklyCapacityHours: 1 }).success).toBe(
      true,
    )
    expect(
      createUserSchema.safeParse({ ...valid, weeklyCapacityHours: 168 }).success,
    ).toBe(true)
    expect(
      createUserSchema.safeParse({ ...valid, weeklyCapacityHours: 169 }).success,
    ).toBe(false)
  })

  it('يقبل خانة صيغة الخصم فارغة', () => {
    // SPEC R2's seam. PenaltyProfile is a Phase 8 table.
    expect(createUserSchema.parse({ ...valid }).penaltyProfileId).toBeNull()
    expect(
      createUserSchema.parse({ ...valid, penaltyProfileId: 'pp_1' }).penaltyProfileId,
    ).toBe('pp_1')
  })
})

describe('modules/user — مخطّط التعديل', () => {
  it('لا يقبل تغيير اسم المستخدم', () => {
    // It is the login handle and the throttle key; renaming it mid-life locks
    // the person out of their own account.
    const parsed = updateUserSchema.parse({
      id: 'u1',
      ...valid,
      username: 'someone.else',
    })
    expect(parsed).not.toHaveProperty('username')
  })

  it('لا يقبل تغيير كلمة المرور', () => {
    // That is `adminResetPassword` or `changeOwnPassword`, both audited
    // separately.
    const parsed = updateUserSchema.parse({ id: 'u1', ...valid, password: 'sneaky' })
    expect(parsed).not.toHaveProperty('password')
  })

  it('يوجب المعرّف', () => {
    expect(updateUserSchema.safeParse({ ...valid }).success).toBe(false)
  })
})

describe('modules/user — مخطّط القائمة', () => {
  it('يضع صفحة وحجمًا افتراضيين', () => {
    expect(listUsersSchema.parse({})).toMatchObject({ page: 1, pageSize: 25 })
  })

  it('يحدّ حجم الصفحة فلا تُطلب كل الصفوف دفعة واحدة', () => {
    // SPEC §9: paginate everything.
    expect(listUsersSchema.safeParse({ pageSize: 101 }).success).toBe(false)
    expect(listUsersSchema.safeParse({ pageSize: 100 }).success).toBe(true)
    expect(listUsersSchema.safeParse({ page: 0 }).success).toBe(false)
  })
})
