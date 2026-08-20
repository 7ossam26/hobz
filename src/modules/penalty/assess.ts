import type { Prisma } from '@prisma/client'

import type { Calendar } from '@/lib/calendar'
import type { Db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import { blockedIntervalsFromActivity } from '@/modules/lateness/blocked'
import { computeLateness, type LatenessResult } from '@/modules/lateness/service'
import type { PayProfile } from '@/modules/ledger/pay-profile'
import type { TaskStatus } from '@/modules/task/state-machine'

import { payBasesFor, type PayBases } from './basis'
import { buildBreakdown } from './breakdown'
import { calculatePenalty, type PenaltyCalculation } from './calculate'
import type { PenaltyMode } from './mode'
import {
  resolveGraceHours,
  resolvePenalizeRevisionLateness,
  resolvePenaltyProfile,
  type ResolvedPenaltyProfile,
} from './profile'
import { revisionCount, revisionRoundsFromActivity, type RevisionRounds } from './rounds'
import type { PenaltyBreakdownDto } from './types'

/**
 * modules/penalty/assess — "what should this task's deduction be, right now".
 *
 * Read-only. It answers the question; `service.ts` decides what to write. That
 * split is what lets the task sheet render a live breakdown for a manager
 * without the act of *looking* at a penalty inserting one.
 *
 * Everything it needs arrives from three places that already own their
 * respective facts, and it re-derives none of them:
 *
 *  - `modules/lateness` — `lateWorkingDays`, already net of grace, weekends,
 *    holidays, approved leave and BLOCKED stretches (SPEC §5.3).
 *  - `modules/ledger/pay-profile` — `dailyRate`, `isSalaried`, `earnsPerTask`.
 *  - Settings, injected by the caller (CLAUDE.md invariant 4).
 */

/**
 * One query for everything a deduction depends on.
 *
 * The `activity` filter deliberately widens `LATENESS_TASK_SELECT`'s rather
 * than sitting beside it: Prisma allows one selection per relation, and two
 * queries over the same feed could return two different views of it. The extra
 * `REVISION_REQUESTED` rows are invisible to `blockedIntervalsFromActivity`,
 * which only pairs `→ BLOCKED` with `BLOCKED →`, so both readers get exactly
 * what they asked for out of one round trip.
 */
export const PENALTY_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  taskValue: true,
  dueDate: true,
  originalDueDate: true,
  submittedAt: true,
  assigneeId: true,
  project: {
    select: { id: true, gracePeriodHours: true, penalizeRevisionLateness: true },
  },
  assignee: {
    select: {
      id: true,
      fullName: true,
      deletedAt: true,
      payType: true,
      monthlySalary: true,
      defaultTaskRate: true,
      penaltyProfile: {
        select: {
          id: true,
          name: true,
          mode: true,
          value: true,
          graceHours: true,
          deletedAt: true,
        },
      },
    },
  },
  activity: {
    where: {
      type: 'STATUS_CHANGED',
      OR: [{ to: 'BLOCKED' }, { from: 'BLOCKED' }, { to: 'REVISION_REQUESTED' }],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { type: true, from: true, to: true, createdAt: true },
  },
  // `satisfies`, not `as const`: the nested `where`/`orderBy` need Prisma's own
  // contextual types to narrow `'asc'` to `SortOrder`.
} satisfies Prisma.TaskSelect

type DecimalLike = { toFixed(dp: number): string }

export interface PenaltyTaskRow {
  id: string
  title: string
  status: string
  taskValue: DecimalLike
  dueDate: Date
  originalDueDate: Date
  submittedAt: Date | null
  assigneeId: string | null
  project: {
    id: string
    gracePeriodHours: number | null
    penalizeRevisionLateness: boolean | null
  }
  assignee: {
    id: string
    fullName: string
    deletedAt: Date | null
    payType: string
    monthlySalary: DecimalLike | null
    defaultTaskRate: DecimalLike | null
    penaltyProfile: {
      id: string
      name: string
      mode: string
      value: DecimalLike
      graceHours: number | null
      deletedAt: Date | null
    } | null
  } | null
  activity: ReadonlyArray<{
    type: string
    from: string | null
    to: string | null
    createdAt: Date
  }>
}

/** The Settings this module reads, injected rather than fetched. */
export interface PenaltySettings {
  defaultMode: PenaltyMode
  defaultValue: number
  defaultGraceHours: number
  penalizeRevisionLateness: boolean
  workingDaysPerMonth: number
}

export type PenaltySkipReason =
  'no-assignee' | 'no-basis' | 'not-penalisable' | 'assignee-deleted'

export interface PenaltyAssessment {
  taskId: string
  taskTitle: string
  /** The منفّذ who would be charged. Null when nobody is accountable. */
  userId: string | null
  lateness: LatenessResult
  calculation: PenaltyCalculation
  profile: ResolvedPenaltyProfile
  rounds: RevisionRounds
  /** Which delivery is live: 0 = the original, n = the n-th revision. */
  roundIndex: number
  revisionCount: number
  penalizeRevisionLateness: boolean
  /** True when SPEC T4's flag is off and this task is past its first delivery. */
  suppressedByRevisionPolicy: boolean
  /** Null unless a deduction is actually owed. */
  breakdown: PenaltyBreakdownDto | null
  /** What the ledger should hold for the *current round*. `0.00` means none. */
  target: string
  skipReason: PenaltySkipReason | null
}

const NOTHING = '0.00'

/** Statuses whose deduction can still move. DONE and CANCELLED are settled by
 *  the transition that put them there, which is on the same recompute path. */
export const PENALTY_STATUSES: readonly TaskStatus[] = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'REVISION_REQUESTED',
  'APPROVED',
  'BLOCKED',
]

