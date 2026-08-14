import { describe, expect, it } from 'vitest'

import { matches, normalizeArabic, rankMatches, scoreMatch, tokenize } from '@/lib/search'

/**
 * docs/TESTING.md §4 axis 10: "name normalization in search (`احمد` finds
 * `أحمد`)".
 *
 * Every case below is a spelling a real user types on a real keyboard. The
 * failure mode this module prevents is not a missing feature — it is a manager
 * typing a name they can see on the screen behind the palette, getting nothing,
 * and concluding the person is not in the system.
 */

describe('normalizeArabic', () => {
  it('يزيل التشكيل', () => {
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد')
    expect(normalizeArabic('عَبْدُ الرَّحْمٰن')).toBe(normalizeArabic('عبد الرحمن'))
  })

  it('يزيل التطويل', () => {
    expect(normalizeArabic('مـــحـــمـــد')).toBe('محمد')
  })

  it('يوحّد صور الألف والهمزة', () => {
    const forms = ['أحمد', 'إحمد', 'آحمد', 'احمد', 'ٱحمد']
    for (const form of forms) expect(normalizeArabic(form)).toBe('احمد')
  })

  it('يوحّد الياء والألف المقصورة', () => {
    expect(normalizeArabic('يحيى')).toBe(normalizeArabic('يحيي'))
    expect(normalizeArabic('مصطفى')).toBe(normalizeArabic('مصطفي'))
  })

  it('يوحّد التاء المربوطة مع الهاء', () => {
    expect(normalizeArabic('فاطمة')).toBe(normalizeArabic('فاطمه'))
    expect(normalizeArabic('مكافأة')).toBe(normalizeArabic('مكافاه'))
  })

  it('يوحّد همزة الواو وهمزة الياء', () => {
    expect(normalizeArabic('مؤمن')).toBe(normalizeArabic('مومن'))
    expect(normalizeArabic('رئيس')).toBe(normalizeArabic('رييس'))
  })

  it('يُسقط الهمزة المفردة فتتطابق الكتابتان', () => {
    expect(normalizeArabic('سماء')).toBe(normalizeArabic('سما'))
  })

  it('يوحّد الحروف الفارسية والأردية الشبيهة', () => {
    expect(normalizeArabic('کتاب')).toBe(normalizeArabic('كتاب'))
    expect(normalizeArabic('یمن')).toBe(normalizeArabic('يمن'))
  })

  it('يحوّل الأرقام العربية-الهندية إلى غربية', () => {
    expect(normalizeArabic('٢٠٢٦')).toBe('2026')
    expect(normalizeArabic('مشروع ٧')).toBe('مشروع 7')
  })

  it('يوحّد حالة الحروف اللاتينية ويزيل التشكيل اللاتيني', () => {
    expect(normalizeArabic('Ahmed')).toBe('ahmed')
    expect(normalizeArabic('José')).toBe('jose')
  })

  it('يحوّل الترقيم إلى فواصل ويضغط المسافات', () => {
    expect(normalizeArabic('  أحمد،   محمود  ')).toBe('احمد محمود')
    expect(normalizeArabic('ACME-01')).toBe('acme 01')
  })

  it('دالة ثابتة: تطبيقها مرتين لا يغيّر النتيجة', () => {
    const inputs = ['أحمد مُحَمَّد', 'فاطمة الزهراء', 'يحيى', 'ACME-01', '٢٠٢٦']
    for (const input of inputs) {
      const once = normalizeArabic(input)
      expect(normalizeArabic(once)).toBe(once)
    }
  })

  it('يتعامل مع النص الفارغ', () => {
    expect(normalizeArabic('')).toBe('')
    expect(normalizeArabic('   ')).toBe('')
    expect(normalizeArabic('،،،')).toBe('')
  })
})

