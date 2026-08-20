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
  signInAsAdmin,
  signInFirstTime,
  signOut,
} from './helpers'

/**
 * docs/TESTING.md §6, flow #3:
 *
 *   "Task goes overdue → daily job runs → penalty appears → worker is notified
 *    → manager reverses it with a reason → audit log shows both entries."
 *
 * This is the product's thesis end to end: a deduction that nobody typed,
 * arriving with an explanation, and a correction that adds a row rather than
 * editing one (CLAUDE.md invariant 1).
 *
 * ── The one thing not driven through the browser ───────────────────────────
 *
 * "The daily job runs" has no button, because a cron tick is not a user
 * action. It is invoked here through `runJob` — the *same* entry point
 * `lib/scheduler`'s cron tick uses, under the same Postgres advisory lock,
 * with the same registered `JobDefinition` and the same notification bus. What
 * is skipped is `node-cron` deciding that it is 03:00, and that is the only
 * thing skipped.
 */

test.describe.configure({ mode: 'serial' })

const ROLE = {
  nameAr: 'منفّذ التجربة الثالثة',
  nameEn: 'flow3_worker',
  permissions: ['task.view.assigned', 'task.work.assigned', 'ledger.view.own'],
} as const

const WORKER = {
  username: 'flow3.worker',
  password: 'flow3-initial-password',
  newPassword: 'flow3-chosen-password',
  fullName: 'هاني رمضان',
  phone: '01055443322',
  taskRate: '1000.00',
} as const

const PROJECT = { name: 'مشروع التجربة الثالثة', startOffsetDays: -30, dueOffsetDays: 30 }
const TASK_TITLE = 'تسليم متأخر للتجربة'
const REVERSAL_REASON = 'التأخير كان بسبب تأخر العميل في إرسال المواد.'

/** Registered once per process; a second call would throw on the duplicate name. */
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

test('تدفّق ٣: خصم تلقائي على تأخير، ثم عكسه بسبب، وكلاهما في سجل التدقيق', async ({
  page,
}) => {
  // ── Set up a task that is already well past its deadline ────────────────
  await signInAsAdmin(page)

  await createRole(page, ROLE)
  await createWorker(page, { ...WORKER, roleNameAr: ROLE.nameAr })
  await createProject(page, PROJECT)

  // Eight days late, against the default 24-hour grace (`penalty
  // .defaultGraceHours`) — comfortably past it whichever weekday today is,
  // and still short enough that weekends cannot swallow the whole window.
  await createTask(page, {
    projectName: PROJECT.name,
    title: TASK_TITLE,
    assigneeFullName: WORKER.fullName,
    dueOffsetDays: -8,
  })

  // Nothing has been deducted yet. The register is the manager's view of every
  // خصم in the organization, and it is empty until the job runs.
  await page.goto('/penalties')
  await expect(page.getByRole('row', { name: new RegExp(TASK_TITLE) })).toHaveCount(0)

  // ── The nightly job runs ────────────────────────────────────────────────
  await runNightlyPenaltyJob()

  // ── The deduction is there, and it is marked automatic ──────────────────
  await page.goto('/penalties')
  const penaltyRow = page.getByRole('row', { name: new RegExp(TASK_TITLE) })
  await expect(penaltyRow).toHaveCount(1)
  // The row's own words: the engine wrote this, and the note explains the
  // arithmetic rather than asserting a number.
  await expect(penaltyRow).toContainText(ar.ledger.automatic)
  await expect(penaltyRow).toContainText(TASK_TITLE)

  await signOut(page)

  // ── The منفّذ is told, in Arabic, on their own pages ─────────────────────
  await signInFirstTime(page, WORKER.username, WORKER.password, WORKER.newPassword)

  const bell = page.getByRole('button', { name: new RegExp(ar.shell.notifications) })
  await bell.click()
  await expect(
    page.getByText(ar.notifications.messages.penaltyApplied.title),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/my-earnings')
  const ledgerRow = page.getByRole('row', {
    name: new RegExp(ar.enums.ledgerType.PENALTY),
  })
  await expect(ledgerRow).toHaveCount(1)

  await signOut(page)

  // ── The manager reverses it, and must say why ───────────────────────────
  await signInAsAdmin(page)
  await page.goto('/penalties')

  await page.getByRole('button', { name: ar.penalties.reverse.action }).first().click()

  const reversalDialog = page.getByRole('dialog')
  // The reason is mandatory: the reversal's note is what the منفّذ reads.
  await expect(
    reversalDialog.getByRole('button', { name: ar.penalties.reverse.action }),
  ).toBeDisabled()

  await reversalDialog.getByLabel(ar.penalties.reverse.reason).fill(REVERSAL_REASON)
  await reversalDialog.getByRole('button', { name: ar.penalties.reverse.action }).click()
  await expect(reversalDialog).toBeHidden()

  // The original row is still there, struck through, with the reason beside
  // it — the ledger is append-only, so a reversal *adds* (invariant 1).
  await expect(page.getByText(REVERSAL_REASON)).toBeVisible()

  // ── The audit log carries both events ───────────────────────────────────
  await page.goto('/audit')

  // `penalty.applied`, not `penalty.created`: the engine and a manager write
  // different audit actions on purpose (`modules/penalty/service.ts`), because
  // "the calendar decided this" and "a person decided this" are the two facts
  // the whole product exists to keep apart.
  const applied = page.getByRole('row', {
    name: new RegExp(ar.auditActions['penalty.applied']),
  })
  const reversed = page.getByRole('row', {
    name: new RegExp(ar.auditActions['penalty.reversed']),
  })
  await expect(applied.first()).toBeVisible()
  await expect(reversed.first()).toBeVisible()

  // And the manual one is absent — nobody typed this deduction.
  await expect(
    page.getByRole('row', { name: new RegExp(ar.auditActions['penalty.created']) }),
  ).toHaveCount(0)

  // ── The engine re-applies, and that is the documented behaviour ────────
  //
  // A reversal corrects *that entry*; it does not waive the debt, because the
  // deadline has not moved and the work is still late. So the next sweep
  // charges again as a **new** row, leaving the statement reading
  // خصم / عكس / خصم — each with its own date and reason
  // (`tests/integration/penalty/axis7-reversal.test.ts` pins the same rule).
  // The way to actually forgive lateness is an approved extension, which is
  // flow #4.
  await runNightlyPenaltyJob()
  await runNightlyPenaltyJob()

  await page.goto('/penalties')
  const rows = page.getByRole('row', { name: new RegExp(TASK_TITLE) })
  await expect(rows).toHaveCount(2)

  // Idempotent all the same: a third and fourth run add nothing further,
  // because there is now an active automatic entry again (invariant 6).
  await runNightlyPenaltyJob()
  await runNightlyPenaltyJob()
  await page.reload()
  await expect(page.getByRole('row', { name: new RegExp(TASK_TITLE) })).toHaveCount(2)
})
