import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TABLE_STATE,
  PAGE_SIZES,
  activeFilterCount,
  pageCount,
  pageRange,
  parseTableState,
  toQueryString,
  toSearchParams,
  withColumnVisibility,
  withFacetValue,
  withPage,
  withPageSize,
  withSearch,
  withSort,
  withoutFacet,
  withoutFilters,
} from '@/components/shared/data-table/state'
import type { TableState } from '@/components/shared/data-table/types'

/**
 * The table is server-driven: this module is the contract between the URL a
 * browser holds and the Prisma query a Server Component runs. Both sides call
 * these functions, so a bug here is a bug in *what data the user is shown*, not
 * in how it looks.
 *
 * The hostile inputs matter as much as the happy path — anyone can type
 * anything into the address bar, and none of it may reach a query untamed.
 */

const parse = (query: string): TableState => parseTableState(new URLSearchParams(query))

describe('parseTableState', () => {
  it('يعيد القيم الافتراضية لعنوان فارغ', () => {
    expect(parse('')).toEqual(DEFAULT_TABLE_STATE)
  })

  it('يقرأ الصفحة والحجم والترتيب والبحث', () => {
    const state = parse(
      'page=3&size=50&sort=fullName&dir=desc&q=%D8%A3%D8%AD%D9%85%D8%AF',
    )

    expect(state.page).toBe(3)
    expect(state.pageSize).toBe(50)
    expect(state.sort).toBe('fullName')
    expect(state.dir).toBe('desc')
    expect(state.search).toBe('أحمد')
  })

  it('يقرأ التصفية من البادئة f_', () => {
    expect(parse('f_status=ACTIVE,BLOCKED&f_priority=URGENT').filters).toEqual({
      status: ['ACTIVE', 'BLOCKED'],
      priority: ['URGENT'],
    })
  })

  it('يتجاهل التصفية الفارغة', () => {
    expect(parse('f_status=&f_=X&f_priority=,,').filters).toEqual({})
  })

  it('يتجاهل الأعمدة المخفية الفارغة', () => {
    expect(parse('hide=phone,,createdAt').hidden).toEqual(['phone', 'createdAt'])
  })

  it('يرفض رقم صفحة غير صالح ويعود للافتراضي', () => {
    expect(parse('page=abc').page).toBe(1)
    expect(parse('page=0').page).toBe(1)
    expect(parse('page=-5').page).toBe(1)
  })

  it('يحدّ حجم الصفحة بأكبر حجم معروض', () => {
    // An unbounded `?size=` in the address bar is a denial-of-service against
    // our own database, not a user preference.
    const max = Math.max(...PAGE_SIZES)
    expect(parse('size=100000').pageSize).toBe(max)
    expect(parse('size=0').pageSize).toBe(1)
  })

  it('يتجاهل اتجاه ترتيب غير معروف', () => {
    expect(parse('sort=name&dir=sideways').dir).toBe('asc')
  })

  it('يقبل قيمًا افتراضية من الصفحة', () => {
    const state = parseTableState(new URLSearchParams(''), {
      pageSize: 10,
      hidden: ['createdAt'],
    })
    expect(state.pageSize).toBe(10)
    expect(state.hidden).toEqual(['createdAt'])
  })
})

describe('toSearchParams', () => {
  it('يحذف كل ما هو على قيمته الافتراضية', () => {
    // `/users` and `/users?page=1&size=25&dir=asc` must not be two history
    // entries for one screen, or the back button appears to do nothing.
    expect(toQueryString(DEFAULT_TABLE_STATE)).toBe('')
  })

  it('يكتب الاتجاه فقط مع وجود عمود ترتيب', () => {
    const state: TableState = { ...DEFAULT_TABLE_STATE, dir: 'desc' }
    expect(toSearchParams(state).has('dir')).toBe(false)

    const sorted: TableState = { ...state, sort: 'fullName' }
    expect(toSearchParams(sorted).get('dir')).toBe('desc')
  })

  it('يرتّب التصفية فينتج عنوان واحد مهما كان ترتيب الاختيار', () => {
    const a: TableState = {
      ...DEFAULT_TABLE_STATE,
      filters: { status: ['B', 'A'], priority: ['HIGH'] },
    }
    const b: TableState = {
      ...DEFAULT_TABLE_STATE,
      filters: { priority: ['HIGH'], status: ['A', 'B'] },
    }
    expect(toQueryString(a)).toBe(toQueryString(b))
  })

  it('رحلة ذهاب وعودة: التسلسل ثم التحليل يعيد الحالة نفسها', () => {
    const state: TableState = {
      page: 4,
      pageSize: 50,
      sort: 'dueDate',
      dir: 'desc',
      filters: { status: ['ASSIGNED', 'IN_PROGRESS'], priority: ['URGENT'] },
      search: 'أحمد محمود',
      hidden: ['phone'],
    }
    expect(parseTableState(toSearchParams(state))).toEqual(state)
  })
})

