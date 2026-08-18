import { expect, type Page } from '@playwright/test'

import { ar } from '../../src/i18n/ar'

import { E2E_ADMIN } from './global-setup'

/**
 * The steps every flow in docs/TESTING.md §6 repeats — sign in, make a role,
 * make a user, make a project, make a task.
 *
 * All of them drive the **real UI**. Nothing here reaches into Prisma to
 * shortcut a fixture: a flow that seeds its own preconditions through the
 * database is only testing the half of the journey it did not skip, and the
 * halves it skips are the ones a user actually performs.
 *
 * The one exception, and it is named where it happens: flows #3 and #4 invoke
 * the nightly penalty job directly, because "the daily job runs" is the step
 * and there is no button for a cron tick.
 */

/**
 * The app's own error banners are `<p role="alert">`.
 *
 * A bare `getByRole('alert')` also matches Next's always-present, always-empty
 * `__next-route-announcer__`, so it fails strict mode on every assertion rather
 * than on a real problem.
 */
export const pageAlert = (page: Page) => page.locator('p[role="alert"]')

export async function signIn(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(ar.auth.username).fill(username)
  await page.getByLabel(ar.auth.password).fill(password)
  await page.getByRole('button', { name: ar.auth.signIn }).click()
}

export async function signInAsAdmin(page: Page): Promise<void> {
  await signIn(page, E2E_ADMIN.username, E2E_ADMIN.password)
  await expect(page).toHaveURL(/\/dashboard/)
}

/**
 * Sign out through the user menu, which is where it actually lives.
 *
 * Two things this has to do that a single click does not:
 *
 *  - **Navigate first.** A modal sheet makes the page behind it inert, so the
 *    header is unreachable while a task or project sheet is open.
 *  - **Open the menu.** Sign-out is a `role="menuitem"` inside the user
 *    popover (`components/layout/user-menu.tsx`), not a bare button in the
 *    header — `getByRole('button')` does not match an explicit `menuitem`.
 */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: ar.shell.userMenu }).click()
  await page.getByRole('menuitem', { name: ar.auth.signOut }).click()
  await expect(page).toHaveURL(/\/login/)
}

/**
 * Sign in as a user whose password was set by an admin, and clear the forced
 * change on the way through — otherwise every subsequent navigation bounces
 * back to `/change-password` (`src/middleware.ts`).
 */
export async function signInFirstTime(
  page: Page,
  username: string,
  initialPassword: string,
  chosenPassword: string,
): Promise<void> {
  await signIn(page, username, initialPassword)
  await expect(page).toHaveURL(/\/change-password/)

  await page.getByLabel(ar.auth.currentPassword).fill(initialPassword)
  // By id, not label: "كلمة المرور الجديدة" is a substring of
  // "تأكيد كلمة المرور الجديدة", and `FormField` appends a required marker so
  // `exact` does not separate them either.
  await page.locator('#field-newPassword').fill(chosenPassword)
  await page.locator('#field-confirmPassword').fill(chosenPassword)
  await page.getByRole('button', { name: ar.auth.changePassword }).click()

  await expect(page).toHaveURL(/\/dashboard/)
}

export interface RoleSpec {
  nameAr: string
  nameEn: string
  permissions: readonly string[]
}

/** Creates a role through `/roles`. The caller must already be an admin. */
export async function createRole(page: Page, role: RoleSpec): Promise<void> {
  await page.goto('/roles')
  await page.getByRole('button', { name: ar.roles.create }).click()

  // Named, not bare: `getByRole('dialog')` also matches whatever sheet the
  // previous step left open, and every dialog in this product is labelled by
  // its own title (`aria-labelledby`, `components/shared/dialog.tsx`).
  const sheet = page.getByRole('dialog', { name: ar.roles.create })
  await sheet.getByLabel(ar.roles.nameAr).fill(role.nameAr)
  await sheet.getByLabel(ar.roles.nameEn).fill(role.nameEn)

  for (const key of role.permissions) {
    const label = (ar.permissions as Record<string, string>)[key]
    if (!label) throw new Error(`No Arabic label for permission "${key}"`)
    await sheet.getByRole('checkbox', { name: label }).check()
  }

  await sheet.getByRole('button', { name: ar.common.save }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('cell', { name: role.nameAr })).toBeVisible()
}

export interface WorkerSpec {
  username: string
  password: string
  fullName: string
  phone: string
  /** Per-task rate. It is what an approved task turns into an EARNING of. */
  taskRate: string
  roleNameAr: string
}

/** Creates a منفّذ through `/users`. The caller must already be an admin. */
export async function createWorker(page: Page, worker: WorkerSpec): Promise<void> {
  await page.goto('/users')
  await page.getByRole('button', { name: ar.users.create }).click()

  const sheet = page.getByRole('dialog', { name: ar.users.create })
  await sheet.getByLabel(ar.users.fullName).fill(worker.fullName)
  await sheet.getByLabel(ar.auth.username).fill(worker.username)
  await sheet.getByLabel(ar.auth.password).fill(worker.password)
  await sheet.getByLabel(ar.users.phone).fill(worker.phone)
  await sheet.getByLabel(ar.users.defaultTaskRate).fill(worker.taskRate)
  await sheet.getByRole('checkbox', { name: worker.roleNameAr }).check()

  await sheet.getByRole('button', { name: ar.common.save }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('cell', { name: worker.fullName })).toBeVisible()
}

