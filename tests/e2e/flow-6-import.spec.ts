import { expect, test, type Page } from '@playwright/test'

import { ar } from '../../src/i18n/ar'
import { buildImportFixture } from '../helpers/import-fixture'

import { E2E_ADMIN } from './global-setup'

/**
 * docs/TESTING.md §6, flow #6:
 *
 *   "Download the users .xlsx template → upload a file with 2 valid and 1
 *    invalid row → dry-run preview shows exactly that → confirm → only valid
 *    rows persist."
 *
 * The last clause is the one with teeth — this does not stop at the result
 * panel's counters, it goes to /users afterwards and checks who is actually
 * there (and who is not).
 *
 * Run serially against one browser context; each step depends on the last.
 */

test.describe.configure({ mode: 'serial' })

const VALID_ONE = {
  username: 'e2e.import.one',
  fullName: 'مستورد الأول',
  password: 'ImportPass1',
}
const VALID_TWO = {
  username: 'e2e.import.two',
  fullName: 'مستورد الثاني',
  password: 'ImportPass2',
}
// Invalid on purpose: fullName is left blank, which planUsers() rejects
// before it ever reaches the Zod schema — one unambiguous error, on one
// field, for a row that otherwise looks importable.
const INVALID_ROW = {
  username: 'e2e.import.invalid',
  password: 'ImportPass3',
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel(ar.auth.username).fill(E2E_ADMIN.username)
  await page.getByLabel(ar.auth.password).fill(E2E_ADMIN.password)
  await page.getByRole('button', { name: ar.auth.signIn }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('تدفّق ٦: استيراد ملف مستخدمين فيه صفوف صالحة وصف غير صالح', async ({ page }) => {
  await signIn(page)

  // ── Download the template ───────────────────────────────────────────────
  await page.goto('/import')
  await expect(
    page.getByRole('heading', { name: ar.import.title, exact: true }),
  ).toBeVisible()

  // `Button asChild` renders the real `<a href>`, so its accessible role is
  // "link", not "button" — the download itself proves the template route
  // (`/api/import/template/users`) actually served an attachment.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: ar.import.actions.downloadTemplate }).click(),
  ])
  expect(download.suggestedFilename()).toBeTruthy()

  // ── Build and upload a 3-row file: 2 valid, 1 invalid ───────────────────
  const buffer = await buildImportFixture('users', [
    {
      username: VALID_ONE.username,
      fullName: VALID_ONE.fullName,
      password: VALID_ONE.password,
      isWorker: ar.common.no,
    },
    {
      username: VALID_TWO.username,
      fullName: VALID_TWO.fullName,
      password: VALID_TWO.password,
      isWorker: ar.common.no,
    },
    {
      // fullName intentionally omitted → blank cell → invalid row.
      username: INVALID_ROW.username,
      password: INVALID_ROW.password,
      isWorker: ar.common.no,
    },
  ])

  await page.getByLabel(ar.import.fileLabel).setInputFiles({
    name: 'import.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  })

  // ── Dry run ──────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: ar.import.actions.runDryRun }).click()

  const previewCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: ar.import.preview.title }) })
  await expect(previewCard).toBeVisible()

  async function statValue(label: string): Promise<string | null> {
    return previewCard
      .getByText(label, { exact: true })
      .locator('xpath=following-sibling::span[1]')
      .textContent()
  }

  await expect.poll(() => statValue(ar.import.preview.totalRows)).toBe('3')
  await expect.poll(() => statValue(ar.import.preview.toCreate)).toBe('2')
  await expect.poll(() => statValue(ar.import.preview.toUpdate)).toBe('0')
  await expect.poll(() => statValue(ar.import.preview.invalidCount)).toBe('1')

  // The table itself: exactly 3 data rows, with the right badge on each.
  const previewTable = previewCard.getByRole('table')
  await expect(previewTable.getByRole('row')).toHaveCount(4) // header + 3 rows

  const rowOne = previewTable.getByRole('row', { name: new RegExp(VALID_ONE.username) })
  await expect(
    rowOne.getByText(ar.import.rowStatus.create, { exact: true }),
  ).toBeVisible()

  const rowTwo = previewTable.getByRole('row', { name: new RegExp(VALID_TWO.username) })
  await expect(
    rowTwo.getByText(ar.import.rowStatus.create, { exact: true }),
  ).toBeVisible()

  const invalidRow = previewTable.getByRole('row', {
    name: new RegExp(INVALID_ROW.username),
  })
  await expect(
    invalidRow.getByText(ar.import.rowStatus.invalid, { exact: true }),
  ).toBeVisible()
  await expect(
    invalidRow.getByText(
      `${ar.import.columns.users.fullName.header}: ${ar.validation.required}`,
    ),
  ).toBeVisible()

  // ── Confirm ──────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: ar.import.actions.confirmImport }).click()

  const resultCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: ar.import.result.title }) })
  await expect(resultCard).toBeVisible()

  async function resultStat(label: string): Promise<string | null> {
    return resultCard
      .getByText(label, { exact: true })
      .locator('xpath=following-sibling::span[1]')
      .textContent()
  }

  await expect.poll(() => resultStat(ar.import.result.created)).toBe('2')
  await expect.poll(() => resultStat(ar.import.result.updated)).toBe('0')
  await expect.poll(() => resultStat(ar.import.result.skipped)).toBe('1')

  // ── The step with teeth: only the valid rows actually persisted ────────
  await page.goto('/users')
  await expect(page.getByRole('cell', { name: VALID_ONE.fullName })).toBeVisible()
  await expect(page.getByRole('cell', { name: VALID_TWO.fullName })).toBeVisible()
  await expect(page.getByRole('cell', { name: VALID_ONE.username })).toBeVisible()
  await expect(page.getByRole('cell', { name: VALID_TWO.username })).toBeVisible()

  // The invalid row's username never made it into the database.
  await expect(page.getByRole('cell', { name: INVALID_ROW.username })).toHaveCount(0)
})