export interface AssessArgs {
  calendar: Calendar
  settings: PenaltySettings
  now: Date
}

export function assessPenaltyForRow(
  row: PenaltyTaskRow,
  args: AssessArgs,
): Promise<PenaltyAssessment> {
  return assess(row, args)
}

async function assess(row: PenaltyTaskRow, args: AssessArgs): Promise<PenaltyAssessment> {
  const { settings, now } = args

  const rounds = revisionRoundsFromActivity(row.activity)
  const revisions = revisionCount(rounds)
  const profile = resolvePenaltyProfile(
    // A soft-deleted profile is not applied. Somebody removed that formula from
    // the UI, and quietly keeping it in force would be a deduction computed by
    // a rule nobody can find any more — the organization default is the honest
    // fallback, and `deletePenaltyProfile` detaches its members anyway.
    row.assignee?.penaltyProfile && row.assignee.penaltyProfile.deletedAt === null
      ? row.assignee.penaltyProfile
      : null,
    {
      mode: settings.defaultMode,
      value: settings.defaultValue,
      graceHours: settings.defaultGraceHours,
    },
  )

  const graceHours = resolveGraceHours({
    projectOverride: row.project.gracePeriodHours,
    profileOverride: profile.graceHours,
    globalDefault: settings.defaultGraceHours,
  })

  const lateness = await computeLateness(args.calendar, {
    task: {
      id: row.id,
      status: row.status as TaskStatus,
      dueDate: row.dueDate,
      originalDueDate: row.originalDueDate,
      submittedAt: row.submittedAt,
      assigneeId: row.assigneeId,
      blockedIntervals: blockedIntervalsFromActivity(row.activity),
    },
    graceHours,
    now,
  })

  const penalizeRevisions = resolvePenalizeRevisionLateness(
    row.project.penalizeRevisionLateness,
    settings.penalizeRevisionLateness,
  )
  const suppressed = revisions > 0 && !penalizeRevisions

  const payProfile: PayProfile | null = row.assignee
    ? {
        payType: row.assignee.payType as PayProfile['payType'],
        monthlySalary: row.assignee.monthlySalary,
        defaultTaskRate: row.assignee.defaultTaskRate,
      }
    : null

  // `payBasesFor` carries the daily rate's derivation beside the rate itself,
  // so spreading `bases` cannot separate the two (see `basis.ts`).
  const bases: PayBases = payProfile
    ? payBasesFor(payProfile, row.taskValue.toFixed(2), settings.workingDaysPerMonth)
    : { taskValue: null, dailyRate: null, dailyRateDerivation: null }

  const calculation = calculatePenalty({
    mode: profile.mode,
    value: profile.value,
    // SPEC T4 with the flag off: the revision does not accrue. Zeroing the day
    // count rather than short-circuiting keeps one code path, and keeps the
    // breakdown truthful — it still shows the deadline and the formula that
    // *would* have applied, with `NOT_LATE` as the answer.
    lateWorkingDays: suppressed ? 0 : lateness.lateWorkingDays,
    ...bases,
  })

  const skipReason = resolveSkipReason(row, calculation)
  const chargeable = calculation.status === 'DUE' && skipReason === null

  const breakdown = buildBreakdown({
    taskId: row.id,
    taskTitle: row.title,
    lateness,
    calculation,
    profile,
    roundIndex: revisions,
    revisionCount: revisions,
  })

  return {
    taskId: row.id,
    taskTitle: row.title,
    userId: row.assigneeId,
    lateness,
    calculation,
    profile,
    rounds,
    roundIndex: revisions,
    revisionCount: revisions,
    penalizeRevisionLateness: penalizeRevisions,
    suppressedByRevisionPolicy: suppressed,
    breakdown: chargeable ? breakdown : null,
    target: chargeable ? calculation.amount : NOTHING,
    skipReason,
  }
}

/**
 * Why a deduction that the arithmetic says is owed is nevertheless not charged.
 *
 * Every one of these writes an audit row at the call site rather than passing
 * silently, for the reason `modules/ledger/earnings` gives for its own skip
 * reasons: "why did nobody get charged for this" must be answerable a month
 * later, and silence is the one answer that never is.
 *
 * Note the order: a missing basis is only reported once there is somebody to
 * charge. Telling an operator to fix a pay profile for an unassigned task would
 * send them to the wrong screen.
 */
function resolveSkipReason(
  row: PenaltyTaskRow,
  calculation: PenaltyCalculation,
): PenaltySkipReason | null {
  if (!row.assigneeId || !row.assignee) return 'no-assignee'
  if (row.assignee.deletedAt !== null) return 'assignee-deleted'
  if (calculation.status === 'NO_BASIS') return 'no-basis'
  return null
}

export interface AssessTaskArgs extends AssessArgs {
  taskId: string
}

/** One task, read through the same soft-delete guard everything else uses. */
export async function assessTaskPenalty(
  db: Db,
  args: AssessTaskArgs,
): Promise<PenaltyAssessment> {
  const row = await db.task.findFirst({
    where: { id: args.taskId, deletedAt: null, project: { deletedAt: null } },
    select: PENALTY_TASK_SELECT,
  })
  if (!row) throw new NotFoundError('Task', args.taskId)

  return assess(row as unknown as PenaltyTaskRow, args)
}
