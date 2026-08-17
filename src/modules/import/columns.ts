import { ar } from '@/i18n/ar'
import { getSetting } from '@/lib/settings'

import type { ImportEntity } from './schema'

/**
 * modules/import/columns.ts — the one place a template's shape is described.
 * `template.ts` (the workbook writer), `parse.ts` (the row reader) and the
 * instructions sheet all derive from this, so the three can never disagree
 * about a header text or a column's position.
 *
 * Enum-kind columns carry their dropdown as **Arabic display text**, not the
 * enum's code value — a spreadsheet is filled in by a person, and the values
 * already editable in Settings (`labels.priority`, `labels.projectStatus`,
 * `tasks.categories`) are read live rather than hardcoded, per CLAUDE.md
 * invariant 4. `resolve.ts` maps the typed text back to the code value.
 */

/**
 * 'money' fields are string-typed all the way to Prisma's `Decimal` (CLAUDE.md
 * invariant 2) — the cell's text passes straight to the entity's own
 * `moneySchema`. 'number' fields (`weeklyCapacityHours`, `estimatedHours`) are
 * genuinely `z.number()` in their schema, so the cell is parsed to a JS number
 * before the schema ever sees it.
 */
export type ImportColumnKind =
  'text' | 'password' | 'bool' | 'enum' | 'date' | 'money' | 'number'

export interface ImportColumnDef {
  key: string
  header: string
  hint: string
  required: boolean
  kind: ImportColumnKind
  /** 'enum' kind only — the dropdown's options, Arabic display text, in order. */
  options?: readonly string[]
  /** 'enum' kind only — display text → the value stored on the parsed row. */
  optionValues?: ReadonlyMap<string, string>
  sample: string
}

const YES = ar.common.yes
const NO = ar.common.no

function boolColumn(
  key: string,
  copy: { header: string; hint: string; sample: string },
  required: boolean,
): ImportColumnDef {
  return {
    key,
    header: copy.header,
    hint: copy.hint,
    sample: copy.sample,
    required,
    kind: 'bool',
    options: [YES, NO],
  }
}

function enumColumn(
  key: string,
  copy: { header: string; hint: string; sample: string },
  required: boolean,
  valueToLabel: ReadonlyMap<string, string>,
): ImportColumnDef {
  const optionValues = new Map<string, string>()
  const options: string[] = []
  for (const [value, label] of valueToLabel) {
    options.push(label)
    optionValues.set(label, value)
  }
  return {
    key,
    header: copy.header,
    hint: copy.hint,
    sample: copy.sample,
    required,
    kind: 'enum',
    options,
    optionValues,
  }
}

function textColumn(
  kind: 'text' | 'password' | 'date' | 'money' | 'number',
  key: string,
  copy: { header: string; hint: string; sample: string },
  required: boolean,
): ImportColumnDef {
  return {
    key,
    header: copy.header,
    hint: copy.hint,
    sample: copy.sample,
    required,
    kind,
  }
}

async function usersColumns(): Promise<ImportColumnDef[]> {
  const c = ar.import.columns.users
  return [
    textColumn('text', 'username', c.username, true),
    textColumn('text', 'fullName', c.fullName, true),
    textColumn('password', 'password', c.password, false),
    textColumn('text', 'phone', c.phone, false),
    boolColumn('isWorker', c.isWorker, false),
    enumColumn(
      'payType',
      c.payType,
      false,
      new Map(Object.entries(ar.enums.payType).map(([k, v]) => [k, v])),
    ),
    textColumn('money', 'monthlySalary', c.monthlySalary, false),
    textColumn('money', 'defaultTaskRate', c.defaultTaskRate, false),
    textColumn('number', 'weeklyCapacityHours', c.weeklyCapacityHours, false),
  ]
}

function clientsColumns(): ImportColumnDef[] {
  const c = ar.import.columns.clients
  return [
    textColumn('text', 'name', c.name, true),
    textColumn('text', 'phone', c.phone, false),
    textColumn('text', 'notes', c.notes, false),
  ]
}

async function projectsColumns(): Promise<ImportColumnDef[]> {
  const c = ar.import.columns.projects
  const [enabledEngagementTypes, statusLabels] = await Promise.all([
    getSetting('projects.engagementTypes'),
    getSetting('labels.projectStatus'),
  ])

  const engagementTypeMap = new Map(
    enabledEngagementTypes.map((value) => [value, ar.enums.engagementType[value]]),
  )
  const statusMap = new Map(Object.entries(statusLabels))

  return [
    textColumn('text', 'code', c.code, false),
    textColumn('text', 'name', c.name, true),
    textColumn('text', 'clientName', c.clientName, false),
    textColumn('text', 'ownerUsername', c.ownerUsername, true),
    enumColumn('engagementType', c.engagementType, true, engagementTypeMap),
    enumColumn('status', c.status, false, statusMap),
    textColumn('date', 'startDate', c.startDate, true),
    textColumn('date', 'dueDate', c.dueDate, true),
  ]
}

async function tasksColumns(): Promise<ImportColumnDef[]> {
  const c = ar.import.columns.tasks
  const [categories, priorityLabels] = await Promise.all([
    getSetting('tasks.categories'),
    getSetting('labels.priority'),
  ])

  const categoryMap = new Map(categories.map((entry) => [entry.id, entry.label]))
  const priorityMap = new Map(Object.entries(priorityLabels))
  const categorySample = categories[0]?.label ?? ''

  return [
    textColumn('text', 'projectCode', c.projectCode, true),
    textColumn('text', 'title', c.title, true),
    textColumn('text', 'description', c.description, false),
    enumColumn(
      'categoryLabel',
      { ...c.categoryLabel, sample: categorySample },
      true,
      categoryMap,
    ),
    enumColumn('priority', c.priority, false, priorityMap),
    textColumn('text', 'assigneeUsername', c.assigneeUsername, false),
    textColumn('date', 'dueDate', c.dueDate, true),
    textColumn('number', 'estimatedHours', c.estimatedHours, false),
    textColumn('money', 'taskValue', c.taskValue, false),
  ]
}

/** The live column set for an entity — Settings-dependent columns are resolved fresh every call. */
export async function importColumns(entity: ImportEntity): Promise<ImportColumnDef[]> {
  switch (entity) {
    case 'users':
      return usersColumns()
    case 'clients':
      return clientsColumns()
    case 'projects':
      return projectsColumns()
    case 'tasks':
      return tasksColumns()
  }
}