/** `YYYY-MM-DD`, the value a `<input type="date">` holds. */
export function dateInput(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

export interface ProjectSpec {
  name: string
  /** Days from today. Negative for a project already under way. */
  startOffsetDays: number
  dueOffsetDays: number
}

/**
 * Creates a project through `/projects` and returns its id, read from the URL
 * the create sheet redirects to.
 */
export async function createProject(page: Page, project: ProjectSpec): Promise<string> {
  await page.goto('/projects')
  await page.getByRole('button', { name: ar.projects.create, exact: true }).click()

  const sheet = page.getByRole('dialog', { name: ar.projects.create })
  await sheet.getByLabel(ar.projects.name).fill(project.name)
  await sheet
    .getByLabel(ar.projects.engagementType)
    .selectOption({ label: ar.enums.engagementType.FIXED_PRICE })
  await sheet
    .getByLabel(ar.projects.status)
    .selectOption({ label: ar.enums.projectStatus.ACTIVE })
  await sheet.getByLabel(ar.projects.startDate).fill(dateInput(project.startOffsetDays))
  await sheet.getByLabel(ar.projects.dueDate).fill(dateInput(project.dueOffsetDays))

  await sheet.getByRole('button', { name: ar.common.save }).click()

  await page.waitForURL(/\/projects\/[^/]+$/)
  const id = new URL(page.url()).pathname.split('/').pop()
  if (!id) throw new Error('Project was created but its id could not be read')
  return id
}

export interface TaskSpec {
  projectName: string
  title: string
  assigneeFullName: string
  /** Days from today. Negative makes the task already overdue. */
  dueOffsetDays: number
}

/** Creates a task through the `/tasks` quick-create dialog. */
export async function createTask(page: Page, task: TaskSpec): Promise<void> {
  await page.goto('/tasks')
  await page.getByRole('button', { name: ar.tasks.create, exact: true }).click()

  const dialog = page.getByRole('dialog', { name: ar.tasks.quickCreate.title })

  // The option's label is `CODE — Name` and the code is generated
  // (`modules/project/code.ts`), so the option is found by its *name* and then
  // selected by the value that option carries. `selectOption({ label })` takes
  // only an exact string, which would pin this helper to a generated id.
  const projectSelect = dialog.getByLabel(ar.tasks.project)
  const optionValue = await projectSelect
    .locator('option', { hasText: task.projectName })
    .first()
    .getAttribute('value')
  if (!optionValue) throw new Error(`No project option matching "${task.projectName}"`)
  await projectSelect.selectOption(optionValue)

  await dialog.getByLabel(ar.tasks.taskTitle).fill(task.title)
  await dialog
    .getByLabel(ar.tasks.assignee)
    .selectOption({ label: task.assigneeFullName })
  await dialog.getByLabel(ar.tasks.dueDate).fill(dateInput(task.dueOffsetDays))

  await dialog.getByRole('button', { name: ar.tasks.quickCreate.submit }).click()
  await expect(dialog).toBeHidden()

  // Creating a task opens its detail sheet (`tasks-client.tsx`'s `onCreated`).
  // Close it, so a caller that wants the sheet opens it deliberately rather
  // than inheriting one and asserting against whatever it happens to show.
  //
  // The close *button*, not Escape: the sheet fetches on open and blocks both
  // Escape and the button while it is busy (`useModalBehaviour`'s
  // `closeDisabled`). Playwright waits for the button to become enabled;
  // a keypress sent during the fetch is simply swallowed.
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: ar.common.close }).click()
  await expect(sheet).toBeHidden()
}

/** Opens a task's detail sheet from the list view, by title. */
export async function openTask(page: Page, title: string): Promise<void> {
  await page.goto('/tasks?view=list')
  await page.getByRole('cell', { name: title }).first().click()
  await expect(page.getByRole('dialog').getByText(title).first()).toBeVisible()
}

/**
 * Drives one status transition from the detail sheet's status control.
 *
 * The trigger is located by `aria-haspopup="menu"` rather than by name: its
 * accessible name is the *current* status chip, so naming it would make every
 * call depend on the state the previous line put the task in. The menu only
 * offers transitions the actor holds the permission for (`TaskStatusControl`),
 * so a missing entry is a permission problem, not a locator problem.
 */
export async function transitionTask(page: Page, actionLabel: string): Promise<void> {
  const sheet = page.getByRole('dialog')
  await sheet.locator('button[aria-haspopup="menu"]').first().click()

  // `click` auto-waits for the menu to render; `count()` does not, and a bare
  // count check here raced the popover's first paint. The catch turns the
  // timeout into a message that names what the menu *did* offer — a missing
  // entry means the actor lacks the permission or the edge is illegal from the
  // current status, and both are worth reading at a glance.
  const item = page.getByRole('menuitem', { name: actionLabel, exact: true })
  try {
    await item.click({ timeout: 5_000 })
  } catch {
    const offered = await page.getByRole('menuitem').allTextContents()
    throw new Error(
      `Could not click menu item "${actionLabel}". The menu offered: ${offered.join(' | ') || '(nothing)'}`,
    )
  }
}

/** Opens one of the detail sheet's tabs by its Arabic label. */
export async function openTaskTab(page: Page, label: string): Promise<void> {
  await page.getByRole('dialog').getByRole('tab', { name: label }).click()
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