describe('tokenize', () => {
  it('يقسّم على المسافات بعد التوحيد', () => {
    expect(tokenize('أحمد محمود')).toEqual(['احمد', 'محمود'])
  })

  it('يعيد قائمة فارغة لاستعلام فارغ', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('scoreMatch', () => {
  it('«احمد» تجد «أحمد»', () => {
    expect(matches('أحمد محمود', 'احمد')).toBe(true)
  })

  it('«فاطمه» تجد «فاطمة» و«يحيي» تجد «يحيى»', () => {
    expect(matches('فاطمة الزهراء حسن', 'فاطمه')).toBe(true)
    expect(matches('يحيى إبراهيم', 'يحيي')).toBe(true)
  })

  it('يرتّب المطابقة التامة قبل البادئة قبل الاحتواء', () => {
    const exact = scoreMatch('المهام', 'المهام')!
    const prefix = scoreMatch('المهام المتأخرة', 'المهام')!
    const contains = scoreMatch('قائمة المهام المتأخرة', 'المهام')!

    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(contains)
  })

  it('يفضّل بداية الكلمة على وسط الكلمة', () => {
    const wordStart = scoreMatch('تجديد موقع مها', 'مها')!
    const midWord = scoreMatch('استكمال', 'كما')!
    expect(wordStart).toBeGreaterThan(midWord)
  })

  it('يفضّل النص الأقصر عند تساوي نوع المطابقة', () => {
    const short = scoreMatch('مهمة', 'مهمة')!
    const long = scoreMatch('مهمة', 'مهمة')!
    expect(short).toBe(long)

    const shortPrefix = scoreMatch('مهام', 'مه')!
    const longPrefix = scoreMatch('مهام المشروع الكبير جدًا', 'مه')!
    expect(shortPrefix).toBeGreaterThan(longPrefix)
  })

  it('يطابق الكلمات بأي ترتيب', () => {
    expect(matches('علي أحمد', 'احمد علي')).toBe(true)
  })

  it('يعيد null عند عدم المطابقة', () => {
    expect(scoreMatch('أحمد محمود', 'خالد')).toBeNull()
  })

  it('الاستعلام الفارغ يطابق كل شيء بدرجة صفر', () => {
    expect(scoreMatch('أي نص', '')).toBe(0)
    expect(scoreMatch('', '')).toBe(0)
  })

  it('النص الفارغ لا يطابق استعلامًا حقيقيًا', () => {
    expect(scoreMatch('', 'احمد')).toBeNull()
  })

  it('يطابق الأرقام العربية مع الغربية في الاتجاهين', () => {
    expect(matches('مشروع 2026', 'مشروع ٢٠٢٦')).toBe(true)
    expect(matches('مشروع ٢٠٢٦', 'مشروع 2026')).toBe(true)
  })
})

describe('rankMatches', () => {
  const people = [
    { name: 'محمود أحمد', username: 'mahmoud' },
    { name: 'أحمد محمود', username: 'ahmed' },
    { name: 'خالد سعيد', username: 'khaled' },
    { name: 'أحمد', username: 'ahmed2' },
  ]

  const fields = (person: (typeof people)[number]) => [person.name, person.username]

  it('يُسقط غير المطابق ويرتّب الأفضل أولًا', () => {
    const results = rankMatches(people, 'احمد', { fields })

    expect(results.map((person) => person.username)).not.toContain('khaled')
    expect(results[0]?.username).toBe('ahmed2')
  })

  it('يطابق على أي حقل، لا الاسم فقط', () => {
    const results = rankMatches(people, 'khaled', { fields })
    expect(results).toHaveLength(1)
    expect(results[0]?.username).toBe('khaled')
  })

  it('يحترم الحد الأقصى للنتائج', () => {
    expect(rankMatches(people, '', { fields, limit: 2 })).toHaveLength(2)
  })

  it('ترتيب مستقر: المتساوون يحتفظون بترتيب الإدخال', () => {
    // Equal in every scoring input, including length: the brevity tiebreaker
    // below would otherwise be what is under test rather than the stability.
    const equal = [
      { name: 'مشروع ألف', username: 'a' },
      { name: 'مشروع دال', username: 'b' },
      { name: 'مشروع جيم', username: 'c' },
    ]
    const results = rankMatches(equal, 'مشروع', { fields })
    expect(results.map((entry) => entry.username)).toEqual(['a', 'b', 'c'])
  })

  it('الأقصر يسبق الأطول عند تساوي نوع المطابقة', () => {
    const lengths = [
      { name: 'مشروع تجديد الموقع بالكامل', username: 'long' },
      { name: 'مشروع', username: 'short' },
    ]
    const results = rankMatches(lengths, 'مشروع', { fields })
    expect(results[0]?.username).toBe('short')
  })

  it('يتجاهل الحقول الفارغة دون أن ينهار', () => {
    const sparse = [{ name: 'أحمد', username: null }]
    const results = rankMatches(sparse, 'احمد', {
      fields: (entry) => [entry.name, entry.username],
    })
    expect(results).toHaveLength(1)
  })
})
