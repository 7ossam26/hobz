import { describe, expect, it } from 'vitest'

import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isValidUsername,
  normalizeUsername,
  validateUsername,
} from '@/lib/auth/username'

/**
 * SPEC §2: username + password, no email anywhere. The username is therefore
 * the only handle a person has, and it is the throttle key as well — so
 * normalisation has to be identical on create, on edit and at login, or an
 * account can be created that its owner cannot log into.
 */

describe('lib/auth — تطبيع اسم المستخدم', () => {
  it('يخفض الحالة ويقصّ المسافات', () => {
    expect(normalizeUsername('  Ahmed  ')).toBe('ahmed')
    expect(normalizeUsername('AHMED')).toBe('ahmed')
  })

  it('يبقى ثابتًا عند تكراره', () => {
    // Applied at the schema boundary and again inside `authenticate`. If it
    // were not idempotent the second pass would produce a different key.
    const once = normalizeUsername('  Ahmed.Ibrahim ')
    expect(normalizeUsername(once)).toBe(once)
  })
})

describe('lib/auth — التحقق من اسم المستخدم', () => {
  it('يقبل الصيغ المشروعة', () => {
    for (const name of ['ahmed', 'ahmed.ibrahim', 'ahmed_99', 'a-b', 'user1']) {
      expect(validateUsername(name), `rejected "${name}"`).toEqual([])
    }
  })

  it('يقبل الحالة الكبيرة لأنه يطبّعها أولًا', () => {
    expect(isValidUsername('Ahmed')).toBe(true)
  })

  it('يرفض الفواصل في الطرفين', () => {
    for (const name of ['.ahmed', 'ahmed.', '_ahmed', 'ahmed-', '-']) {
      expect(validateUsername(name), `accepted "${name}"`).toContain(
        'validation.usernameFormat',
      )
    }
  })

  it('يرفض المسافات والمحارف غير المسموحة', () => {
    for (const name of ['ah med', 'ahmed@x', 'ahmed/1', 'ahmed#']) {
      expect(validateUsername(name)).toContain('validation.usernameFormat')
    }
  })

  it('يرفض الاسم العربي لأنه معرّف لا اسم عرض', () => {
    // The person's Arabic name lives in `fullName`, which is what the UI shows.
    // A bidi-reordered identifier in an audit row or a log line is unreadable.
    expect(validateUsername('أحمد')).toContain('validation.usernameFormat')
  })

  it('يحترم الحدين الأدنى والأقصى بالضبط', () => {
    expect(validateUsername('a'.repeat(USERNAME_MIN_LENGTH - 1))).toContain(
      'validation.usernameLength',
    )
    expect(validateUsername('a'.repeat(USERNAME_MIN_LENGTH))).toEqual([])
    expect(validateUsername('a'.repeat(USERNAME_MAX_LENGTH))).toEqual([])
    expect(validateUsername('a'.repeat(USERNAME_MAX_LENGTH + 1))).toContain(
      'validation.usernameLength',
    )
  })

  it('يرفض الفارغ', () => {
    expect(isValidUsername('')).toBe(false)
    expect(isValidUsername('   ')).toBe(false)
  })

  it('يعيد مفاتيح i18n لا نصًا عربيًا', () => {
    for (const key of validateUsername('!')) {
      expect(key).toMatch(/^validation\.[A-Za-z]+$/)
    }
  })
})
