import { describe, expect, it } from 'vitest'

import { dateColumnValue, expandHolidayRows, expandLeaveRows } from '@/lib/calendar'

/**
 * The two pure expanders `lib/calendar/source.ts` uses to turn database rows
 * into the date-key sets the arithmetic wants.
 *
 * They are the seam where a `@db.Date` column becomes a Cairo date key, and
 * the one place a recurrence is unfolded — both worth pinning without a
 * database, because both fail silently: an over-eager expansion invents a day
 * off, and a stingy one invents a day of lateness.
 */

const holiday = (date: string, isRecurring = false) => ({
  date: dateColumnValue(date),
  isRecurring,
})

describe('expandHolidayRows', () => {
  it('يقبل الصف غير المتكرر داخل النطاق ويرفضه خارجه', () => {
    const rows = [holiday('2026-03-20'), holiday('2027-03-09')]
    expect([...expandHolidayRows(rows, '2026-01-01', '2026-12-31')]).toEqual([
      '2026-03-20',
    ])
  })

  it('يوسّع الصف المتكرر على كل سنة يلمسها النطاق', () => {
    const keys = expandHolidayRows(
      [holiday('2020-01-07', true)],
      '2026-06-01',
      '2028-06-01',
    )
    expect([...keys].sort()).toEqual(['2027-01-07', '2028-01-07'])
  })

  it('يقصّ التكرار على حدود النطاق نفسها', () => {
    const keys = expandHolidayRows(
      [holiday('2020-05-01', true)],
      '2026-05-01',
      '2026-05-01',
    )
    expect([...keys]).toEqual(['2026-05-01'])
  })

  it('لا يخترع 29 فبراير في سنة عادية', () => {
    const keys = expandHolidayRows(
      [holiday('2028-02-29', true)],
      '2026-01-01',
      '2029-12-31',
    )
    expect([...keys].sort()).toEqual(['2028-02-29'])
  })

  it('يجمع الصفوف المتكررة وغير المتكررة بلا تكرار', () => {
    const keys = expandHolidayRows(
      [holiday('2026-01-07', true), holiday('2026-01-07')],
      '2026-01-01',
      '2026-12-31',
    )
    expect([...keys]).toEqual(['2026-01-07'])
  })

  it('نطاق فارغ يعطي مجموعة فارغة', () => {
    expect(expandHolidayRows([], '2026-01-01', '2026-12-31').size).toBe(0)
  })
})

describe('expandLeaveRows', () => {
  const leave = (start: string, end: string) => ({
    startDate: dateColumnValue(start),
    endDate: dateColumnValue(end),
  })

  it('يفرد النطاق شاملًا الطرفين', () => {
    const keys = expandLeaveRows(
      [leave('2026-03-02', '2026-03-04')],
      '2026-01-01',
      '2026-12-31',
    )
    expect([...keys].sort()).toEqual(['2026-03-02', '2026-03-03', '2026-03-04'])
  })

  it('إجازة يوم واحد تعطي مفتاحًا واحدًا', () => {
    const keys = expandLeaveRows(
      [leave('2026-03-02', '2026-03-02')],
      '2026-01-01',
      '2026-12-31',
    )
    expect([...keys]).toEqual(['2026-03-02'])
  })

  it('يقصّ على النافذة المطلوبة بدل إفراد سنة كاملة', () => {
    const keys = expandLeaveRows(
      [leave('2026-01-01', '2026-12-31')],
      '2026-03-02',
      '2026-03-04',
    )
    expect([...keys].sort()).toEqual(['2026-03-02', '2026-03-03', '2026-03-04'])
  })

  it('إجازة خارج النافذة كليًا لا تعطي شيئًا', () => {
    // The query would not return such a row, but the expander is a pure
    // function and must not produce an inverted range if one reaches it.
    const keys = expandLeaveRows(
      [leave('2026-01-01', '2026-01-05')],
      '2026-03-02',
      '2026-03-04',
    )
    expect(keys.size).toBe(0)
  })

  it('يعبر نهاية الشهر وفبراير الكبيس', () => {
    const keys = expandLeaveRows(
      [leave('2028-02-27', '2028-03-01')],
      '2028-01-01',
      '2028-12-31',
    )
    expect([...keys].sort()).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ])
  })
})
