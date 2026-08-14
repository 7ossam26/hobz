import { describe, expect, it } from 'vitest'

import {
  EGYPT_MOBILE_PREFIXES,
  foldArabicDigits,
  formatMobileForDisplay,
  isEgyptMobile,
  normalizeEgyptMobile,
  toNationalMobile,
  toWhatsappNumber,
} from '@/lib/phone'

import { EGYPT_PHONES } from '../../fixtures/arabic-names'

/**
 * SPEC §4: `phone(+20…)`. SPEC §8: the number's only use is a `wa.me` deep
 * link. Both facts are why this rejects landlines and normalises on write.
 */

describe('lib/phone — تحويل الأرقام العربية', () => {
  it('يحوّل الأرقام الهندية العربية إلى غربية', () => {
    // Users type on Arabic keyboards; SPEC §2 mandates Western numerals.
    expect(foldArabicDigits('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678')
    expect(foldArabicDigits('۰۱۰۱۲۳۴۵۶۷۸')).toBe('01012345678')
    expect(foldArabicDigits('01012345678')).toBe('01012345678')
    expect(foldArabicDigits('')).toBe('')
  })

  it('يقبل رقمًا مكتوبًا بالأرقام الهندية بالكامل', () => {
    expect(normalizeEgyptMobile('٠١٠١٢٣٤٥٦٧٨')).toBe('+201012345678')
  })
})

describe('lib/phone — التطبيع إلى E.164', () => {
  it('يقبل كل الصيغ المتداولة وينتج صيغة واحدة', () => {
    const expected = '+201012345678'
    for (const input of [
      '01012345678',
      '+201012345678',
      '00201012345678',
      '201012345678',
      '1012345678',
      '010 1234 5678',
      '010-1234-5678',
      '(010) 1234 5678',
      '  01012345678  ',
      '+20 10 1234 5678',
    ]) {
      expect(normalizeEgyptMobile(input), `failed for "${input}"`).toBe(expected)
    }
  })

  it('يقبل شبكات مصر الأربع فقط', () => {
    for (const prefix of EGYPT_MOBILE_PREFIXES) {
      expect(normalizeEgyptMobile(`0${prefix}12345678`)).toBe(`+20${prefix}12345678`)
    }
    // 013, 014, 016–019 are not live Egyptian mobile prefixes.
    for (const prefix of ['13', '14', '16', '17', '18', '19']) {
      expect(normalizeEgyptMobile(`0${prefix}12345678`)).toBeNull()
    }
  })

  it('يرفض ما ليس موبايلًا مصريًا', () => {
    expect(normalizeEgyptMobile('')).toBeNull()
    expect(normalizeEgyptMobile('   ')).toBeNull()
    expect(normalizeEgyptMobile('abc')).toBeNull()
    // Landline (Cairo 02): valid phone, useless for WhatsApp, so rejected.
    expect(normalizeEgyptMobile('0223456789')).toBeNull()
    // Saudi mobile.
    expect(normalizeEgyptMobile('+966501234567')).toBeNull()
  })

  it('يرفض الأطوال الخاطئة عند الحدود', () => {
    // Boundary: 9 digits short, 11 digits long, 10 exact.
    expect(normalizeEgyptMobile('101234567')).toBeNull()
    expect(normalizeEgyptMobile('10123456789')).toBeNull()
    expect(normalizeEgyptMobile('1012345678')).toBe('+201012345678')
  })

  it('لا يخلط رمز الدولة بأرقام المشترك', () => {
    // `20…` is only the country code when the total length says so — an
    // Egyptian national number never starts with 2.
    expect(toNationalMobile('201012345678')).toBe('1012345678')
    expect(toNationalMobile('+201012345678')).toBe('1012345678')
    // 10 digits starting with 2 is not a mobile at all.
    expect(toNationalMobile('2012345678')).toBeNull()
  })

  it('يبقى التطبيع ثابتًا عند تكراره', () => {
    // Applied on every write; running it on already-normalised storage must not
    // change the value.
    const once = normalizeEgyptMobile('01012345678')!
    expect(normalizeEgyptMobile(once)).toBe(once)
  })

  it('يوافق أرقام العيّنات في التجهيزات بصيغتيها', () => {
    for (const phone of EGYPT_PHONES) {
      expect(isEgyptMobile(phone.e164), `fixture ${phone.e164}`).toBe(true)
      expect(normalizeEgyptMobile(phone.e164)).toBe(phone.e164)
      // The whole point of the fixture pair: the local spelling a user types
      // must normalise to the E.164 form the column stores.
      expect(normalizeEgyptMobile(phone.local), `fixture ${phone.local}`).toBe(
        phone.e164,
      )
    }
  })
})

describe('lib/phone — صيغ العرض والواتساب', () => {
  it('ينتج مقطع wa.me بأرقام فقط', () => {
    // SPEC §8: `https://wa.me/<digits>` — no plus sign.
    expect(toWhatsappNumber('+201012345678')).toBe('201012345678')
    expect(toWhatsappNumber('01012345678')).toBe('201012345678')
    expect(toWhatsappNumber('not-a-number')).toBeNull()
  })

  it('يعرض الرقم مجزّأً للقراءة', () => {
    expect(formatMobileForDisplay('+201012345678')).toBe('+20 10 1234 5678')
  })

  it('يعيد المدخل كما هو إذا تعذّر تحليله', () => {
    // A legacy row must still render something rather than an empty cell.
    expect(formatMobileForDisplay('0223456789')).toBe('0223456789')
  })
})
