import { recordAudit } from '@/lib/audit'
import {
  cairoDateKey,
  cairoDaysBetweenKeys,
  dateColumnValue,
  type CairoDateKey,
} from '@/lib/calendar'
import type { Db } from '@/lib/db'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import type { Actor } from '@/lib/rbac'

import type { DecideLeaveInput, ListLeaveInput, RequestLeaveInput } from './schema'
import type { LeaveDto, LeavePageDto, LeaveWarningDto } from './types'

/**
 * modules/leave/service.ts — SPEC §4 Calendar, `Leave`.
 *
 * Approved leave is the third thing `lib/calendar` subtracts, after weekends
 * and holidays, and SPEC §5.3 is unambiguous: "Approved leave never generates
 * lateness." Which makes an approval here a money decision, and every one of
 * them writes an audit row (CLAUDE.md invariant 7).
 *
 * ── Only APPROVED counts ──────────────────────────────────────────────────
 *
 * `prismaCalendarSource` filters on `status: 'APPROVED'`, so a PENDING request
 * changes nothing about anyone's deduction until somebody with `leave.manage`
 * says so, and a REJECTED one never does. That is the whole point of the
 * status column, and it is asserted in
 * `tests/integration/leave/leave.test.ts` rather than left to inspection.
 *
 * ── Overlap is a conflict, not a merge ────────────────────────────────────
 *
 * Two overlapping leave rows for one person are always an error of entry: the
 * days are already covered. Merging them would quietly change the type or the
 * note on days somebody already approved, so the second one is refused. Only
 * PENDING and APPROVED rows block — a rejected request is not a claim on
 * anything.
 */

const PERSON_SELECT = { id: true, fullName: true, username: true } as const

const LEAVE_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  typeId: true,
  status: true,
  note: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  user: { select: PERSON_SELECT },
  requestedBy: { select: PERSON_SELECT },
  decidedBy: { select: PERSON_SELECT },
} as const

type Person = { id: string; fullName: string; username: string }

interface LeaveRow {
  id: string
  startDate: Date
  endDate: Date
  typeId: string
  status: string
  note: string | null
  decidedAt: Date | null
  decisionNote: string | null
  createdAt: Date
  user: Person
  requestedBy: Person
  decidedBy: Person | null
}

/** `@db.Date` is UTC midnight — the key is the UTC date, never re-zoned. */
const key = (value: Date): CairoDateKey => value.toISOString().slice(0, 10)

function toDto(row: LeaveRow): LeaveDto {
  const startDate = key(row.startDate)
  const endDate = key(row.endDate)
  return {
    id: row.id,
    user: row.user,
    startDate,
    endDate,
    totalDays: cairoDaysBetweenKeys(startDate, endDate) + 1,
    typeId: row.typeId,
    status: row.status as LeaveDto['status'],
    note: row.note,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
  }
}

/** Inclusive ranges overlap when neither ends before the other begins. */
export function rangesOverlap(
  aStart: CairoDateKey,
  aEnd: CairoDateKey,
  bStart: CairoDateKey,
  bEnd: CairoDateKey,
): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

/** Statuses that hold a claim on a day. A rejected request holds none. */
const BLOCKING_STATUSES = ['PENDING', 'APPROVED'] as const

export interface OverlapArgs {
  userId: string
  startDate: CairoDateKey
  endDate: CairoDateKey
  excludeId?: string
  /** Narrow to APPROVED only — what an approval decision re-checks against. */
  statuses?: readonly ('PENDING' | 'APPROVED')[]
}

export async function findOverlappingLeave(
  db: Db,
  args: OverlapArgs,
): Promise<LeaveDto | null> {
  const row = await db.leave.findFirst({
    where: {
      userId: args.userId,
      status: { in: [...(args.statuses ?? BLOCKING_STATUSES)] },
      ...(args.excludeId ? { NOT: { id: args.excludeId } } : {}),
      startDate: { lte: dateColumnValue(args.endDate) },
      endDate: { gte: dateColumnValue(args.startDate) },
    },
    select: LEAVE_SELECT,
    orderBy: { startDate: 'asc' },
  })

  return row ? toDto(row as LeaveRow) : null
}

export type LeaveTypeOption = { id: string }

function assertLeaveType(typeId: string, types: readonly LeaveTypeOption[]): void {
  if (!types.some((t) => t.id === typeId)) {
    throw new DomainError('leave.errors.unknownType', { typeId })
  }
}

export interface LeaveMutationArgs {
  actor: Actor
  ip?: string | undefined
  now?: Date | undefined
}

const nowOf = (args: LeaveMutationArgs): Date => args.now ?? new Date()

export interface RequestLeaveArgs extends LeaveMutationArgs {
  input: RequestLeaveInput
  /** Settings `calendar.leaveTypes`, passed in by the caller. */
  leaveTypes: readonly LeaveTypeOption[]
  /**
   * A `leave.manage` holder *recording* leave rather than requesting it —
   * "أحمد was out sick and المدير logged it". One row, already APPROVED, with
   * the same person as requester and decider so the audit trail says exactly
   * what happened.
   */
  autoApprove?: boolean
}

