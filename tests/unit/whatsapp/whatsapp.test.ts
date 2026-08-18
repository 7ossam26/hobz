import { describe, expect, it } from 'vitest'

import { whatsappHref } from '@/components/data/user-chip'
import { fillWhatsappTemplate } from '@/lib/whatsapp'

/**
 * SPEC §8: `https://wa.me/<phone>?text=<url-encoded Arabic template>`.
 *
 * Two things must hold independently: the template's `{placeholders}` fill in
 * with the event's own data (`fillWhatsappTemplate`), and the filled Arabic
 * sentence survives becoming a URL query parameter (`whatsappHref`,
 * `components/data/user-chip.tsx`).
 */

describe('lib/whatsapp — تعبئة قوالب واتساب', () => {
  it('يستبدل كل عنصر نائب بقيمته', () => {
    const filled = fillWhatsappTemplate(
      'السلام عليكم {name}، تم إسناد مهمة "{task}" إليك، موعد التسليم {due}.',
      { name: 'أحمد', task: 'تصميم الشعار', due: '14 أغسطس 2026' },
    )
    expect(filled).toBe(
      'السلام عليكم أحمد، تم إسناد مهمة "تصميم الشعار" إليك، موعد التسليم 14 أغسطس 2026.',
    )
  })

  it('يترك القالب كما هو عند غياب كل المتغيرات', () => {
    expect(fillWhatsappTemplate('نص بلا متغيرات', {})).toBe('نص بلا متغيرات')
  })

  it('يتجاهل عنصرًا نائبًا لم تُقدَّم قيمته', () => {
    const filled = fillWhatsappTemplate('مبلغ الخصم {amount} عن مهمة {task}', {
      amount: '150.00',
    })
    expect(filled).toBe('مبلغ الخصم 150.00 عن مهمة {task}')
  })

  it('يستبدل كل التكرارات لنفس العنصر النائب', () => {
    const filled = fillWhatsappTemplate('{name} {name}', { name: 'سارة' })
    expect(filled).toBe('سارة سارة')
  })
})

describe('components/data/user-chip — رابط واتساب', () => {
  it('يبني رابط wa.me برقم دولي بلا علامة +', () => {
    const href = whatsappHref('+201012345678')
    expect(href).toBe('https://wa.me/201012345678')
  })

  it('يرجع null لرقم غير مصري وغير محمول', () => {
    expect(whatsappHref('+15551234567')).toBeNull()
    expect(whatsappHref('not-a-phone')).toBeNull()
  })

  it('يُرمّز النص العربي في معامل text', () => {
    const message = 'تذكير: مهمة "تصميم الشعار" تجاوزت موعد التسليم.'
    const href = whatsappHref('+201012345678', message)

    expect(href).toBe(`https://wa.me/201012345678?text=${encodeURIComponent(message)}`)
    // The encoded form must round-trip back to the exact Arabic sentence —
    // the only property that actually matters to a منفّذ reading the message.
    const [, query] = (href ?? '').split('?text=')
    expect(decodeURIComponent(query ?? '')).toBe(message)
  })

  it('يرمّز المتغيرات المُعبَّأة داخل القالب قبل بناء الرابط', () => {
    const message = fillWhatsappTemplate(
      'تم خصم {amount} من مستحقاتك بخصوص مهمة "{task}".',
      { amount: '75.00', task: 'مراجعة نصوص الحملة' },
    )
    const href = whatsappHref('+201123456789', message)

    expect(href).not.toBeNull()
    expect(decodeURIComponent((href ?? '').split('?text=')[1] ?? '')).toBe(message)
    // Arabic spaces and quotation marks are exactly the characters that break a
    // naive string-concatenation URL — asserting the raw href never contains
    // them unencoded is what would catch that regression.
    expect(href).not.toMatch(/[؀-ۿ]/)
  })
})
