import { describe, expect, it } from 'vitest'

import { parseMentions } from '@/modules/task/mentions'

/**
 * Comment bodies are Arabic prose with latin `@handles` embedded in them
 * (docs/TESTING.md §4 axis 10). The interesting cases are all about where a
 * handle *ends* — Arabic script, punctuation and RTL/LTR boundaries are the
 * three ways a naive regex swallows a word it should not.
 */

describe('modules/task/mentions — استخراج الإشارات من نص التعليق', () => {
  it('يستخرج إشارة واحدة من نص عربي', () => {
    expect(parseMentions('من فضلك راجع هذا @ahmed')).toEqual(['ahmed'])
  })

  it('يستخرج عدة إشارات بترتيب ظهورها', () => {
    expect(parseMentions('@sara ثم @ahmed وأخيرًا @omar')).toEqual([
      'sara',
      'ahmed',
      'omar',
    ])
  })

  it('يوحّد الإشارة المكررة في نفس التعليق', () => {
    expect(parseMentions('@ahmed و @ahmed مرة أخرى @AHMED')).toEqual(['ahmed'])
  })

  it('يتعرّف على الإشارة في بداية النص', () => {
    expect(parseMentions('@ahmed تمام')).toEqual(['ahmed'])
  })

  it('يتعرّف على الإشارة بين حروف عربية بلا مسافة', () => {
    expect(parseMentions('راجعها@ahmed')).toEqual(['ahmed'])
  })

  it('يستبعد علامات الترقيم الملتصقة بنهاية الإشارة', () => {
    expect(parseMentions('شكرًا @ahmed.')).toEqual(['ahmed'])
    expect(parseMentions('شكرًا @ahmed، وبعدين؟')).toEqual(['ahmed'])
    expect(parseMentions('(@ahmed)')).toEqual(['ahmed'])
  })

  it('يقبل النقطة والشرطة داخل الاسم', () => {
    expect(parseMentions('@ahmed.hassan و @om-ar و @a_b')).toEqual([
      'ahmed.hassan',
      'om-ar',
      'a_b',
    ])
  })

  it('يخفض حالة الأحرف لأن أسماء المستخدمين صغيرة دائمًا', () => {
    expect(parseMentions('@Ahmed')).toEqual(['ahmed'])
  })

  it('لا يعتبر البريد الإلكتروني إشارة', () => {
    expect(parseMentions('راسله على ahmed@example.com')).toEqual([])
  })

  it('لا يلتقط @ وحدها أو متبوعة برمز', () => {
    expect(parseMentions('@ وحدها')).toEqual([])
    expect(parseMentions('السعر @ 100 جنيه')).toEqual([])
    expect(parseMentions('@-ahmed')).toEqual([])
  })

  it('لا يعتبر الاسم العربي بعد @ إشارة', () => {
    // Usernames are latin by contract (lib/auth/username) — an Arabic word
    // after an `@` is prose, and matching it would produce a handle that can
    // never resolve.
    expect(parseMentions('@أحمد')).toEqual([])
  })

  it('يعيد قائمة فارغة لنص بلا إشارات', () => {
    expect(parseMentions('تعليق عادي بلا أي إشارة')).toEqual([])
    expect(parseMentions('')).toEqual([])
  })

  it('يستخرج الإشارة عبر أسطر متعددة', () => {
    expect(parseMentions('السطر الأول @sara\nالسطر الثاني @ahmed')).toEqual([
      'sara',
      'ahmed',
    ])
  })
})
