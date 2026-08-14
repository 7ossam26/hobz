import { describe, expect, it } from 'vitest'

import {
  BCRYPT_COST,
  bcryptCostOf,
  burnPasswordTime,
  hashPassword,
  isBcryptHash,
  needsRehash,
  validatePassword,
  verifyPassword,
} from '@/lib/auth/password'

/**
 * bcrypt at cost 12 (SPEC §3). These tests are slow by construction — each hash
 * is ~250 ms of deliberate work — so the suite verifies the properties that
 * matter and does not hash in a loop.
 */

describe('lib/auth — تجزئة كلمة المرور', () => {
  it('ينتج تجزئة بكلفة 12 لا تساوي النص الأصلي', async () => {
    const hash = await hashPassword('correct-horse-battery')

    expect(hash).not.toBe('correct-horse-battery')
    expect(isBcryptHash(hash)).toBe(true)
    expect(bcryptCostOf(hash)).toBe(BCRYPT_COST)
    expect(BCRYPT_COST).toBe(12)
  })

  it('ينتج تجزئتين مختلفتين لنفس كلمة المرور', async () => {
    // Distinct salts. Equal hashes would mean two people with the same password
    // are visibly identical in a database dump.
    const [a, b] = await Promise.all([
      hashPassword('same-password'),
      hashPassword('same-password'),
    ])
    expect(a).not.toBe(b)
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  })

  it('يقبل كلمة المرور الصحيحة ويرفض غيرها', async () => {
    const hash = await hashPassword('اسم-المستخدم-كلمة-سر')

    expect(await verifyPassword('اسم-المستخدم-كلمة-سر', hash)).toBe(true)
    expect(await verifyPassword('اسم-المستخدم-كلمة-سرr', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
  })

  it('يتعامل مع كلمات المرور العربية ذات المحارف متعددة البايتات', async () => {
    // bcrypt operates on bytes, and Arabic is two bytes per character in UTF-8.
    // A 40-character Arabic passphrase is 80 bytes and still under bcrypt's
    // 72-byte input limit only if truncation is understood — assert round-trip.
    const passphrase = 'كلمة مرور طويلة'
    const hash = await hashPassword(passphrase)
    expect(await verifyPassword(passphrase, hash)).toBe(true)
    expect(await verifyPassword('كلمة مرور طويل', hash)).toBe(false)
  })

  it('يرجع false لتجزئة تالفة بدل أن يرمي استثناء', async () => {
    // One corrupt row must not turn the login page into a 500 that tells the
    // operator nothing.
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
    expect(await verifyPassword('anything', '$2b$12$tooshort')).toBe(false)
  })

  it('يميّز التجزئة الصالحة عن غيرها', () => {
    expect(isBcryptHash('$2b$12$' + 'a'.repeat(53))).toBe(true)
    expect(isBcryptHash('$2a$10$' + 'a'.repeat(53))).toBe(true)
    expect(isBcryptHash('$2b$12$' + 'a'.repeat(52))).toBe(false)
    expect(isBcryptHash('plain')).toBe(false)
    expect(bcryptCostOf('plain')).toBeNull()
  })

  it('يطلب إعادة التجزئة لكلفة أقل من السياسة الحالية', () => {
    // Upgraded transparently on the next successful login — the one moment the
    // plaintext exists.
    expect(needsRehash('$2b$10$' + 'a'.repeat(53))).toBe(true)
    expect(needsRehash('$2b$12$' + 'a'.repeat(53))).toBe(false)
    expect(needsRehash('$2b$14$' + 'a'.repeat(53))).toBe(false)
    expect(needsRehash('garbage')).toBe(true)
  })

  it('يستهلك وقت تحقق حقيقي عند غياب المستخدم', async () => {
    // Guards against username enumeration by timing. The threshold is
    // deliberately far below cost-12's ~250 ms so the test is not flaky on a
    // slow CI box, while still failing outright if the decoy is removed and the
    // call becomes a no-op.
    const started = performance.now()
    await burnPasswordTime()
    expect(performance.now() - started).toBeGreaterThan(20)
  })
})

describe('lib/auth — سياسة كلمة المرور', () => {
  const policy = { minLength: 10 }

  it('يرفض كلمة مرور أقصر من الحد الأدنى ويقبل ما يساويه', () => {
    // Boundary: exactly at the minimum is valid, one short is not.
    expect(validatePassword('a'.repeat(9), policy)).toContain(
      'validation.passwordTooShort',
    )
    expect(validatePassword('a'.repeat(10), policy)).toEqual([])
  })

  it('يقرأ الحد الأدنى من السياسة الممرَّرة لا من ثابت في الكود', () => {
    // CLAUDE.md invariant 4: the number comes from Settings. Changing it must
    // change the verdict.
    expect(validatePassword('short', { minLength: 4 })).toEqual([])
    expect(validatePassword('short', { minLength: 20 })).toContain(
      'validation.passwordTooShort',
    )
  })

  it('يرفض كلمة مرور تحتوي على اسم المستخدم', () => {
    expect(
      validatePassword('ahmed-is-my-password', policy, { username: 'ahmed' }),
    ).toContain('validation.passwordContainsUsername')

    // Case-insensitive, because `Ahmed123456` is not a different secret.
    expect(
      validatePassword('AHMED-is-my-password', policy, { username: 'ahmed' }),
    ).toContain('validation.passwordContainsUsername')
  })

  it('لا يرفض بسبب اسم مستخدم قصير جدًا', () => {
    // A two-character username would match almost any passphrase and make the
    // rule unusable rather than protective.
    expect(validatePassword('abcdefghij', policy, { username: 'ab' })).toEqual([])
  })

  it('يعيد مفاتيح i18n لا نصًا عربيًا', () => {
    // lib/ never renders Arabic (CLAUDE.md UI rules).
    for (const key of validatePassword('x', policy, { username: 'x-user' })) {
      expect(key).toMatch(/^[a-z]+\.[A-Za-z]+$/)
    }
  })

  it('يجمع كل المشاكل بدل التوقف عند أولها', () => {
    const problems = validatePassword('ahmed', { minLength: 10 }, { username: 'ahmed' })
    expect(problems).toHaveLength(2)
  })
})
