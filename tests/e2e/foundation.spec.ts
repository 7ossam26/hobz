import { expect, test } from '@playwright/test'

import { ar } from '../../src/i18n/ar'

import { E2E_ADMIN } from './global-setup'

/**
 * The RTL and typography proof, so that a regression in direction or font is
 * caught by the suite rather than by someone squinting at a screenshot.
 *
 * Phase 0 asserted all of this against a scaffold page at `/`. That page no
 * longer exists — `/` now routes to `/login` or `/dashboard` depending on the
 * session — so every assertion has been retargeted at a page that is part of
 * the product and will still be here in a year: the login screen for the
 * anonymous checks, and the real app shell for the logical-property check,
 * whose sidebar is the thing that actually has to land on the right.
 */

test.describe('الأساس: الاتجاه والخط', () => {
  test('يعرض الصفحة من اليمين إلى اليسار بالعربية', async ({ page }) => {
    await page.goto('/login')

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

    await page.goto('/login')
    await page.evaluate(() => document.fonts.ready)

    const fontFamily = await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(fontFamily).toContain('IBM Plex Sans Arabic')

    // SPEC §2 / CLAUDE.md invariant 9: no external APIs, no CDN.
    expect(externalRequests).toEqual([])
  })

  test('يستجيب فحص الصحة', async ({ request }) => {
    const response = await request.get('/api/health')
    expect([200, 503]).toContain(response.status())
  })
})

test.describe('الأساس: الخصائص المنطقية داخل التطبيق', () => {
  test('يضع الشريط الجانبي على اليمين باستخدام الخصائص المنطقية', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(ar.auth.username).fill(E2E_ADMIN.username)
    await page.getByLabel(ar.auth.password).fill(E2E_ADMIN.password)
    await page.getByRole('button', { name: ar.auth.signIn }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible()

    // `border-s` must resolve to the LEFT edge of a right-hand sidebar under
    // RTL — the border sits between the sidebar and the content beside it. If
    // someone swaps a logical property for a physical one, this flips.
    const borderLeft = await sidebar.evaluate(
      (el) => getComputedStyle(el).borderLeftWidth,
    )
    const borderRight = await sidebar.evaluate(
      (el) => getComputedStyle(el).borderRightWidth,
    )
    expect(borderLeft).not.toBe('0px')
    expect(borderRight).toBe('0px')

    // And the sidebar is physically on the right half of the viewport.
    const box = await sidebar.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(box!.x).toBeGreaterThan(viewport!.width / 2)
  })
})
