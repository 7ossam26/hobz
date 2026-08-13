import { expect, test } from '@playwright/test'

/**
 * Phase 0 e2e — the RTL and font proof, and nothing else.
 *
 * The six mandated journeys in docs/TESTING.md §6 arrive with the features they
 * describe. This spec exists so that a regression in direction or typography is
 * caught by the suite rather than by someone squinting at a screenshot.
 */

test.describe('الأساس: الاتجاه والخط', () => {
  test('يعرض الصفحة من اليمين إلى اليسار بالعربية', async ({ page }) => {
    await page.goto('/')

    const html = page.locator('html')
    await expect(html).toHaveAttribute('dir', 'rtl')
    await expect(html).toHaveAttribute('lang', 'ar')
  })

  test('يحمّل خط IBM Plex Sans Arabic محليًا دون أي طلب خارجي', async ({ page }) => {
    const externalRequests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        externalRequests.push(request.url())
      }
    })

    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)

    const fontFamily = await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(fontFamily).toContain('IBM Plex Sans Arabic')

    // SPEC §2 / CLAUDE.md invariant 9: no external APIs, no CDN.
    expect(externalRequests).toEqual([])
  })

  test('يتدفّق المحتوى في الاتجاه الصحيح باستخدام الخصائص المنطقية', async ({ page }) => {
    await page.goto('/')

    const main = page.locator('main')
    await expect(main).toBeVisible()

    // `border-s-2` must resolve to the RIGHT edge under RTL. If someone swaps a
    // logical property for `border-l`, this flips and the test fails.
    const list = main.locator('ul').first()
    const borderRight = await list.evaluate((el) => getComputedStyle(el).borderRightWidth)
    const borderLeft = await list.evaluate((el) => getComputedStyle(el).borderLeftWidth)
    expect(borderRight).not.toBe('0px')
    expect(borderLeft).toBe('0px')
  })

  test('يعرض المبالغ بأرقام غربية', async ({ page }) => {
    await page.goto('/')

    const amounts = page.locator('dd')
    await expect(amounts.first()).toBeVisible()

    const text = (await amounts.first().textContent()) ?? ''
    expect(text).toMatch(/[0-9]/)
    // No Arabic-Indic digits U+0660–U+0669.
    expect(/[٠-٩]/.test(text)).toBe(false)
  })

  test('يستجيب فحص الصحة', async ({ request }) => {
    const response = await request.get('/api/health')
    expect([200, 503]).toContain(response.status())
  })
})
