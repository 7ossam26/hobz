import { randomUUID } from 'node:crypto'

import { ar } from '@/i18n/ar'
import { recordAudit } from '@/lib/audit'
import { validatePassword } from '@/lib/auth/password'
import { getPasswordPolicy } from '@/lib/auth/policy'
import { normalizeUsername } from '@/lib/auth/username'
import type { Db } from '@/lib/db'
import type { Actor } from '@/lib/rbac'
import { getSetting } from '@/lib/settings'
import { createClientSchema } from '@/modules/client/schema'
import { createClient } from '@/modules/client/service'
import { prismaLeaveLookup } from '@/modules/leave/lookup'
import { createProjectSchema, updateProjectSchema } from '@/modules/project/schema'
import { createProject, updateProject } from '@/modules/project/service'
import { createTaskSchema } from '@/modules/task/schema'
import { createTask } from '@/modules/task/service'
import { createUserSchema, updateUserSchema } from '@/modules/user/schema'
import { createUser, updateUser } from '@/modules/user/service'

import {
  cellBool,
  cellDateInput,
  cellEnumValue,
  cellNumber,
  cellOptionalText,
  cellText,
} from './cells'
import type { ImportColumnDef } from './columns'
import { importColumns } from './columns'
import { parseImportFile, type ParsedImportRow } from './parse'
import { findClientByName, findProjectByCode, findUserByUsername } from './resolve'
import type { ImportEntity } from './schema'
import type {
  ImportConfirmResultDto,
  ImportPreviewDto,
  ImportRowAction,
  ImportRowError,
} from './types'

/**
 * modules/import/service.ts — SPEC §10.
 *
 * `previewImport` and `confirmImport` run the exact same pipeline
 * (`planImport`): parse → per-row resolve/validate → partition into
 * create/update/invalid. The only difference is which `Db` they are handed —
 * `prisma` (read-only) for a dry run, an interactive transaction for a
 * confirm — and whether anyone calls the `commit` closure a valid row
 * carries. This is deliberate, not an optimisation: it is what makes a
 * confirm re-validate against the database's *current* state rather than
 * trust a dry run that may be minutes old, and what makes every create/update
 * go through the exact same service function (`createUser`, `updateProject`,
 * …) the rest of the product uses — so an imported row is audited, state-
 * machine-correct and Settings-validated exactly like one entered by hand.
 *
 * Rows this pass already knows are invalid are never attempted as a write —
 * "all-or-nothing" (phase brief item 4) describes the transaction the valid
 * rows share: any unexpected failure among them rolls back every write this
 * confirm made, per `prisma.$transaction`'s own semantics, which is also
 * what gives a failed import zero persisted rows.
 */

interface RowPlan {
  rowNumber: number
  action: ImportRowAction
  summary: string
  errors: ImportRowError[]
  commit?: () => Promise<void>
}

function columnMap<K extends string>(
  columns: readonly ImportColumnDef[],
): Record<K, ImportColumnDef> {
  return Object.fromEntries(columns.map((column) => [column.key, column])) as Record<
    K,
    ImportColumnDef
  >
}

function fieldError(column: ImportColumnDef, message: string): ImportRowError {
  return { field: column.key, message: `${column.header}: ${message}` }
}

function invalidPlan(
  rowNumber: number,
  summary: string,
  errors: ImportRowError[],
): RowPlan {
  return { rowNumber, action: 'invalid', summary, errors }
}

function zodErrorsToFields(
  issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>,
  columns: readonly ImportColumnDef[],
): ImportRowError[] {
  const byKey = new Map(columns.map((column) => [column.key, column]))
  return issues.map((issue) => {
    const key = String(issue.path[0] ?? '')
    const header = byKey.get(key)?.header ?? key
    return { field: key, message: `${header}: ${issue.message}` }
  })
}

function requiredEnumValue(
  column: ImportColumnDef,
  raw: unknown,
  errors: ImportRowError[],
): string | null {
  if (cellOptionalText(raw) === null) {
    errors.push(fieldError(column, ar.validation.required))
    return null
  }
  const value = cellEnumValue(column, raw)
  if (value === null) errors.push(fieldError(column, ar.import.errors.invalidOption))
  return value
}

