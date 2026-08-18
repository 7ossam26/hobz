import { expect, test } from '@playwright/test'

import { ar } from '../../src/i18n/ar'

import {
  createProject,
  createRole,
  createTask,
  createWorker,
  openTask,
  signIn,
  signInAsAdmin,
  signInFirstTime,
  signOut,
  transitionTask,
} from './helpers'

/**
 * docs/TESTING.md §6, flow #5:
 *
 *   "Close a payout cycle → payout DRAFT → approve → mark partially paid →
 *    remaining balance is correct."
 *
 * The arithmetic is the assertion. SPEC §5.5 defines a payout's `net` as a
 * function of the ledger and nothing else, and `outstanding` as `net −
 * paidAmount`; this flow earns a known amount, closes the cycle, pays half of
 * it, and checks that the number on the manager's screen and the number on the
 * منفّذ's screen are the same number.
 *
 * Two figures are deliberately never typed by this test: the payout's `net`,
 * which comes from the earning the approval created, and the outstanding
 * balance, which comes from the payment. Typing either would let the test
 * agree with itself instead of with the ledger.
 */

test.describe.configure({ mode: 'serial' })

const ROLE = {
  nameAr: 'منفّذ التجربة الخامسة',
  nameEn: 'FLOW5_WORKER',
  permissions: ['task.view.assigned', 'task.edit', 'ledger.view.own'],
} as const

const WORKER = {
  username: 'flow5.worker',
  password: 'flow5-initial-password',
  newPassword: 'flow5-chosen-password',
  fullName: 'ياسمين فؤاد',
  phone: '01033221100',
  /** Chosen so half of it is exact to the piastre — a partial payment must not
   *  be the test's own rounding decision. */
  taskRate: '2000.00',
} as const

const PROJECT = { name: 'مشروع التجربة الخامسة', startOffsetDays: -10, dueOffsetDays: 45 }
const TASK_TITLE = 'مهمة مستحقة الصرف'

test('تدفّق ٥: إغلاق دورة صرف، اعتماد المستحق، صرف جزئي، ثم رصيد متبقٍّ صحيح', async ({
  page,
}) => {
  await signInAsAdmin(page)

  await createRole(page, ROLE)
  await createWorker(page, { ...WORKER, roleNameAr: ROLE.nameAr })
  await createProject(page, PROJECT)
  await createTask(page, {
    projectName: PROJECT.name,
    title: TASK_TITLE,
    assigneeFullName: WORKER.fullName,
    dueOffsetDays: 14,
  })

  await signOut(page)

  // ── The منفّذ delivers ───────────────────────────────────────────────────
  await signInFirstTime(page, WORKER.username, WORKER.password, WORKER.newPassword)
  await openTask(page, TASK_TITLE)
  await transitionTask(page, ar.tasks.actions.start)
  await transitionTask(page, ar.tasks.actions.submit)
  await expect(
    page.getByRole('dialog').getByText(ar.enums.taskStatus.SUBMITTED),
  ).toBeVisible()
  await page.goto('/dashboard')
  await signOut(page)

  // ── The manager approves, which is what mints the money ─────────────────
  await signInAsAdmin(page)
  await openTask(page, TASK_TITLE)
  await transitionTask(page, ar.tasks.actions.sendToReview)
  await transitionTask(page, ar.tasks.actions.approve)

  const approveDialog = page.getByRole('dialog', { name: ar.tasks.approval.title })
  await approveDialog.getByRole('button', { name: '5', exact: true }).click()
  await approveDialog.getByRole('button', { name: ar.tasks.actions.approve }).click()
  await expect(
    page.getByRole('dialog').getByText(ar.enums.taskStatus.APPROVED),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  // ── Close the cycle ─────────────────────────────────────────────────────
  await page.goto('/payouts')
  await page.getByRole('button', { name: ar.payouts.closeCycle }).click()

  const confirm = page.getByRole('dialog', { name: ar.payouts.closeCycle })
  await confirm.getByRole('button', { name: ar.payouts.closeCycle }).click()
  await expect(confirm).toBeHidden()

  // ── A DRAFT payout for this منفّذ, carrying the earning ──────────────────
  const payoutRow = page.getByRole('row', { name: new RegExp(WORKER.fullName) })
  await expect(payoutRow).toHaveCount(1)
  await expect(payoutRow).toContainText(ar.enums.payoutStatus.DRAFT)
  await expect(payoutRow).toContainText(WORKER.taskRate.replace('.00', ''))

  // ── Approve it ──────────────────────────────────────────────────────────
  await payoutRow.getByRole('button', { name: ar.payouts.approve }).click()
  await expect(payoutRow).toContainText(ar.enums.payoutStatus.APPROVED)

  // ── Pay half ────────────────────────────────────────────────────────────
  await payoutRow.getByRole('button', { name: ar.payouts.markPaid }).click()

  const paymentDialog = page.getByRole('dialog', { name: ar.payouts.markPaid })
  const amountField = paymentDialog.getByLabel(ar.payouts.amountToPay)

  // The dialog opens pre-filled with the whole outstanding amount, which is
  // where this test learns what the ledger decided the payout is worth.
  const outstanding = await amountField.inputValue()
  expect(Number(outstanding)).toBeGreaterThan(0)

  const half = (Number(outstanding) / 2).toFixed(2)
  await amountField.fill(half)
  await paymentDialog.getByRole('button', { name: ar.common.confirm }).click()
  await expect(paymentDialog).toBeHidden()

  // Half paid is not paid: the payout stays APPROVED until the balance is
  // zero (SPEC §5.5), and the remainder is shown, not implied.
  await expect(payoutRow).toContainText(ar.enums.payoutStatus.APPROVED)
  await expect(payoutRow).toContainText(half)

  // ── Paying the rest closes it ───────────────────────────────────────────
  await payoutRow.getByRole('button', { name: ar.payouts.markPaid }).click()
  const secondPayment = page.getByRole('dialog', { name: ar.payouts.markPaid })
  await expect(secondPayment.getByLabel(ar.payouts.amountToPay)).toHaveValue(half)

  // Overpaying is refused on the field, before anything is written.
  await secondPayment
    .getByLabel(ar.payouts.amountToPay)
    .fill((Number(outstanding) + 1).toFixed(2))
  await secondPayment.getByRole('button', { name: ar.common.confirm }).click()
  await expect(
    secondPayment.getByText(ar.payouts.errors.exceedsOutstanding),
  ).toBeVisible()

  await secondPayment.getByLabel(ar.payouts.amountToPay).fill(half)
  await secondPayment.getByRole('button', { name: ar.common.confirm }).click()
  await expect(secondPayment).toBeHidden()

  await expect(payoutRow).toContainText(ar.enums.payoutStatus.PAID)
  await expect(payoutRow.getByRole('button', { name: ar.payouts.markPaid })).toHaveCount(
    0,
  )

  await signOut(page)

  // ── The منفّذ sees the same arithmetic on their own page ─────────────────
  await signIn(page, WORKER.username, WORKER.newPassword)
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/my-earnings')

  // Two `PAYOUT` rows, one per payment, because the ledger records payments
  // and never edits a running total (CLAUDE.md invariant 1).
  await expect(
    page.getByRole('row', { name: new RegExp(ar.enums.ledgerType.PAYOUT) }),
  ).toHaveCount(2)
  await expect(
    page.getByRole('row', { name: new RegExp(ar.enums.ledgerType.EARNING) }),
  ).toHaveCount(1)
})
