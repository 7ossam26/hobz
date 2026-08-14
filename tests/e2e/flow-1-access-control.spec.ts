import { expect, test, type Page } from '@playwright/test'

import { ar } from '../../src/i18n/ar'

import { E2E_ADMIN } from './global-setup'

/**
 * docs/TESTING.md §6, flow #1:
 *
 *   "Super admin logs in → creates a role → creates a user → user logs in and
 *    sees exactly the permitted navigation."
 *
 * The last clause is the one with teeth. It is not "sees the users page" but
 * *exactly* the permitted navigation — so the assertions check both what is
 * present and what is absent, which is the only way a leak shows up.
 *
 * Run serially against one browser context; each step depends on the last.
 */

test.describe.configure({ mode: 'serial' })

const ROLE = { nameAr: 'مسؤول المستخدمين', nameEn: 'USER_ADMIN' }
const MEMBER = {
  username: 'e2e.member',
  password: 'member-initial-password',
  newPassword: 'member-chosen-password',
  fullName: 'عضو التجربة',
  phone: '01012345678',
  // Required: the default pay type is PER_TASK, and a per-task worker with no
  // rate would have nothing to earn on approval in Phase 7.
  taskRate: '500.00',
}

/**
 * The app's own error banners, which are `<p role="alert">`.
 *
 * A bare `getByRole('alert')` also matches Next's `__next-route-announcer__`
 * div, which is always in the DOM and always empty — so it fails strict mode
 * on every assertion rather than on a real problem.
 */
const pageAlert = (page: Page) => page.locator('p[role="alert"]')

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel(ar.auth.username).fill(username)
  await page.getByLabel(ar.auth.password).fill(password)
  await page.getByRole('button', { name: ar.auth.signIn }).click()
}