function optionalEnumValue(
  column: ImportColumnDef,
  raw: unknown,
  errors: ImportRowError[],
): string | null {
  if (cellOptionalText(raw) === null) return null
  const value = cellEnumValue(column, raw)
  if (value === null) errors.push(fieldError(column, ar.import.errors.invalidOption))
  return value
}

// ── Users ────────────────────────────────────────────────────────────────

type UserColumnKey =
  | 'username'
  | 'fullName'
  | 'password'
  | 'phone'
  | 'isWorker'
  | 'payType'
  | 'monthlySalary'
  | 'defaultTaskRate'
  | 'weeklyCapacityHours'

async function planUsers(
  db: Db,
  rows: readonly ParsedImportRow[],
  columns: readonly ImportColumnDef[],
  actor: Actor,
): Promise<RowPlan[]> {
  const col = columnMap<UserColumnKey>(columns)
  const policy = await getPasswordPolicy()
  const seen = new Set<string>()
  const plans: RowPlan[] = []

  for (const row of rows) {
    const errors: ImportRowError[] = []
    const usernameRaw = cellOptionalText(row.cells.username)
    const fullName = cellOptionalText(row.cells.fullName)
    const summary = usernameRaw ?? fullName ?? `#${row.rowNumber}`

    if (usernameRaw === null)
      errors.push(fieldError(col.username, ar.validation.required))
    if (fullName === null) errors.push(fieldError(col.fullName, ar.validation.required))

    const normalized = usernameRaw ? normalizeUsername(usernameRaw) : null
    if (normalized) {
      if (seen.has(normalized))
        errors.push(fieldError(col.username, ar.import.errors.duplicateInFile))
      seen.add(normalized)
    }

    const payType =
      optionalEnumValue(col.payType, row.cells.payType, errors) ?? 'PER_TASK'
    const capacity = cellNumber(row.cells.weeklyCapacityHours)
    if (!capacity.ok)
      errors.push(fieldError(col.weeklyCapacityHours, ar.validation.capacityRange))

    if (errors.length > 0 || !normalized) {
      plans.push(invalidPlan(row.rowNumber, summary, errors))
      continue
    }

    const existing = await findUserByUsername(db, normalized)
    const isWorker = cellBool(row.cells.isWorker) ?? false
    const shared = {
      fullName,
      phone: cellText(row.cells.phone),
      isWorker,
      payType,
      monthlySalary: cellText(row.cells.monthlySalary),
      defaultTaskRate: cellText(row.cells.defaultTaskRate),
      weeklyCapacityHours: capacity.ok ? capacity.value : undefined,
    }

    if (existing) {
      const parsed = updateUserSchema.safeParse({ id: existing.id, ...shared })
      if (!parsed.success) {
        plans.push(
          invalidPlan(
            row.rowNumber,
            summary,
            zodErrorsToFields(parsed.error.issues, columns),
          ),
        )
        continue
      }
      plans.push({
        rowNumber: row.rowNumber,
        action: 'update',
        summary,
        errors: [],
        commit: async () => {
          await updateUser(db, { actor, input: parsed.data })
        },
      })
      continue
    }

    const password = cellOptionalText(row.cells.password)
    if (password === null) {
      plans.push(
        invalidPlan(row.rowNumber, summary, [
          fieldError(col.password, ar.validation.required),
        ]),
      )
      continue
    }
    const problems = validatePassword(password, policy, { username: usernameRaw ?? '' })
    if (problems.length > 0) {
      const message =
        problems[0] === 'validation.passwordContainsUsername'
          ? ar.validation.passwordContainsUsername
          : ar.validation.passwordTooShort.replace('{min}', String(policy.minLength))
      plans.push(invalidPlan(row.rowNumber, summary, [fieldError(col.password, message)]))
      continue
    }

    const parsed = createUserSchema.safeParse({
      username: usernameRaw,
      password,
      ...shared,
    })
    if (!parsed.success) {
      plans.push(
        invalidPlan(
          row.rowNumber,
          summary,
          zodErrorsToFields(parsed.error.issues, columns),
        ),
      )
      continue
    }
    plans.push({
      rowNumber: row.rowNumber,
      action: 'create',
      summary,
      errors: [],
      commit: async () => {
        await createUser(db, { actor, input: parsed.data, policy })
      },
    })
  }

  return plans
}

