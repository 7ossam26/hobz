import { recordAudit } from '@/lib/audit'
import type { Db } from '@/lib/db'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import type { Actor } from '@/lib/rbac'
import { noopPenaltyPort, type PenaltyPort } from '@/modules/lateness/ports'
import type { TaskStatus } from '@/modules/task/state-machine'

import { noopExtensionEvents, type ExtensionEventBus } from './ports'
import type {
  DecideExtensionInput,
  ListExtensionsInput,
  RequestExtensionInput,
} from './schema'
import type { ExtensionPageDto, ExtensionRequestDto } from './types'

/**
 * modules/extension/service.ts — SPEC §4 `ExtensionRequest`, SPEC §5.3.
 *
 *   > An **approved extension** moves `dueDate`, keeps `originalDueDate`, and
 *   > voids/recomputes any penalty accrued past the new date.
 *
 * All three halves of that sentence are here. The first two are writes on the
 * task; the third is a command handed to `PenaltyPort`, which Phase 8
 * implements — with the request recorded in the audit log *before* the port
 * call, so nothing raised while the port is dark can evaporate.
 *
 * ── Why `oldDueDate` is load-bearing ──────────────────────────────────────
 *
 * SPEC §4 lists it and it is easy to read as decoration. It is the optimistic
 * concurrency check: between a منفّذ asking for Thursday and a manager
 * approving it, the deadline can move on its own — a revision sets a new due
 * date (SPEC T4), or another extension lands first. Approving a request whose
 * `oldDueDate` no longer matches would silently overwrite the newer decision
 * with a stale one, so it is refused and a fresh request is asked for.
 *
 * ── An extension is for work still in flight ──────────────────────────────
 *
 * Extending a task that has already been delivered would move a line the
 * منفّذ has already crossed — which is not an extension, it is a retroactive
 * pardon. Those exist in this product too, and they are called reversals
 * (`penalty.reverse`, SPEC §5.4), which is a different permission and a
 * different audit trail on purpose.
 */

const PERSON_SELECT = { id: true, fullName: true, username: true } as const

const EXTENSION_SELECT = {
  id: true,
  taskId: true,
  oldDueDate: true,
  newDueDate: true,
  reason: true,
  status: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  requestedBy: { select: PERSON_SELECT },
  decidedBy: { select: PERSON_SELECT },
  task: { select: { title: true } },
} as const

type Person = { id: string; fullName: string; username: string }

interface ExtensionRow {
  id: string
  taskId: string
  oldDueDate: Date
  newDueDate: Date
  reason: string
  status: string
  decidedAt: Date | null
  decisionNote: string | null
  createdAt: Date
  requestedBy: Person
  decidedBy: Person | null
  task: { title: string }
}

function toDto(row: ExtensionRow): ExtensionRequestDto {
  return {
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.task.title,
    requestedBy: row.requestedBy,
    oldDueDate: row.oldDueDate,
    newDueDate: row.newDueDate,
    reason: row.reason,
    status: row.status as ExtensionRequestDto['status'],
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
  }
}

/** A task whose deadline still means something for the منفّذ. */
const EXTENDABLE_STATUSES: readonly TaskStatus[] = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'REVISION_REQUESTED',
  'BLOCKED',
]

const ALIVE = { deletedAt: null, project: { deletedAt: null } } as const

async function loadTask(db: Db, id: string) {
  const task = await db.task.findFirst({
    where: { id, ...ALIVE },
    select: {
      id: true,
      projectId: true,
      title: true,
      status: true,
      assigneeId: true,
      dueDate: true,
      originalDueDate: true,
    },
  })
  if (!task) throw new NotFoundError('Task', id)
  return task
}

export interface ExtensionMutationArgs {
  actor: Actor
  ip?: string | undefined
  now?: Date | undefined
}

const nowOf = (args: ExtensionMutationArgs): Date => args.now ?? new Date()

export interface RequestExtensionArgs extends ExtensionMutationArgs {
  input: RequestExtensionInput
  /**
   * True when the actor holds `task.extend` and may therefore raise a request
   * for somebody else's task. Without it the requester must be the assignee —
   * the phase brief's "assignee requests with a reason".
   */
  mayRequestForOthers?: boolean
  events?: ExtensionEventBus
}