describe('mutations', () => {
  const base: TableState = { ...DEFAULT_TABLE_STATE, page: 7 }

  it('البحث يعيد إلى الصفحة الأولى', () => {
    // Narrowing a result set while on page 7 is the classic way to land on an
    // empty screen and conclude there is no data.
    expect(withSearch(base, 'أحمد').page).toBe(1)
  })

  it('تغيير التصفية أو حجم الصفحة يعيد إلى الصفحة الأولى', () => {
    expect(withFacetValue(base, 'status', 'ACTIVE', true).page).toBe(1)
    expect(withPageSize(base, 50).page).toBe(1)
    expect(withoutFacet(base, 'status').page).toBe(1)
    expect(withoutFilters(base).page).toBe(1)
  })

  it('الترتيب ثلاثي الحالات: تصاعدي ثم تنازلي ثم بلا ترتيب', () => {
    const first = withSort(DEFAULT_TABLE_STATE, 'name')
    expect([first.sort, first.dir]).toEqual(['name', 'asc'])

    const second = withSort(first, 'name')
    expect([second.sort, second.dir]).toEqual(['name', 'desc'])

    const third = withSort(second, 'name')
    expect(third.sort).toBeNull()
  })

  it('الترتيب على عمود آخر يبدأ تصاعديًا', () => {
    const sorted = withSort(
      { ...DEFAULT_TABLE_STATE, sort: 'name', dir: 'desc' },
      'value',
    )
    expect([sorted.sort, sorted.dir]).toEqual(['value', 'asc'])
  })

  it('اختيار قيمة تصفية مرتين لا يكرّرها', () => {
    const once = withFacetValue(DEFAULT_TABLE_STATE, 'status', 'ACTIVE', true)
    const twice = withFacetValue(once, 'status', 'ACTIVE', true)
    expect(twice.filters['status']).toEqual(['ACTIVE'])
  })

  it('إلغاء آخر قيمة يحذف مفتاح التصفية بالكامل', () => {
    const on = withFacetValue(DEFAULT_TABLE_STATE, 'status', 'ACTIVE', true)
    const off = withFacetValue(on, 'status', 'ACTIVE', false)
    expect(off.filters).toEqual({})
  })

  it('مسح التصفية يبقي الترتيب والأعمدة الظاهرة', () => {
    // Sorting and column visibility are how the user chose to *read* the
    // table, not what they asked it to show.
    const state: TableState = {
      ...DEFAULT_TABLE_STATE,
      sort: 'name',
      dir: 'desc',
      hidden: ['phone'],
      search: 'أحمد',
      filters: { status: ['ACTIVE'] },
    }
    const cleared = withoutFilters(state)

    expect(cleared.filters).toEqual({})
    expect(cleared.search).toBe('')
    expect(cleared.sort).toBe('name')
    expect(cleared.hidden).toEqual(['phone'])
  })

  it('إخفاء عمود وإظهاره يعيد الحالة كما كانت', () => {
    const hidden = withColumnVisibility(DEFAULT_TABLE_STATE, 'phone', false)
    expect(hidden.hidden).toEqual(['phone'])

    const shown = withColumnVisibility(hidden, 'phone', true)
    expect(shown.hidden).toEqual([])
  })

  it('لا يقبل رقم صفحة أقل من واحد', () => {
    expect(withPage(base, 0).page).toBe(1)
    expect(withPage(base, -3).page).toBe(1)
  })

  it('كل دالة تعيد حالة جديدة ولا تعدّل الأصل', () => {
    const original: TableState = {
      ...DEFAULT_TABLE_STATE,
      filters: { status: ['ACTIVE'] },
    }
    const snapshot = JSON.stringify(original)

    withFacetValue(original, 'status', 'BLOCKED', true)
    withoutFilters(original)
    withSort(original, 'name')

    expect(JSON.stringify(original)).toBe(snapshot)
  })
})

describe('derived values', () => {
  it('يحسب عدد التصفية النشطة بما فيها البحث', () => {
    expect(
      activeFilterCount({
        ...DEFAULT_TABLE_STATE,
        filters: { status: ['A', 'B'], priority: ['HIGH'] },
        search: 'أحمد',
      }),
    ).toBe(4)
  })

  it('عدد الصفحات لا يقل عن واحد ولو كان الجدول فارغًا', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(1, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
    expect(pageCount(50, 25)).toBe(2)
  })

  it('يحسب المدى المعروض ويقصّه على الإجمالي', () => {
    expect(pageRange({ ...DEFAULT_TABLE_STATE, page: 2 }, 137)).toEqual({
      from: 26,
      to: 50,
    })
    expect(pageRange({ ...DEFAULT_TABLE_STATE, page: 6 }, 137)).toEqual({
      from: 126,
      to: 137,
    })
  })

  it('المدى صفر عند غياب الصفوف', () => {
    expect(pageRange(DEFAULT_TABLE_STATE, 0)).toEqual({ from: 0, to: 0 })
  })
})
