/**
 * Egyptian public holidays used by the calendar and penalty suites.
 *
 * Dates are Cairo calendar dates written as UTC midnight — the calendar layer
 * is what converts, and the fixture must not pre-empt that conversion.
 *
 * Islamic dates are approximate and that is fine: these exist to exercise
 * "a holiday falls here", not to be an authoritative almanac.
 */

export interface HolidayFixture {
  date: string
  nameAr: string
}

export const HOLIDAYS_2026: readonly HolidayFixture[] = [
  { date: '2026-01-07', nameAr: 'عيد الميلاد المجيد' },
  { date: '2026-01-25', nameAr: 'عيد الثورة وعيد الشرطة' },
  { date: '2026-03-20', nameAr: 'عيد الفطر' },
  { date: '2026-03-21', nameAr: 'عيد الفطر' },
  { date: '2026-03-22', nameAr: 'عيد الفطر' },
  { date: '2026-04-13', nameAr: 'شم النسيم' },
  { date: '2026-04-25', nameAr: 'عيد تحرير سيناء' },
  { date: '2026-05-01', nameAr: 'عيد العمال' },
  { date: '2026-05-27', nameAr: 'عيد الأضحى' },
  { date: '2026-05-28', nameAr: 'عيد الأضحى' },
  { date: '2026-06-17', nameAr: 'رأس السنة الهجرية' },
  { date: '2026-06-30', nameAr: 'عيد ثورة 30 يونيو' },
  { date: '2026-07-23', nameAr: 'عيد ثورة 23 يوليو' },
  { date: '2026-08-26', nameAr: 'المولد النبوي' },
  { date: '2026-10-06', nameAr: 'عيد القوات المسلحة' },
] as const

export const holidayDates = (): Date[] =>
  HOLIDAYS_2026.map((h) => new Date(`${h.date}T00:00:00.000Z`))
