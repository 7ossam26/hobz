import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import { ar } from '../../src/i18n/ar'
import { runJob } from '../../src/lib/scheduler'
import {
  PENALTY_RECOMPUTE_JOB_NAME,
  registerPenaltyJobs,
} from '../../src/modules/penalty/job'

import {
  createProject,
  createRole,
  createTask,
  createWorker,
  openTask,
  openTaskTab,
  signIn,
  signInAsAdmin,
  signInFirstTime,
  signOut,
} from './helpers'

/**
 * docs/TESTING.md §6, flow #4:
 *
 *   "Approve an extension before the due date → no penalty ever accrues."
 *
 * The word that carries the test is **ever**. It is not enough that the
 * deduction is reversed afterwards, or netted to zero: SPEC §5.3 says an
 * approved extension moves the line the lateness is measured against, so there
 * is nothing to reverse because there was never anything to apply. The
 * assertion is therefore on the *absence* of any `PENALTY` row — checked on
 * the منفّذ's own statement, on the manager's register, and after running the
 * nightly job three times.
 *
 * The control case is flow #3, which is the same task without the extension
 * and does produce a deduction. Read together they are what makes this one
 * mean something.
 */

test.describe.configure({ mode: 'serial' })

const ROLE = {
  nameAr: 'منفّذ التجربة الرابعة',
  nameEn: 'FLOW4_WORKER',
  permissions: ['task.view.assigned', 'task.edit', 'ledger.view.own'],
} as const

const WORKER = {
  username: 'flow4.worker',
  password: 'flow4-initial-password',
  newPassword: 'flow4-chosen-password',
  fullName: 'دينا عادل',
  phone: '01066778899',
  taskRate: '900.00',
} as const

const PROJECT = { name: 'مشروع التجربة الرابعة', startOffsetDays: -20, dueOffsetDays: 60 }
const TASK_TITLE = 'مهمة بتمديد معتمد'
const EXTENSION_REASON = 'العميل طلب إضافة نطاق عمل جديد بعد بدء التنفيذ.'

let jobsRegistered = false

async function runNightlyPenaltyJob(): Promise<void> {
  if (!jobsRegistered) {
    registerPenaltyJobs()
    jobsRegistered = true
  }
  const prisma = new PrismaClient()
  try {
    const result = await runJob(PENALTY_RECOMPUTE_JOB_NAME, 'manual', prisma)
    expect(result.status).toBe('completed')
  } finally {
    await prisma.$disconnect()
  }
}

/** `YYYY-MM-DDTHH:mm`, the value `<input type="datetime-local">` holds. */
function localDateTime(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  date.setHours(17, 0, 0, 0)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

test('تدفّق ٤: تمديد معتمد قبل الموعد فلا يُحتسب أي خصم', async ({ page }) => {
  await signInAsAdmin(page)

  await createRole(page, ROLE)
  await createWorker(page, { ...WORKER, roleNameAr: ROLE.nameAr })
  await createProject(page, PROJECT)

  // Due tomorrow: still ahead of the deadline, which is the precondition the
  // flow's name states — "approve an extension **before** the due date".
  await createTask(page, {
    projectName: PROJECT.name,
    title: TASK_TITLE,
    assigneeFullName: WORKER.fullName,
    dueOffsetDays: 1,
  })

  await signOut(page)

  // ── The منفّذ asks for more time, before the deadline passes ────────────
  await signInFirstTime(page, WORKER.username, WORKER.password, WORKER.newPassword)

  await openTask(page, TASK_TITLE)
  await openTaskTab(page, ar.tasks.detail.tabs.extensions)
  await page.getByRole('button', { name: ar.extensions.request }).click()

  const requestDialog = page.getByRole('dialog', { name: ar.extensions.request })
  // Fourteen days out — past the point the task would otherwise be late by the
  // time the job runs below.
  await requestDialog.getByLabel(ar.extensions.newDueDate).fill(localDateTime(14))
  await requestDialog.getByLabel(ar.extensions.reason).fill(EXTENSION_REASON)
  await requestDialog.getByRole('button', { name: ar.common.confirm }).click()
  await expect(requestDialog).toBeHidden()

  const sheet = page.getByRole('dialog', { name: TASK_TITLE })
  await expect(
    sheet.getByText(ar.extensions.status.PENDING, { exact: true }),
  ).toBeVisible()

  // A منفّذ cannot decide their own request — `task.extend` was never granted.
  await expect(page.getByRole('button', { name: ar.extensions.approve })).toHaveCount(0)

  await page.goto('/dashboard')
  await signOut(page)

  // ── The manager approves it ─────────────────────────────────────────────
  await signInAsAdmin(page)
  await openTask(page, TASK_TITLE)
  await openTaskTab(page, ar.tasks.detail.tabs.extensions)

  await page.getByRole('button', { name: ar.extensions.approve }).first().click()

  const decisionDialog = page.getByRole('dialog', { name: ar.extensions.approve })
  await decisionDialog.getByRole('button', { name: ar.extensions.approve }).click()
  await expect(decisionDialog).toBeHidden()

  // `exact` and scoped to the sheet: "معتمد" is a substring of "معتمدة" (the
  // task status) and of the approve button's own label.
  await expect(
    page
      .getByRole('dialog', { name: TASK_TITLE })
      .getByText(ar.extensions.status.APPROVED, { exact: true }),
  ).toBeVisible()

  // ── The nightly job runs, repeatedly, and finds nothing to deduct ───────
  await runNightlyPenaltyJob()
  await runNightlyPenaltyJob()
  await runNightlyPenaltyJob()

  await page.goto('/penalties')
  await expect(page.getByRole('row', { name: new RegExp(TASK_TITLE) })).toHaveCount(0)

  // …and the task's own خصم tab says so in as many words, rather than showing
  // a zero somebody has to interpret.
  await openTask(page, TASK_TITLE)
  await openTaskTab(page, ar.tasks.detail.tabs.penalty)
  await expect(
    page.getByRole('dialog').getByText(ar.penalties.noPenaltyForTask),
  ).toBeVisible()

  await page.goto('/dashboard')
  await signOut(page)

  // ── Nothing reached the منفّذ's own statement either ─────────────────────
  // Scoped to *this* worker deliberately: earlier flows leave real deductions
  // in the same database, so an agency-wide "no penalties anywhere" assertion
  // would be asserting that the other flows had not run.
  await signIn(page, WORKER.username, WORKER.newPassword)
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/my-earnings')
  await expect(
    page.getByRole('row', { name: new RegExp(ar.enums.ledgerType.PENALTY) }),
  ).toHaveCount(0)
})