// ── Clients ──────────────────────────────────────────────────────────────

type ClientColumnKey = 'name' | 'phone' | 'notes'

function planClients(
  db: Db,
  rows: readonly ParsedImportRow[],
  columns: readonly ImportColumnDef[],
  actor: Actor,
): RowPlan[] {
  const col = columnMap<ClientColumnKey>(columns)

  return rows.map((row) => {
    const errors: ImportRowError[] = []
    const name = cellOptionalText(row.cells.name)
    const summary = name ?? `#${row.rowNumber}`
    if (name === null) errors.push(fieldError(col.name, ar.validation.required))
    if (errors.length > 0) return invalidPlan(row.rowNumber, summary, errors)

    const parsed = createClientSchema.safeParse({
      name,
      phone: cellText(row.cells.phone),
      notes: cellText(row.cells.notes),
    })
    if (!parsed.success) {
      return invalidPlan(
        row.rowNumber,
        summary,
        zodErrorsToFields(parsed.error.issues, columns),
      )
    }

    return {
      rowNumber: row.rowNumber,
      action: 'create',
      summary,
      errors: [],
      commit: async () => {
        await createClient(db, { actor, input: parsed.data })
      },
    }
  })
}

// ── Projects ─────────────────────────────────────────────────────────────

type ProjectColumnKey =
  | 'code'
  | 'name'
  | 'clientName'
  | 'ownerUsername'
  | 'engagementType'
  | 'status'
  | 'startDate'
  | 'dueDate'

async function planProjects(
  db: Db,
  rows: readonly ParsedImportRow[],
  columns: readonly ImportColumnDef[],
  actor: Actor,
): Promise<RowPlan[]> {
  const col = columnMap<ProjectColumnKey>(columns)
  const enabledEngagementTypes = await getSetting('projects.engagementTypes')
  const seenCodes = new Set<string>()
  const plans: RowPlan[] = []

  for (const row of rows) {
    const errors: ImportRowError[] = []
    const name = cellOptionalText(row.cells.name)
    const codeRaw = cellOptionalText(row.cells.code)
    const summary = name ?? codeRaw ?? `#${row.rowNumber}`

    if (name === null) errors.push(fieldError(col.name, ar.validation.required))
    if (codeRaw !== null) {
      if (seenCodes.has(codeRaw))
        errors.push(fieldError(col.code, ar.import.errors.duplicateInFile))
      seenCodes.add(codeRaw)
    }

    let clientId: string | null = null
    const clientNameRaw = cellOptionalText(row.cells.clientName)
    if (clientNameRaw !== null) {
      const found = await findClientByName(db, clientNameRaw)
      if (found === 'not_found')
        errors.push(fieldError(col.clientName, ar.import.errors.unresolvedClient))
      else if (found === 'ambiguous')
        errors.push(fieldError(col.clientName, ar.import.errors.ambiguousClient))
      else clientId = found.id
    }

    let ownerId: string | null = null
    const ownerUsernameRaw = cellOptionalText(row.cells.ownerUsername)
    if (ownerUsernameRaw === null) {
      errors.push(fieldError(col.ownerUsername, ar.validation.required))
    } else {
      const owner = await findUserByUsername(db, normalizeUsername(ownerUsernameRaw))
      if (!owner)
        errors.push(fieldError(col.ownerUsername, ar.import.errors.unresolvedUser))
      else ownerId = owner.id
    }

    const engagementType = requiredEnumValue(
      col.engagementType,
      row.cells.engagementType,
      errors,
    )
    const status = optionalEnumValue(col.status, row.cells.status, errors)

    const startDate = cellDateInput(row.cells.startDate)
    const dueDate = cellDateInput(row.cells.dueDate)
    if (startDate === null) errors.push(fieldError(col.startDate, ar.validation.required))
    if (dueDate === null) errors.push(fieldError(col.dueDate, ar.validation.required))

    if (errors.length > 0) {
      plans.push(invalidPlan(row.rowNumber, summary, errors))
      continue
    }

    const existing = codeRaw ? await findProjectByCode(db, codeRaw) : null

    // Passed straight to `.safeParse(data: unknown)` — Zod, not this object
    // literal, is the source of truth for whether `engagementType`/`status`
    // are legal values; a resolver miss already pushed an error above and
    // stopped this row from reaching here.
    const shared = {
      name,
      clientId: clientId ?? undefined,
      ownerId,
      engagementType,
      status: status ?? undefined,
      startDate,
      dueDate,
      gracePeriodHours: null,
      penalizeRevisionLateness: null,
    }

    if (existing) {
      const parsed = updateProjectSchema.safeParse({
        id: existing.id,
        code: codeRaw,
        ...shared,
      })
      if (!parsed.success) {
        plans.push(
          invalidPlan(
            row.rowNumber,
            summary,
            zodErrorsToFields(parsed.error.issues, columns),
          ),
        )
        continue
      }
      plans.push({
        rowNumber: row.rowNumber,
        action: 'update',
        summary,
        errors: [],
        commit: async () => {
          await updateProject(db, { actor, input: parsed.data, enabledEngagementTypes })
        },
      })
      continue
    }

    const parsed = createProjectSchema.safeParse({
      code: codeRaw ?? undefined,
      ...shared,
    })
    if (!parsed.success) {
      plans.push(
        invalidPlan(
          row.rowNumber,
          summary,
          zodErrorsToFields(parsed.error.issues, columns),
        ),
      )
      continue
    }
    plans.push({
      rowNumber: row.rowNumber,
      action: 'create',
      summary,
      errors: [],
      commit: async () => {
        await createProject(db, { actor, input: parsed.data, enabledEngagementTypes })
      },
    })
  }

  return plans
}

