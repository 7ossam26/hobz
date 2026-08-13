import { afterEach, describe, expect, it, vi } from 'vitest'

// Type-only: erased at build time, so it does NOT trigger the guard's
// import-time side effect. Every runtime load below goes through `loadGuard`.
import type * as DbGuard from '../../setup/db-guard'

/**
 * CLAUDE.md invariant 10. This guard is the only thing standing between a
 * mistyped `DATABASE_URL` and a truncated production database, so it gets tests
 * of its own — including the import-time side effect.
 *
 * Everything is loaded dynamically: `tests/setup/db-guard.ts` runs its check on
 * import (that is what makes it usable as a Vitest `setupFile`), so a static
 * import here would abort this file before a single test ran.
 */

const TEST_URL = 'postgresql://agency:pw@localhost:5432/agency_test'
const DEV_URL = 'postgresql://agency:pw@localhost:5432/agency'

type Guard = typeof DbGuard

/** Load the guard fresh, under a given environment. */
async function loadGuard(env: {
  DATABASE_URL?: string
  TEST_DATABASE_URL?: string
  NODE_ENV?: string
}): Promise<Guard> {
  vi.resetModules()
  vi.stubEnv('DATABASE_URL', env.DATABASE_URL ?? '')
  vi.stubEnv('TEST_DATABASE_URL', env.TEST_DATABASE_URL ?? '')
  vi.stubEnv('NODE_ENV', env.NODE_ENV ?? 'test')
  return import('../../setup/db-guard')
}

/** Load it in a known-safe environment, to exercise the pure functions. */
const loadSafely = (): Promise<Guard> =>
  loadGuard({ DATABASE_URL: TEST_URL, NODE_ENV: 'test' })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('tests/setup/db-guard — استخراج اسم قاعدة البيانات', () => {
  it('يستخرج الاسم من رابط قياسي', async () => {
    const { databaseNameFromUrl } = await loadSafely()
    expect(databaseNameFromUrl(TEST_URL)).toBe('agency_test')
  })

  it('يتجاهل معاملات الاستعلام', async () => {
    const { databaseNameFromUrl } = await loadSafely()
    expect(databaseNameFromUrl(`${TEST_URL}?schema=public&connection_limit=1`)).toBe(
      'agency_test',
    )
  })

  it('يفكّ ترميز الاسم', async () => {
    const { databaseNameFromUrl } = await loadSafely()
    expect(databaseNameFromUrl('postgresql://h/my%20db_test')).toBe('my db_test')
  })

  it('يرفض رابطًا غير صالح أو بلا اسم قاعدة بيانات', async () => {
    const { databaseNameFromUrl, UnsafeTestDatabaseError } = await loadSafely()
    expect(() => databaseNameFromUrl('not-a-url')).toThrow(UnsafeTestDatabaseError)
    expect(() => databaseNameFromUrl('postgresql://localhost:5432')).toThrow(
      UnsafeTestDatabaseError,
    )
    expect(() => databaseNameFromUrl('postgresql://localhost:5432/')).toThrow(
      UnsafeTestDatabaseError,
    )
  })
})

