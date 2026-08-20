import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ar } from '@/i18n/ar'
import '@/lib/zod-locale'

/**
 * `tests/setup/unit.ts` already imports `lib/zod-locale` for its side effect
 * (every unit test runs with the global config active) — these tests just
 * prove the config actually does what `lib/zod-locale`'s docstring claims.
 */
describe('lib/zod-locale — احتياطي عربي لأخطاء Zod الافتراضية', () => {
  it('حقل مطلوب مفقود بلا رسالة صريحة يظهر بالعربية', () => {
    const schema = z.object({ name: z.string() })
    const result = schema.safeParse({})

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(ar.validation.required)
    }
  })

  it('نوع غير مطابق بلا رسالة صريحة يظهر برسالة التحقق العامة', () => {
    const schema = z.object({ age: z.number() })
    const result = schema.safeParse({ age: 'ليست رقمًا' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(ar.errors.validation)
    }
  })

  it('رسالة صريحة في الفحص تبقى كما هي ولا يتجاوزها الاحتياطي', () => {
    const schema = z.object({ name: z.string().min(1, ar.validation.fullNameRequired) })
    const result = schema.safeParse({ name: '' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(ar.validation.fullNameRequired)
    }
  })
})