test('تدفّق ١: إنشاء دور ومستخدم ثم رؤية التنقّل المسموح فقط', async ({ page }) => {
  // ── The app is closed to anonymous visitors ──────────────────────────────
  await page.goto('/users')
  await expect(page).toHaveURL(/\/login/)

  // ── Super admin signs in ────────────────────────────────────────────────
  await signIn(page, E2E_ADMIN.username, E2E_ADMIN.password)
  await expect(page).toHaveURL(/\/dashboard/)

  // Every navigation item, because SUPER_ADMIN holds every permission
  // implicitly and has no stored RolePermission rows at all (SPEC §2).
  const nav = page.getByRole('navigation')
  for (const label of [
    ar.nav.dashboard,
    ar.nav.users,
    ar.nav.roles,
    ar.nav.settings,
    ar.nav.auditLog,
  ]) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible()
  }

  // ── Create a role with exactly one permission ───────────────────────────
  await page.goto('/roles')
  await page.getByRole('button', { name: ar.roles.create }).click()

  const roleSheet = page.getByRole('dialog')
  await roleSheet.getByLabel(ar.roles.nameAr).fill(ROLE.nameAr)
  await roleSheet.getByLabel(ar.roles.nameEn).fill(ROLE.nameEn)
  // `user.view` only. That single choice is what the final assertion turns on.
  await roleSheet.getByRole('checkbox', { name: ar.permissions['user.view'] }).check()
  await roleSheet.getByRole('button', { name: ar.common.save }).click()

  await expect(roleSheet).toBeHidden()
  await expect(page.getByRole('cell', { name: ROLE.nameAr })).toBeVisible()

  // The reserved role is visible but locked — no edit, no delete.
  const superAdminRow = page.getByRole('row', { name: new RegExp(ar.roles.superAdmin) })
  await expect(superAdminRow.getByRole('button', { name: ar.common.edit })).toBeDisabled()
  await expect(
    superAdminRow.getByRole('button', { name: ar.common.delete }),
  ).toBeDisabled()

  // ── Create a user holding that role ─────────────────────────────────────
  await page.goto('/users')
  await page.getByRole('button', { name: ar.users.create }).click()

  const userSheet = page.getByRole('dialog')
  await userSheet.getByLabel(ar.users.fullName).fill(MEMBER.fullName)
  await userSheet.getByLabel(ar.auth.username).fill(MEMBER.username)
  await userSheet.getByLabel(ar.auth.password).fill(MEMBER.password)
  await userSheet.getByLabel(ar.users.phone).fill(MEMBER.phone)
  await userSheet.getByRole('checkbox', { name: ROLE.nameAr }).check()

  // Saving without the rate must fail *on the field*, not with a generic
  // error — the shared Zod schema runs in the form as well as the action.
  await userSheet.getByRole('button', { name: ar.common.save }).click()
  await expect(pageAlert(page)).toHaveText(
    ar.validation.rateRequiredForPayType,
  )
  await expect(userSheet).toBeVisible()

  await userSheet.getByLabel(ar.users.defaultTaskRate).fill(MEMBER.taskRate)
  await userSheet.getByRole('button', { name: ar.common.save }).click()

  await expect(userSheet).toBeHidden()
  await expect(page.getByRole('cell', { name: MEMBER.fullName })).toBeVisible()

  // The phone was normalised to E.164 on write and renders grouped, LTR.
  await expect(page.getByText('+20 10 1234 5678')).toBeVisible()

  // ── The new user signs in ───────────────────────────────────────────────
  await page.getByRole('button', { name: ar.auth.signOut }).click()
  await expect(page).toHaveURL(/\/login/)

  await signIn(page, MEMBER.username, MEMBER.password)

  // An admin-created password must be replaced before anything else. Until it
  // is, the admin holds a working credential for someone else's account.
  await expect(page).toHaveURL(/\/change-password/)
  await expect(page.getByText(ar.auth.mustChangePasswordHint)).toBeVisible()

  await page.getByLabel(ar.auth.currentPassword).fill(MEMBER.password)
  // By id, not by label: "كلمة المرور الجديدة" is a substring of
  // "تأكيد كلمة المرور الجديدة", and `exact` does not disambiguate them either
  // because `FormField` appends a required marker to the label's text content.
  // `field-<name>` is the id that wrapper generates, and it is stable.
  await page.locator('#field-newPassword').fill(MEMBER.newPassword)
  await page.locator('#field-confirmPassword').fill(MEMBER.newPassword)
  await page.getByRole('button', { name: ar.auth.changePassword }).click()

  await expect(page).toHaveURL(/\/dashboard/)

  // ── …and sees EXACTLY the permitted navigation ──────────────────────────
  const memberNav = page.getByRole('navigation')
  await expect(memberNav.getByRole('link', { name: ar.nav.dashboard })).toBeVisible()
  await expect(memberNav.getByRole('link', { name: ar.nav.users })).toBeVisible()

  // The absences are the assertion. `user.view` grants the users page and
  // nothing else.
  await expect(memberNav.getByRole('link', { name: ar.nav.roles })).toHaveCount(0)
  await expect(memberNav.getByRole('link', { name: ar.nav.settings })).toHaveCount(0)
  await expect(memberNav.getByRole('link', { name: ar.nav.auditLog })).toHaveCount(0)

  // ── Hiding the link is cosmetic; the URL is guarded too ─────────────────
  // CLAUDE.md invariant 3. Typing the address must not work either.
  await page.goto('/audit')
  await expect(page).not.toHaveURL(/\/audit$/)

  await page.goto('/roles')
  await expect(page).not.toHaveURL(/\/roles$/)

  // The page they DO hold permission for still works.
  await page.goto('/users')
  await expect(page).toHaveURL(/\/users/)
  await expect(page.getByRole('cell', { name: MEMBER.fullName })).toBeVisible()

  // …but only to read: `user.create` was never granted.
  await expect(page.getByRole('button', { name: ar.users.create })).toHaveCount(0)
})

test('يرفض بيانات دخول خاطئة برسالة عربية واحدة', async ({ page }) => {
  await signIn(page, E2E_ADMIN.username, 'definitely-the-wrong-password')

  await expect(pageAlert(page)).toHaveText(ar.auth.invalidCredentials)
  await expect(page).toHaveURL(/\/login/)
})

test('يعطي نفس الرسالة لمستخدم غير موجود', async ({ page }) => {
  // No username oracle: "no such user" and "wrong password" read identically.
  await signIn(page, 'no.such.person', 'whatever-password-here')
  await expect(pageAlert(page)).toHaveText(ar.auth.invalidCredentials)
})