describe('tests/setup/db-guard — الحارس', () => {
  it('يقبل قاعدة بيانات تنتهي بـ _test', async () => {
    const { assertTestDatabase } = await loadSafely()
    expect(assertTestDatabase({ DATABASE_URL: TEST_URL, NODE_ENV: 'test' })).toBe(
      'agency_test',
    )
  })

  it('يرفض قاعدة بيانات التطوير', async () => {
    const { assertTestDatabase } = await loadSafely()
    expect(() => assertTestDatabase({ DATABASE_URL: DEV_URL, NODE_ENV: 'test' })).toThrow(
      /must end in _test/,
    )
  })

  it('يرفض اسمًا يحتوي _test في وسطه فقط', async () => {
    // `agency_test_backup` is not a test database; only the suffix counts.
    const { assertTestDatabase } = await loadSafely()
    expect(() =>
      assertTestDatabase({
        DATABASE_URL: 'postgresql://h/agency_test_backup',
        NODE_ENV: 'test',
      }),
    ).toThrow(/must end in _test/)
  })

  it('يرفض التشغيل في بيئة الإنتاج مهما كان اسم قاعدة البيانات', async () => {
    const { assertTestDatabase } = await loadSafely()
    expect(() =>
      assertTestDatabase({ DATABASE_URL: TEST_URL, NODE_ENV: 'production' }),
    ).toThrow(/NODE_ENV is "production"/)
  })

  it('يرفض غياب DATABASE_URL', async () => {
    const { assertTestDatabase } = await loadSafely()
    expect(() => assertTestDatabase({ NODE_ENV: 'test' })).toThrow(
      /DATABASE_URL is not set/,
    )
    expect(() => assertTestDatabase({ DATABASE_URL: '', NODE_ENV: 'test' })).toThrow(
      /DATABASE_URL is not set/,
    )
  })

  it('يسبق كل رسالة بتحذير الرفض', async () => {
    const { assertTestDatabase } = await loadSafely()
    try {
      assertTestDatabase({ DATABASE_URL: DEV_URL, NODE_ENV: 'test' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).toMatch(/^REFUSING TO RUN:/)
    }
  })
})

describe('tests/setup/db-guard — توجيه الاختبارات إلى قاعدة بيانات الاختبار', () => {
  it('يرقّي TEST_DATABASE_URL إلى DATABASE_URL', async () => {
    // Prisma only reads DATABASE_URL. Without this, `pnpm test:integration`
    // would migrate and truncate the developer's dev database.
    const { promoteTestDatabaseUrl } = await loadSafely()
    const env: Record<string, string | undefined> = {
      DATABASE_URL: DEV_URL,
      TEST_DATABASE_URL: TEST_URL,
    }

    promoteTestDatabaseUrl(env)

    expect(env.DATABASE_URL).toBe(TEST_URL)
  })

  it('يترك DATABASE_URL كما هو عندما لا يوجد TEST_DATABASE_URL', async () => {
    const { promoteTestDatabaseUrl } = await loadSafely()
    const env: Record<string, string | undefined> = { DATABASE_URL: TEST_URL }

    promoteTestDatabaseUrl(env)

    expect(env.DATABASE_URL).toBe(TEST_URL)
  })

  it('يظل يرفض TEST_DATABASE_URL الذي لا ينتهي بـ _test', async () => {
    // A mistyped TEST_DATABASE_URL must not slip past the suffix check just
    // because it arrived through the promotion path.
    await expect(
      loadGuard({ DATABASE_URL: TEST_URL, TEST_DATABASE_URL: DEV_URL }),
    ).rejects.toThrow(/must end in _test/)
  })

  it('يقبل التشغيل عندما يشير TEST_DATABASE_URL وحده إلى قاعدة اختبار', async () => {
    const guard = await loadGuard({
      DATABASE_URL: DEV_URL,
      TEST_DATABASE_URL: TEST_URL,
    })
    expect(guard.assertTestDatabase()).toBe('agency_test')
  })
})

describe('tests/setup/db-guard — التنفيذ عند الاستيراد', () => {
  it('ينهار فور استيراده مع قاعدة بيانات غير آمنة', async () => {
    // The check must fire before any Prisma client is constructed — not when
    // someone remembers to call it.
    await expect(loadGuard({ DATABASE_URL: DEV_URL, NODE_ENV: 'test' })).rejects.toThrow(
      /must end in _test/,
    )
  })

  it('ينهار فور استيراده في بيئة الإنتاج', async () => {
    await expect(
      loadGuard({ DATABASE_URL: TEST_URL, NODE_ENV: 'production' }),
    ).rejects.toThrow(/NODE_ENV is "production"/)
  })

  it('يستورد بنجاح مع قاعدة بيانات آمنة', async () => {
    await expect(loadSafely()).resolves.toHaveProperty('assertTestDatabase')
  })
})