export async function requestLeave(db: Db, args: RequestLeaveArgs): Promise<LeaveDto> {
  const { input } = args
  const now = nowOf(args)

  assertLeaveType(input.typeId, args.leaveTypes)

  const subject = await db.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true, isActive: true },
  })
  if (!subject) throw new NotFoundError('User', input.userId)
  if (!subject.isActive) {
    throw new DomainError('leave.errors.subjectInactive', { userId: input.userId })
  }

  const clash = await findOverlappingLeave(db, {
    userId: input.userId,
    startDate: input.startDate,
    endDate: input.endDate,
  })
  if (clash) {
    throw new ConflictError('leave.errors.overlap', {
      leaveId: clash.id,
      startDate: clash.startDate,
      endDate: clash.endDate,
    })
  }

  const approved = args.autoApprove === true

  const row = await db.leave.create({
    data: {
      userId: input.userId,
      startDate: dateColumnValue(input.startDate),
      endDate: dateColumnValue(input.endDate),
      typeId: input.typeId,
      note: input.note,
      status: approved ? 'APPROVED' : 'PENDING',
      requestedById: args.actor.id,
      ...(approved ? { decidedById: args.actor.id, decidedAt: now } : {}),
    },
    select: LEAVE_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: approved ? 'leave.recorded' : 'leave.requested',
    entity: 'Leave',
    entityId: row.id,
    after: {
      userId: input.userId,
      startDate: input.startDate,
      endDate: input.endDate,
      typeId: input.typeId,
      status: approved ? 'APPROVED' : 'PENDING',
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toDto(row as LeaveRow)
}

export async function decideLeave(
  db: Db,
  args: LeaveMutationArgs & { input: DecideLeaveInput },
): Promise<LeaveDto> {
  const { input } = args
  const now = nowOf(args)

  const before = await db.leave.findUnique({
    where: { id: input.id },
    select: LEAVE_SELECT,
  })
  if (!before) throw new NotFoundError('Leave', input.id)
  if (before.status !== 'PENDING') {
    throw new ConflictError('leave.errors.alreadyDecided', {
      leaveId: input.id,
      status: before.status,
    })
  }

  const dto = toDto(before as LeaveRow)

  // Re-check on approval, not only on request: two requests can sit PENDING
  // over the same days, and approving the second one would hand the calendar
  // two overlapping claims. Rejection needs no check — it claims nothing.
  if (input.decision === 'APPROVED') {
    const clash = await findOverlappingLeave(db, {
      userId: dto.user.id,
      startDate: dto.startDate,
      endDate: dto.endDate,
      excludeId: dto.id,
      statuses: ['APPROVED'],
    })
    if (clash) {
      throw new ConflictError('leave.errors.overlap', {
        leaveId: clash.id,
        startDate: clash.startDate,
        endDate: clash.endDate,
      })
    }
  }

  const row = await db.leave.update({
    where: { id: input.id },
    data: {
      status: input.decision,
      decidedById: args.actor.id,
      decidedAt: now,
      decisionNote: input.decisionNote,
    },
    select: LEAVE_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: input.decision === 'APPROVED' ? 'leave.approved' : 'leave.rejected',
    entity: 'Leave',
    entityId: row.id,
    before: { status: before.status },
    after: {
      status: input.decision,
      userId: dto.user.id,
      startDate: dto.startDate,
      endDate: dto.endDate,
    },
    ...(input.decisionNote ? { reason: input.decisionNote } : {}),
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toDto(row as LeaveRow)
}

export interface ListLeaveArgs {
  filters: ListLeaveInput
  /** RBAC narrowing from `queries.ts` — `{}` for `leave.view`, own id otherwise. */
  scope: Record<string, unknown>
}

export async function listLeave(db: Db, args: ListLeaveArgs): Promise<LeavePageDto> {
  const { filters } = args

  const where = {
    ...args.scope,
    ...(filters.userId?.length ? { userId: { in: filters.userId } } : {}),
    ...(filters.status?.length ? { status: { in: filters.status } } : {}),
    // Overlap, not containment: a leave that starts before the window and ends
    // inside it is very much in the window.
    ...(filters.to ? { startDate: { lte: dateColumnValue(filters.to) } } : {}),
    ...(filters.from ? { endDate: { gte: dateColumnValue(filters.from) } } : {}),
  }

  const [total, rows] = await Promise.all([
    db.leave.count({ where }),
    db.leave.findMany({
      where,
      select: LEAVE_SELECT,
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ])

  return {
    items: rows.map((row) => toDto(row as LeaveRow)),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export async function getLeave(db: Db, id: string): Promise<LeaveDto> {
  const row = await db.leave.findUnique({ where: { id }, select: LEAVE_SELECT })
  if (!row) throw new NotFoundError('Leave', id)
  return toDto(row as LeaveRow)
}

/**
 * Approved leave overlapping a task's live window — the assignment warning.
 *
 * The window runs from "now" to the deadline, because that is the span the
 * منفّذ actually has to do the work in. Leave that ended yesterday is not a
 * problem; leave that starts the day before the deadline is.
 */
export async function leaveWarningsForWindow(
  db: Db,
  args: { userId: string; from: Date; to: Date },
): Promise<LeaveWarningDto[]> {
  const fromKey = cairoDateKey(args.from)
  const toKey = cairoDateKey(args.to)
  if (fromKey > toKey) return []

  const rows = await db.leave.findMany({
    where: {
      userId: args.userId,
      status: 'APPROVED',
      startDate: { lte: dateColumnValue(toKey) },
      endDate: { gte: dateColumnValue(fromKey) },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      typeId: true,
      user: { select: { id: true, fullName: true } },
    },
    orderBy: { startDate: 'asc' },
  })

  return rows.map((row) => ({
    leaveId: row.id,
    userId: row.user.id,
    userFullName: row.user.fullName,
    startDate: key(row.startDate),
    endDate: key(row.endDate),
    typeId: row.typeId,
  }))
}
