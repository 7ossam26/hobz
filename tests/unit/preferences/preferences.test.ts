import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  DENSITY_COOKIE,
  PREFERENCE_MAX_AGE_SECONDS,
  SIDEBAR_COOKIE,
  THEME_COOKIE,
  cookieReader,
  htmlPreferenceAttributes,
  parseDensity,
  parseSidebar,
  parseTaskView,
  parseTheme,
  preferenceCookie,
  readPreferences,
} from '@/lib/preferences'

/**
 * Theme, density and sidebar state.
 *
 * These are read on the server while rendering `<html>`, which is what makes
 * the first paint already correct — so the parsing has to be total. A cookie is
 * user-writable: anything at all can arrive here, and none of it may throw
 * during a layout render, because that would take down every route at once.
 */

describe('parsing', () => {
  it('يقبل القيم المعروفة فقط', () => {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseDensity('compact')).toBe('compact')
    expect(parseSidebar('collapsed')).toBe('collapsed')
  })

  it('يعود للافتراضي عند أي قيمة غريبة', () => {
    // A tampered cookie must degrade, never throw.
    for (const value of ['', 'DARK', 'purple', '{}', '../../etc/passwd']) {
      expect(parseTheme(value)).toBe(DEFAULT_PREFERENCES.theme)
      expect(parseDensity(value)).toBe(DEFAULT_PREFERENCES.density)
      expect(parseSidebar(value)).toBe(DEFAULT_PREFERENCES.sidebar)
    }
  })

  it('يعود للافتراضي عند الغياب', () => {
    expect(parseTheme(null)).toBe('light')
    expect(parseTheme(undefined)).toBe('light')
  })

  it('الافتراضي فاتح ومريح والقائمة موسّعة', () => {
    // SPEC §9: "Light default, full dark mode". The sidebar starts expanded
    // because a first-time user cannot learn the icons before seeing the labels.
    expect(DEFAULT_PREFERENCES).toEqual({
      theme: 'light',
      density: 'comfortable',
      sidebar: 'expanded',
    })
  })
})

describe('readPreferences', () => {
  it('يقرأ الثلاثة من مصدر الكوكي', () => {
    const jar: Record<string, string> = {
      [THEME_COOKIE]: 'dark',
      [DENSITY_COOKIE]: 'compact',
      [SIDEBAR_COOKIE]: 'collapsed',
    }

    expect(readPreferences((name) => jar[name])).toEqual({
      theme: 'dark',
      density: 'compact',
      sidebar: 'collapsed',
    })
  })

  it('يخلط المضبوط مع الافتراضي', () => {
    expect(
      readPreferences((name) => (name === THEME_COOKIE ? 'dark' : undefined)),
    ).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'dark',
    })
  })
})

describe('cookieReader', () => {
  it('يحلّل سلسلة document.cookie', () => {
    const read = cookieReader(`${THEME_COOKIE}=dark; ${DENSITY_COOKIE}=compact; other=x`)
    expect(read(THEME_COOKIE)).toBe('dark')
    expect(read(DENSITY_COOKIE)).toBe('compact')
    expect(read('missing')).toBeUndefined()
  })

  it('يتعامل مع سلسلة فارغة أو مشوّهة', () => {
    expect(cookieReader('')(THEME_COOKIE)).toBeUndefined()
    expect(cookieReader('garbage;;=;')(THEME_COOKIE)).toBeUndefined()
  })

  it('يفك ترميز القيم', () => {
    expect(cookieReader('x=%D8%AF%D8%A7%D9%83%D9%86')('x')).toBe('داكن')
  })
})

describe('preferenceCookie', () => {
  it('يكتب مسارًا جذريًا وعمرًا سنة و SameSite=Lax', () => {
    const cookie = preferenceCookie(THEME_COOKIE, 'dark')

    expect(cookie).toContain(`${THEME_COOKIE}=dark`)
    expect(cookie).toContain('path=/')
    expect(cookie).toContain(`max-age=${PREFERENCE_MAX_AGE_SECONDS}`)
    expect(cookie).toContain('samesite=lax')
  })

  it('عمر الكوكي سنة كاملة لأن التفضيل ليس جلسة', () => {
    expect(PREFERENCE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 365)
  })

  it('يرمّز القيمة', () => {
    expect(preferenceCookie('x', 'a b')).toContain('x=a%20b')
  })
})

describe('htmlPreferenceAttributes', () => {
  it('يترجم التفضيلات إلى ما يحمله عنصر html', () => {
    // This is the anti-flash mechanism: the class and the attribute are in the
    // first byte of HTML, so there is no script racing the paint.
    expect(htmlPreferenceAttributes({ ...DEFAULT_PREFERENCES, theme: 'dark' })).toEqual({
      className: 'dark',
      'data-density': 'comfortable',
    })

    expect(
      htmlPreferenceAttributes({ ...DEFAULT_PREFERENCES, density: 'compact' }),
    ).toEqual({
      className: '',
      'data-density': 'compact',
    })
  })
})

describe('parseTaskView', () => {
  it('يقبل الأنماط الثلاثة المعروفة', () => {
    for (const view of ['board', 'list', 'calendar'] as const) {
      expect(parseTaskView(view)).toBe(view)
    }
  })

  it('يعود إلى اللوحة عند قيمة مجهولة أو غائبة', () => {
    // A tampered cookie must never take the tasks page down (Phase 5's
    // `agency_task_view`); the board is the default a fresh visit gets.
    expect(parseTaskView('gantt')).toBe('board')
    expect(parseTaskView(null)).toBe('board')
    expect(parseTaskView(undefined)).toBe('board')
    expect(parseTaskView('')).toBe('board')
  })
})
