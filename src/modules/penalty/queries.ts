import { requireActor } from '@/lib/auth/session'
import { calendarFor } from '@/lib/calendar'
import { prisma } from '@/lib/db'
import { ForbiddenError } from '@/lib/errors'
import { can, type Actor } from '@/lib/rbac'

import { getPenaltyProfile, listPenaltyProfiles } from './profiles'
import {
  deductionsReport,
  listMoneyRegister,
  taskPenaltyPanel,
  type DeductionsReportDto,
} from './register'
import {
  deductionsReportSchema,
  listMoneyRegisterSchema,
  recomputeTaskPenaltySchema,
} from './schema'
import { loadPenaltySettings } from './settings'
import type {
  MoneyRegisterPageDto,
  PenaltyProfileDto,
  TaskPenaltyPanelDto,
} from './types'

/**
 * Read paths with RBAC scoping baked in (CLAUDE.md invariant 3: "Permissions
 * are enforced in the query layer, server-side. Hiding a button is cosmetic.")
 *
 * ── Which key gates what, and why no new ones were invented ───────────────
 *
 * SPEC §6's catalog is "seeded, not user-editable", so this phase adds no keys
 * and reads the ones that already mean what is needed:
 *
 *  - **The register** is `penalty.view`. It is the screen the key is named for.
 *  - **A منفّذ's own deductions** are already on their مستحقاتي statement under
 *    `ledger.view.own`, so the register does not widen to them; holding neither
 *    key sees nothing, exactly as `modules/ledger/queries` decided.
 *  - **The task panel** is `penalty.view` *or* the ability to see the task's
 *    own money — a منفّذ opening their own task sheet must be able to read the
 *    breakdown of a deduction they cannot contest (SPEC §5.4).
 *  - **Penalty profiles** are `settings.view` / `settings.edit`. A profile is
 *    agency configuration — SPEC §7 lists "Penalty defaults" under Settings —
 *    and inventing a `penaltyProfile.manage` key would be inventing a
 *    permission, which SPEC §6 records as the thing not to do.
 */

export function assertCanViewRegister(actor: Actor | null): void {
  if (!actor || !can(actor, 'penalty.view')) throw new ForbiddenError('penalty.view')
}

export async function getMoneyRegister(raw: unknown): Promise<MoneyRegisterPageDto> {
  const actor = await requireActor()
  assertCanViewRegister(actor)
  const filters = listMoneyRegisterSchema.parse(raw ?? {})

  return listMoneyRegister(prisma, {
    ...filters,
    // Soft-delete is respected in every query (CLAUDE.md invariant 8). The
    // entry itself has no `deletedAt` — it is append-only — so the guard sits
    // on the منفّذ it belongs to.
    scope: { user: { deletedAt: null } },
  })
}

/**
 * The per-task breakdown panel.
 *
 * Deliberately readable by the assignee. SPEC §5.4 gives a منفّذ no way to
 * contest a deduction in-system, and the least a system that deducts
 * automatically owes them is the arithmetic — which is also the point of the
 * whole product (CLAUDE.md).
 */
export async function getTaskPenaltyPanel(raw: unknown): Promise<TaskPenaltyPanelDto> {
  const actor = await requireActor()
  const { taskId } = recomputeTaskPenaltySchema.parse(raw)

  if (!can(actor, 'penalty.view')) {
    const own = await prisma.task.findFirst({
      where: { id: taskId, assigneeId: actor.id, deletedAt: null },
      select: { id: true },
    })
    if (!own || !can(actor, 'ledger.view.own')) {
      throw new ForbiddenError('penalty.view')
    }
  }

  const settings = await loadPenaltySettings()
  return taskPenaltyPanel(prisma, {
    taskId,
    calendar: calendarFor(prisma),
    settings,
    now: new Date(),
  })
}

export async function getDeductionsReport(raw: unknown): Promise<DeductionsReportDto> {
  const actor = await requireActor()
  if (!can(actor, 'report.view')) throw new ForbiddenError('report.view')
  const input = deductionsReportSchema.parse(raw)

  return deductionsReport(prisma, { ...input, scope: { user: { deletedAt: null } } })
}

export async function getPenaltyProfiles(): Promise<PenaltyProfileDto[]> {
  const actor = await requireActor()
  if (!can(actor, 'settings.view')) throw new ForbiddenError('settings.view')
  return listPenaltyProfiles(prisma)
}

export async function getPenaltyProfileById(id: string): Promise<PenaltyProfileDto> {
  const actor = await requireActor()
  if (!can(actor, 'settings.view')) throw new ForbiddenError('settings.view')
  return getPenaltyProfile(prisma, id)
}