// ── Tasks ────────────────────────────────────────────────────────────────

type TaskColumnKey =
  | 'projectCode'
  | 'title'
  | 'description'
  | 'categoryLabel'
  | 'priority'
  | 'assigneeUsername'
  | 'dueDate'
  | 'estimatedHours'
  | 'taskValue'

async function planTasks(
  db: Db,
  rows: readonly ParsedImportRow[],
  columns: readonly ImportColumnDef[],
  actor: Actor,
): Promise<RowPlan[]> {
  const col = columnMap<TaskColumnKey>(columns)
  const categories = await getSetting('tasks.categories')
  const plans: RowPlan[] = []

  for (const row of rows) {
    const errors: ImportRowError[] = []
    const title = cellOptionalText(row.cells.title)
    const summary = title ?? `#${row.rowNumber}`
    if (title === null) errors.push(fieldError(col.title, ar.validation.required))

    let projectId: string | null = null
    const projectCodeRaw = cellOptionalText(row.cells.projectCode)
    if (projectCodeRaw === null) {
      errors.push(fieldError(col.projectCode, ar.validation.required))
    } else {
      const project = await findProjectByCode(db, projectCodeRaw)
      if (!project)
        errors.push(fieldError(col.projectCode, ar.import.errors.unresolvedProject))
      else projectId = project.id
    }

    let assigneeId: string | null = null
    const assigneeUsernameRaw = cellOptionalText(row.cells.assigneeUsername)
    if (assigneeUsernameRaw !== null) {
      const assignee = await findUserByUsername(
        db,
        normalizeUsername(assigneeUsernameRaw),
      )
      if (!assignee)
        errors.push(fieldError(col.assigneeUsername, ar.import.errors.unresolvedUser))
      else if (!assignee.isActive)
        errors.push(fieldError(col.assigneeUsername, ar.import.errors.inactiveAssignee))
      else assigneeId = assignee.id
    }

    const categoryId = requiredEnumValue(
      col.categoryLabel,
      row.cells.categoryLabel,
      errors,
    )
    const priority = optionalEnumValue(col.priority, row.cells.priority, errors)

    const dueDate = cellDateInput(row.cells.dueDate)
    if (dueDate === null) errors.push(fieldError(col.dueDate, ar.validation.required))

    const hours = cellNumber(row.cells.estimatedHours)
    if (!hours.ok) errors.push(fieldError(col.estimatedHours, ar.validation.amountFormat))

    if (errors.length > 0) {
      plans.push(invalidPlan(row.rowNumber, summary, errors))
      continue
    }

    const parsed = createTaskSchema.safeParse({
      projectId,
      title,
      description: cellText(row.cells.description),
      priority: priority ?? undefined,
      categoryId,
      estimatedHours: hours.ok ? hours.value : undefined,
      dueDate,
      assigneeId: assigneeId ?? undefined,
      taskValue: cellText(row.cells.taskValue),
      watcherIds: [],
    })
    if (!parsed.success) {
      plans.push(
        invalidPlan(
          row.rowNumber,
          summary,
          zodErrorsToFields(parsed.error.issues, columns),
        ),
      )
      continue
    }

    plans.push({
      rowNumber: row.rowNumber,
      action: 'create',
      summary,
      errors: [],
      commit: async () => {
        await createTask(db, {
          actor,
          input: parsed.data,
          categories,
          leave: prismaLeaveLookup,
        })
      },
    })
  }

  return plans
}

