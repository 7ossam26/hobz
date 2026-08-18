import { expect, test } from '@playwright/test'

import { ar } from '../../src/i18n/ar'

import {
  createProject,
  createRole,
  createTask,
  createWorker,
  openTask,
  signInAsAdmin,
  signInFirstTime,
  signIn,
  signOut,
  transitionTask,
} from './helpers'

/**
 * docs/TESTING.md §6, flow #2:
 *
 *   "Create project → create tasks → assign → worker submits → manager
 *    approves → EARNING appears in the worker's ledger."
 *
 * The last clause is what this flow is for. Everything before it is plumbing
 * that other tests already cover in isolation; the fact worth an end-to-end
 * browser is that SPEC §5.1's promise — **approval is the only event that
 * creates money** — survives the whole chain: a state machine, an event bus, a
 * ledger append, an RBAC-scoped read, and a page the منفّذ opens themselves.
 *
 * It is deliberately driven by two different people. A single super-admin
 * clicking through every step would never exercise `task.view.assigned`,
 * `ledger.view.own`, or the fact that a منفّذ cannot approve their own work.
 */

test.describe.configure({ mode: 'serial' })

const ROLE = {
  nameAr: 'منفّذ التجربة الثانية',
  nameEn: 'FLOW2_WORKER',
  permissions: [
    'project.view.assigned',
    'task.view.assigned',
    'task.edit',
    'task.comment',
    'ledger.view.own',
  ],
} as const

const WORKER = {
  username: 'flow2.worker',
  password: 'flow2-initial-password',
  newPassword: 'flow2-chosen-password',
  fullName: 'سلمى عبد الله',
  phone: '01098765432',
  taskRate: '750.00',
} as const

const PROJECT = { name: 'حملة التجربة الثانية', startOffsetDays: -3, dueOffsetDays: 30 }
const TASK = { title: 'تصميم غلاف الحملة', dueOffsetDays: 10 }

test('تدفّق ٢: من إنشاء المشروع إلى ظهور الاستحقاق في حركات المنفّذ', async ({
  page,
}) => {
  // ── The manager sets the work up ────────────────────────────────────────
  await signInAsAdmin(page)

  await createRole(page, ROLE)
  await createWorker(page, { ...WORKER, roleNameAr: ROLE.nameAr })
  await createProject(page, PROJECT)

  await createTask(page, {
    projectName: PROJECT.name,
    title: TASK.title,
    assigneeFullName: WORKER.fullName,
    dueOffsetDays: TASK.dueOffsetDays,
  })

  // Assigning at creation *is* an assignment (SPEC §5.1): the task is already
  // ASSIGNED, not BACKLOG, and it carries the assignee's rate.
  await openTask(page, TASK.title)
  const managerSheet = page.getByRole('dialog')
  await expect(managerSheet.getByText(ar.enums.taskStatus.ASSIGNED)).toBeVisible()
  await expect(managerSheet.getByText(WORKER.fullName).first()).toBeVisible()

  await signOut(page)

  // ── The منفّذ does the work ──────────────────────────────────────────────
  await signInFirstTime(page, WORKER.username, WORKER.password, WORKER.newPassword)

  // Their earnings page is empty before approval. This is the assertion that
  // gives the last one its meaning: money appears *because of the approval*,
  // not because a task was assigned or delivered.
  await page.goto('/my-earnings')
  await expect(page.getByText(ar.ledger.empty)).toBeVisible()

  await openTask(page, TASK.title)
  await transitionTask(page, ar.tasks.actions.start)
  await expect(
    page.getByRole('dialog').getByText(ar.enums.taskStatus.IN_PROGRESS),
  ).toBeVisible()

  await transitionTask(page, ar.tasks.actions.submit)
  await expect(
    page.getByRole('dialog').getByText(ar.enums.taskStatus.SUBMITTED),
  ).toBeVisible()

  // A منفّذ cannot approve their own delivery — `task.approve` was never
  // granted, so the transition is not even offered (and `approveTaskAction`
  // would refuse it anyway; CLAUDE.md invariant 3).
  const workerSheet = page.getByRole('dialog')
  await workerSheet.locator('button[aria-haspopup="menu"]').first().click()
  await expect(
    page.getByRole('menuitem', { name: ar.tasks.actions.approve }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.goto('/dashboard')
  await signOut(page)

  // ── The manager reviews and approves ────────────────────────────────────
  await signInAsAdmin(page)
  await openTask(page, TASK.title)

  await transitionTask(page, ar.tasks.actions.sendToReview)
  await expect(
    page.getByRole('dialog').getByText(ar.enums.taskStatus.IN_REVIEW),
  ).toBeVisible()

  await transitionTask(page, ar.tasks.actions.approve)

  // Approval demands a quality rating (SPEC §5.6) — the dialog is the gate.
  const approveDialog = page.getByRole('dialog', { name: ar.tasks.approval.title })
  await expect(approveDialog).toBeVisible()
  await expect(approveDialog.getByText(ar.tasks.approval.ratingLabel)).toBeVisible()
  await page.waitForLoadState('networkidle')
  await approveDialog.getByRole('button', { name: '4', exact: true }).click()
  await approveDialog.getByRole('button', { name: ar.tasks.actions.approve }).click()

  // The dialog closes only on success (`useBusyAction`), so this is the
  // assertion that the *action* landed rather than the one that the screen
  // repainted.
  await expect(approveDialog).toBeHidden()
  await expect(
    page
      .getByRole('dialog', { name: TASK.title })
      .getByText(ar.enums.taskStatus.APPROVED),
  ).toBeVisible()

  await page.goto('/dashboard')
  await signOut(page)

  // ── …and the money is there, on the منفّذ's own page ─────────────────────
  await signIn(page, WORKER.username, WORKER.newPassword)
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/my-earnings')

  const earningRow = page.getByRole('row', {
    name: new RegExp(ar.enums.ledgerType.EARNING),
  })
  await expect(earningRow).toHaveCount(1)
  // The amount is the assignee's `defaultTaskRate`, auto-filled onto the task
  // at assignment (SPEC §5.1) — not a number this test typed anywhere.
  await expect(earningRow).toContainText('750.00')
  // The note is Arabic prose naming the task, because an entry that cannot
  // explain itself is what this product exists to abolish (SPEC §4).
  await expect(earningRow).toContainText(TASK.title)
})