export async function requestExtension(
  db: Db,
  args: RequestExtensionArgs,
): Promise<ExtensionRequestDto> {
  const { input } = args
  const now = nowOf(args)
  const events = args.events ?? noopExtensionEvents

  const task = await loadTask(db, input.taskId)

  if (!EXTENDABLE_STATUSES.includes(task.status as TaskStatus)) {
    throw new DomainError('extensions.errors.taskDelivered', {
      taskId: task.id,
      status: task.status,
    })
  }

  if (args.mayRequestForOthers !== true && task.assigneeId !== args.actor.id) {
    throw new DomainError('extensions.errors.notAssignee', { taskId: task.id })
  }

  if (input.newDueDate.getTime() <= task.dueDate.getTime()) {
    throw new DomainError('extensions.errors.notLater', {
      taskId: task.id,
      dueDate: task.dueDate,
      newDueDate: input.newDueDate,
    })
  }

  const pending = await db.extensionRequest.findFirst({
    where: { taskId: task.id, status: 'PENDING' },
    select: { id: true },
  })
  if (pending) {
    throw new ConflictError('extensions.errors.alreadyPending', {
      taskId: task.id,
      extensionId: pending.id,
    })
  }

  const row = await db.extensionRequest.create({
    data: {
      taskId: task.id,
      requestedById: args.actor.id,
      oldDueDate: task.dueDate,
      newDueDate: input.newDueDate,
      reason: input.reason,
      createdAt: now,
    },
    select: EXTENSION_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'extension.requested',
    entity: 'ExtensionRequest',
    entityId: row.id,
    after: {
      taskId: task.id,
      oldDueDate: task.dueDate,
      newDueDate: input.newDueDate,
    },
    reason: input.reason,
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await events.emit(db, {
    type: 'ExtensionRequested',
    extensionId: row.id,
    taskId: task.id,
    taskTitle: task.title,
    requestedById: args.actor.id,
    oldDueDate: task.dueDate,
    newDueDate: input.newDueDate,
    reason: input.reason,
    at: now,
  })

  return toDto(row as ExtensionRow)
}

export interface DecideExtensionArgs extends ExtensionMutationArgs {
  input: DecideExtensionInput
  /** Where the "this deduction is now wrong" command goes. Phase 8 replaces it. */
  penalty?: PenaltyPort
  events?: ExtensionEventBus
}

export async function decideExtension(
  db: Db,
  args: DecideExtensionArgs,
): Promise<ExtensionRequestDto> {
  const { input } = args
  const now = nowOf(args)
  const penalty = args.penalty ?? noopPenaltyPort
  const events = args.events ?? noopExtensionEvents

  const before = await db.extensionRequest.findUnique({
    where: { id: input.id },
    select: EXTENSION_SELECT,
  })
  if (!before) throw new NotFoundError('ExtensionRequest', input.id)
  if (before.status !== 'PENDING') {
    throw new ConflictError('extensions.errors.alreadyDecided', {
      extensionId: input.id,
      status: before.status,
    })
  }

  const task = await loadTask(db, before.taskId)
  const approving = input.decision === 'APPROVED'

  if (approving && task.dueDate.getTime() !== before.oldDueDate.getTime()) {
    throw new ConflictError('extensions.errors.stale', {
      extensionId: input.id,
      expected: before.oldDueDate,
      actual: task.dueDate,
    })
  }

  const row = await db.extensionRequest.update({
    where: { id: input.id },
    data: {
      status: input.decision,
      decidedById: args.actor.id,
      decidedAt: now,
      decisionNote: input.decisionNote,
    },
    select: EXTENSION_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: approving ? 'extension.approved' : 'extension.rejected',
    entity: 'ExtensionRequest',
    entityId: row.id,
    before: { status: 'PENDING', dueDate: task.dueDate },
    after: { status: input.decision, newDueDate: before.newDueDate },
    ...(input.decisionNote ? { reason: input.decisionNote } : {}),
    ...(args.ip ? { ip: args.ip } : {}),
  })

  if (!approving) {
    await events.emit(db, {
      type: 'ExtensionDecided',
      extensionId: row.id,
      taskId: task.id,
      taskTitle: task.title,
      requestedById: before.requestedBy.id,
      decision: 'REJECTED',
      newDueDate: before.newDueDate,
      decidedById: args.actor.id,
      at: now,
    })
    return toDto(row as ExtensionRow)
  }

  // SPEC §5.3: the extension moves `dueDate` and leaves `originalDueDate`
  // exactly where it was. That column is the only surviving record of what was
  // first promised, and every "was this ever on time" question reads it.
  await db.task.update({
    where: { id: task.id },
    data: { dueDate: before.newDueDate },
  })

  await db.taskActivity.create({
    data: {
      taskId: task.id,
      actorId: args.actor.id,
      type: 'DUE_DATE_CHANGED',
      from: task.dueDate.toISOString(),
      to: before.newDueDate.toISOString(),
      createdAt: now,
    },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'task.dueDateExtended',
    entity: 'Task',
    entityId: task.id,
    before: { dueDate: task.dueDate },
    after: {
      dueDate: before.newDueDate,
      originalDueDate: task.originalDueDate,
      extensionId: row.id,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  // Written *before* the port call, for the reason Phase 4 recorded on
  // `task.partialPaymentIntent`: `noopPenaltyPort` is today's implementation,
  // and without this row the instruction would exist nowhere until Phase 8.
  await recordAudit(db, {
    actor: args.actor,
    action: 'extension.penaltyRecomputeRequested',
    entity: 'Task',
    entityId: task.id,
    after: { cause: 'extensionApproved', extensionId: row.id },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await penalty.recompute(db, {
    taskId: task.id,
    cause: 'extensionApproved',
    at: now,
    requestedById: args.actor.id,
  })

  await events.emit(db, {
    type: 'ExtensionDecided',
    extensionId: row.id,
    taskId: task.id,
    taskTitle: task.title,
    requestedById: before.requestedBy.id,
    decision: 'APPROVED',
    newDueDate: before.newDueDate,
    decidedById: args.actor.id,
    at: now,
  })

  return toDto(row as ExtensionRow)
}

export interface ListExtensionsArgs {
  filters: ListExtensionsInput
  /** RBAC narrowing on the parent task, from `queries.ts`. */
  taskScope: Record<string, unknown>
}

export async function listExtensions(
  db: Db,
  args: ListExtensionsArgs,
): Promise<ExtensionPageDto> {
  const { filters } = args

  const where = {
    task: { ...ALIVE, ...args.taskScope },
    ...(filters.taskId ? { taskId: filters.taskId } : {}),
    ...(filters.status?.length ? { status: { in: filters.status } } : {}),
  }

  const [total, rows] = await Promise.all([
    db.extensionRequest.count({ where }),
    db.extensionRequest.findMany({
      where,
      select: EXTENSION_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ])

  return {
    items: rows.map((row) => toDto(row as ExtensionRow)),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}