// ── Entry points ─────────────────────────────────────────────────────────

export interface PlanImportArgs {
  entity: ImportEntity
  buffer: Buffer
  actor: Actor
}

async function planImport(db: Db, args: PlanImportArgs): Promise<RowPlan[]> {
  const columns = await importColumns(args.entity)
  const { rows } = parseImportFile(args.entity, args.buffer, columns)

  switch (args.entity) {
    case 'users':
      return planUsers(db, rows, columns, args.actor)
    case 'clients':
      return planClients(db, rows, columns, args.actor)
    case 'projects':
      return planProjects(db, rows, columns, args.actor)
    case 'tasks':
      return planTasks(db, rows, columns, args.actor)
  }
}

function summarize(entity: ImportEntity, plans: readonly RowPlan[]): ImportPreviewDto {
  return {
    entity,
    totalRows: plans.length,
    toCreate: plans.filter((plan) => plan.action === 'create').length,
    toUpdate: plans.filter((plan) => plan.action === 'update').length,
    invalid: plans.filter((plan) => plan.action === 'invalid').length,
    rows: plans.map((plan) => ({
      rowNumber: plan.rowNumber,
      action: plan.action,
      summary: plan.summary,
      errors: plan.errors,
    })),
  }
}

/** Read-only — resolves every relationship and validates every field, writes nothing. */
export async function previewImport(
  db: Db,
  args: PlanImportArgs,
): Promise<ImportPreviewDto> {
  const plans = await planImport(db, args)
  return summarize(args.entity, plans)
}

export interface ConfirmImportArgs extends PlanImportArgs {
  ip?: string | undefined
}

/**
 * Re-runs the same plan against `db` (the caller's transaction — see
 * `actions.ts`) and writes every valid row through its entity's own
 * create/update service function. Never called with the plain `prisma`
 * client: a caller outside a transaction would lose the all-or-nothing
 * guarantee this function's callers rely on.
 */
export async function confirmImport(
  db: Db,
  args: ConfirmImportArgs,
): Promise<ImportConfirmResultDto> {
  const plans = await planImport(db, args)

  let created = 0
  let updated = 0
  for (const plan of plans) {
    if (plan.action === 'create' && plan.commit) {
      await plan.commit()
      created += 1
    } else if (plan.action === 'update' && plan.commit) {
      await plan.commit()
      updated += 1
    }
  }
  const skipped = plans.length - created - updated

  await recordAudit(db, {
    actor: args.actor,
    action: 'import.completed',
    entity: 'Import',
    entityId: randomUUID(),
    after: { entity: args.entity, totalRows: plans.length, created, updated, skipped },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return { entity: args.entity, created, updated, skipped }
}
