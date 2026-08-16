import { ar } from '@/i18n/ar'
import { tryAdvisoryXactLock } from '@/lib/advisory-lock'
import { recordAudit, type AuditActorRef } from '@/lib/audit'
import type { Calendar } from '@/lib/calendar'
import type { Db } from '@/lib/db'
import { AppError, DomainError, NotFoundError } from '@/lib/errors'
import { abs, eq, toMoney, toStorageString, type MoneyInput } from '@/lib/money'
import { appendEntry, recordBonus, reverseEntry } from '@/modules/ledger/service'
import { signedAmountFor } from '@/modules/ledger/sign'

import {
  assessPenaltyForRow,
  PENALTY_TASK_SELECT,
  type PenaltyAssessment,
  type PenaltySettings,
  type PenaltyTaskRow,
} from './assess'
import { penaltyNote, recalculationNote } from './breakdown'
import { noopMoneyEvents, type MoneyEventBus } from './ports'
import { currentRoundStart } from './rounds'
import type { PenaltyRecomputeResult } from './types'

/**
 * modules/penalty/service — SPEC §5.4's engine.
 *
 *   > **Idempotent:** exactly one active auto `PENALTY` entry per task.
 *   > Recalculation = insert `REVERSAL` + insert new `PENALTY`. Never `UPDATE`.
 *
 * ── What makes running this ten times produce one deduction ───────────────
 *
 * Not a "have I run today" flag, and not a lock. Both would be defeated by the
 * thing that actually happens in production — a redeploy mid-run, a manual
 * recalculation, a status change at 03:00:01 — and CLAUDE.md invariant 6 asks
 * for something stronger than "usually".
 *
 * What makes it idempotent is that **the target is a pure function of data this
 * service did not write**: the due date, the grace, the calendar, the pay
 * profile and the Settings. The service compares that target with what the
 * ledger already holds and writes *only on a difference*. A second run computes
 * the same target, finds it already there, and writes nothing at all — no
 * reversal, no replacement, no audit noise. Ten runs produce one entry and zero
 * reversals, which is a stronger claim than "one net penalty" and is what
 * `tests/integration/penalty/idempotency.test.ts` asserts.
 *
 * The freeze SPEC §5.4 asks for ("frozen the moment the task reaches
 * SUBMITTED") therefore needs no code here either: `modules/lateness` stops the
 * clock at `submittedAt`, so the target stops moving and every later run is the
 * no-op above.
 *
 * ── What is never done ────────────────────────────────────────────────────
 *
 * No `UPDATE`. Not as a rule this file follows — as one the database enforces,
 * since Phase 7's `ledger_entries_no_update` trigger rejects it outright. A
 * correction is a `REVERSAL` and then a fresh `PENALTY`, in that order, so a
 * crash between the two leaves a منفّذ un-charged rather than double-charged.
 */

/** Namespaced so a task id can never collide with a job name's lock key. */
const TASK_LOCK_PREFIX = 'penalty.task:'

/**
 * A per-task transaction advisory lock.
 *
 * docs/TESTING.md §4 axis 6 names the case: "scheduler firing while a manual
 * recalculation runs". The unique index on `reversesEntryId` already stops two
 * writers reversing the same entry, but it says nothing about the case where
 * there is no entry yet and both writers insert a *first* penalty. This closes
 * that, and closes it where it belongs — around the read *and* the write.
 *
 * `try`, not a blocking wait: a caller who cannot get the lock is told
 * `'locked'` and stops. That is the correct outcome rather than an error,
 * because whoever holds the lock is computing the same target from the same
 * data and will write the same answer.
 *
 * Transaction-scoped for the reason `lib/scheduler` documents: Prisma pools
 * connections, so a session-level lock could be taken on one connection and
 * released on another. It follows that this only protects callers who are
 * inside a transaction — which every production path here is, because every
 * ledger write is paired with an audit row that must commit with it.
 */
async function tryLockTask(db: Db, taskId: string): Promise<boolean> {
  return tryAdvisoryXactLock(db, `${TASK_LOCK_PREFIX}${taskId}`)
}

/** Why this recomputation was owed. Carried into the REVERSAL's own note. */
export type PenaltyCause = 'extensionApproved' | 'statusChanged' | 'scheduled' | 'manual'

export interface RecomputeTaskPenaltyArgs {
  taskId: string
  calendar: Calendar
  settings: PenaltySettings
  /** Settings `payout.cycleDay`, for the entry's cycle attribution. */
  cycleDay: number
  cause: PenaltyCause
  now: Date
  /** The person whose decision triggered it. Null for the scheduler. */
  actor: AuditActorRef | null
  events?: MoneyEventBus
  ip?: string
}

const NOTHING = '0.00'

const result = (
  taskId: string,
  over: Partial<PenaltyRecomputeResult>,
): PenaltyRecomputeResult => ({
  taskId,
  outcome: 'none',
  skipReason: null,
  reversedEntryId: null,
  entryId: null,
  amount: NOTHING,
  breakdown: null,
  ...over,
})

/**
 * Bring one task's automatic deduction in line with what SPEC §5.4 says it
 * should be. The only function that writes an automatic `PENALTY`.
 */
export async function recomputeTaskPenalty(
  db: Db,
  args: RecomputeTaskPenaltyArgs,
): Promise<PenaltyRecomputeResult> {
  const events = args.events ?? noopMoneyEvents

  if (!(await tryLockTask(db, args.taskId))) {
    return result(args.taskId, { outcome: 'locked' })
  }

  const row = (await db.task.findFirst({
    where: { id: args.taskId, deletedAt: null, project: { deletedAt: null } },
    select: PENALTY_TASK_SELECT,
  })) as unknown as PenaltyTaskRow | null
  if (!row) throw new NotFoundError('Task', args.taskId)

  const assessment = await assessPenaltyForRow(row, {
    calendar: args.calendar,
    settings: args.settings,
    now: args.now,
  })

  const actives = await findActiveAutoPenalties(db, args.taskId, assessment)

  /**
   * A skip is **not** a clear.
   *
   * When the inputs to a deduction become unreadable — the assignee left, the
   * task lost its value, nobody is accountable any more — the honest move is to
   * stop changing the figure and say so, not to silently refund a deduction
   * that was correctly computed when its inputs were still there. Money moves
   * on arithmetic somebody can reproduce; it does not move because a column
   * went null. A human with `penalty.reverse` can still undo it, with a reason,
   * which is a record of a decision rather than of a data change.
   */
  if (assessment.skipReason !== null) {
    // Silence is the one answer that is never available a month later — the
    // same reasoning `modules/ledger/earnings` records for its own skips.
    await recordAudit(db, {
      actor: args.actor,
      action: 'penalty.skipped',
      entity: 'Task',
      entityId: args.taskId,
      after: {
        reason: assessment.skipReason,
        cause: args.cause,
        lateWorkingDays: assessment.lateness.lateWorkingDays,
        activeEntries: actives.length,
      },
    })
    return result(args.taskId, {
      outcome: 'skipped',
      skipReason: assessment.skipReason,
      amount: actives.length > 0 ? magnitudeOf(actives[0]!.amount) : NOTHING,
    })
  }

  const target = assessment.target
  const userId = assessment.userId as string

  // The idempotent short-circuit, and the common case by a wide margin: exactly
  // one active entry, charged to the right person, for exactly the right
  // amount. Nothing is written — not even an audit row, because nothing
  // happened.
  if (
    actives.length === 1 &&
    actives[0]!.userId === userId &&
    eq(magnitudeOf(actives[0]!.amount), target) &&
    target !== NOTHING
  ) {
    return result(args.taskId, {
      outcome: 'unchanged',
      entryId: actives[0]!.id,
      amount: target,
      breakdown: assessment.breakdown,
    })
  }

  if (actives.length === 0 && target === NOTHING) {
    return result(args.taskId, { outcome: 'none' })
  }

  // ── Reverse first, then replace ────────────────────────────────────────
  //
  // In that order, always. A crash between the two leaves the منفّذ owing
  // nothing rather than owing twice, which is the direction to be wrong in.
  let reversedEntryId: string | null = null
  for (const active of actives) {
    try {
      const reversal = await reverseEntry(db, {
        entryId: active.id,
        reason: recalculationNote(assessment.taskTitle, args.cause),
        actor: args.actor,
        cycleDay: args.cycleDay,
        isAutoGenerated: true,
        at: args.now,
        ...(args.ip ? { ip: args.ip } : {}),
      })
      reversedEntryId = reversal.id

      await events.emit(db, {
        type: 'MoneyReversed',
        userId: active.userId,
        entryId: reversal.id,
        reversesEntryId: active.id,
        reversedType: 'PENALTY',
        taskId: args.taskId,
        amount: magnitudeOf(active.amount),
        reason: recalculationNote(assessment.taskTitle, args.cause),
        reversedById: args.actor?.id ?? null,
        isAutoGenerated: true,
        dismissable: true,
        at: args.now,
      })
    } catch (error) {
      /**
       * The cycle has already been paid out, so the old figure cannot be
       * un-charged (docs/TESTING.md §4 axis 7). Inserting the *new* figure
       * anyway would charge the منفّذ twice for one late delivery, so the whole
       * recomputation stops here and says why. The instrument for correcting a
       * paid cycle is an `ADJUSTMENT`, which is a decision somebody makes.
       */
      if (
        error instanceof AppError &&
        error.messageKey === 'ledger.errors.cycleAlreadyPaid'
      ) {
        await recordAudit(db, {
          actor: args.actor,
          action: 'ledger.reversalBlocked',
          entity: 'LedgerEntry',
          entityId: active.id,
          after: {
            taskId: args.taskId,
            userId: active.userId,
            reason: 'cycle-already-paid',
            wouldHaveBeen: target,
          },
        })
        return result(args.taskId, {
          outcome: 'skipped',
          skipReason: 'not-penalisable',
          amount: magnitudeOf(active.amount),
        })
      }
      throw error
    }
  }

  if (target === NOTHING) {
    await recordAudit(db, {
      actor: args.actor,
      action: 'penalty.cleared',
      entity: 'Task',
      entityId: args.taskId,
      // Nothing owed *and* nothing standing returned `none` above, so reaching
      // here means at least one entry was just reversed. A `?:` guard here
      // would be a branch no test could ever enter, which is worse than no
      // guard: it reads as a case somebody considered possible.
      before: { amount: magnitudeOf(actives[0]!.amount) },
      after: {
        amount: NOTHING,
        cause: args.cause,
        lateWorkingDays: assessment.lateness.lateWorkingDays,
        suppressedByRevisionPolicy: assessment.suppressedByRevisionPolicy,
      },
    })

    return result(args.taskId, {
      outcome: 'cleared',
      reversedEntryId,
      amount: NOTHING,
    })
  }

  const breakdown = assessment.breakdown!
  const entry = await appendEntry(db, {
    userId,
    type: 'PENALTY',
    amount: signedAmountFor('PENALTY', target),
    // The whole calculation, in Arabic prose the منفّذ reads on their
    // statement — SPEC §4: "an entry that cannot explain itself is exactly what
    // this product exists to abolish".
    note: penaltyNote(breakdown),
    taskId: args.taskId,
    isAutoGenerated: true,
    actor: args.actor,
    cycleDay: args.cycleDay,
    at: args.now,
    auditAction: actives.length > 0 ? 'penalty.recalculated' : 'penalty.applied',
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await events.emit(db, {
    type: 'PenaltyApplied',
    userId,
    entryId: entry.id,
    taskId: args.taskId,
    amount: target,
    breakdown,
    isAutoGenerated: true,
    // SPEC §8 / phase brief item 8: a منفّذ cannot make a deduction disappear
    // from their bell, and cannot contest it in-system.
    dismissable: false,
    at: args.now,
  })

  return result(args.taskId, {
    outcome: actives.length > 0 ? 'recalculated' : 'applied',
    reversedEntryId,
    entryId: entry.id,
    amount: target,
    breakdown,
  })
}

interface ActiveEntry {
  id: string
  userId: string
  amount: { toFixed(dp: number): string }
  createdAt: Date
}

/**
 * The automatic penalties this recomputation is allowed to touch.
 *
 * Two filters, and the second is SPEC T4:
 *
 *  - **Unreversed.** A reversed entry is history; reversing it again is what
 *    the unique index on `reversesEntryId` exists to refuse.
 *  - **In the current round.** Once a revision is requested, the previous
 *    delivery's penalty is frozen and stands (SPEC T4) — it is no longer
 *    *active* in SPEC §5.4's sense, which is "still subject to recalculation".
 *    See `rounds.ts` for why those two sentences agree rather than collide.
 *
 * `findMany`, not `findFirst`. "Exactly one active entry" is an invariant this
 * service maintains, not one it may assume: if a historical bug or a hand-run
 * SQL statement left two, reversing both and inserting one makes the invariant
 * true again, where taking the newest and ignoring the rest would leave a
 * second deduction on somebody's statement forever.
 */
async function findActiveAutoPenalties(
  db: Db,
  taskId: string,
  assessment: PenaltyAssessment,
): Promise<ActiveEntry[]> {
  const roundStart = currentRoundStart(assessment.rounds)

  const rows = await db.ledgerEntry.findMany({
    where: {
      taskId,
      type: 'PENALTY',
      isAutoGenerated: true,
      reversedBy: { is: null },
      ...(roundStart ? { createdAt: { gte: roundStart } } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true, amount: true, createdAt: true },
  })

  return rows as unknown as ActiveEntry[]
}

/** Ledger penalties are stored negative; everything a human reads is positive. */
function magnitudeOf(amount: { toFixed(dp: number): string }): string {
  return toStorageString(abs(toMoney(amount.toFixed(2))))
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual penalties (phase brief item 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateManualPenaltyArgs {
  userId: string
  /** Positive magnitude, as the manager typed it. Stored negative. */
  amount: MoneyInput
  /** Free text, mandatory. There is no reason taxonomy — see the note below. */
  reason: string
  actor: AuditActorRef
  cycleDay: number
  taskId?: string | null
  at?: Date
  ip?: string
  events?: MoneyEventBus
}

/**
 * A deduction a human decided on.
 *
 * **The reason is free text and there is no list to pick from.** The phase
 * brief settles it — "reason is free text only ('أخرى') per the agreed
 * design" — and the reasoning is the product's own thesis: a dropdown of
 * sanctioned reasons makes a manual deduction look as systematic as a computed
 * one, when the whole point of separating them is that this one is somebody's
 * judgement. A منفّذ reading "أخرى" learns nothing; a منفّذ reading the
 * manager's own sentence can at least argue with a person, which is the only
 * recourse SPEC §5.4 leaves them.
 *
 * `isAutoGenerated: false`, which is what keeps it out of the engine's way:
 * `findActiveAutoPenalties` never sees it, so a nightly recomputation can never
 * reverse a manager's decision.
 */
export async function createManualPenalty(
  db: Db,
  args: CreateManualPenaltyArgs,
): Promise<PenaltyRecomputeResult> {
  const events = args.events ?? noopMoneyEvents
  const reason = args.reason.trim()
  if (!reason) throw new DomainError('penalties.errors.reasonRequired')

  const at = args.at ?? new Date()
  const amount = signedAmountFor('PENALTY', args.amount)

  const entry = await appendEntry(db, {
    userId: args.userId,
    type: 'PENALTY',
    amount,
    note: ar.penalties.notes.manual.replace('{reason}', reason),
    isAutoGenerated: false,
    actor: args.actor,
    cycleDay: args.cycleDay,
    at,
    auditAction: 'penalty.created',
    reason,
    ...(args.taskId ? { taskId: args.taskId } : {}),
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await events.emit(db, {
    type: 'PenaltyApplied',
    userId: args.userId,
    entryId: entry.id,
    taskId: args.taskId ?? null,
    amount: toStorageString(abs(toMoney(amount))),
    // No breakdown: there is no calculation to show. Saying so is more honest
    // than assembling a formula around a number somebody chose.
    breakdown: null,
    isAutoGenerated: false,
    dismissable: false,
    at,
  })

  return result(args.taskId ?? '', {
    outcome: 'applied',
    entryId: entry.id,
    amount: toStorageString(abs(toMoney(amount))),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Bonuses (phase brief item 6) — manual only, always
// ─────────────────────────────────────────────────────────────────────────────

export interface GrantBonusArgs {
  userId: string
  /** Positive magnitude. Stored positive — a bonus is a credit. */
  amount: MoneyInput
  /** Free text, mandatory. */
  reason: string
  actor: AuditActorRef
  cycleDay: number
  at?: Date
  ip?: string
  events?: MoneyEventBus
}

/**
 * A مكافأة. **Nothing computes one, and nothing ever should.**
 *
 * The asymmetry with penalties is the product's thesis, not an omission. A
 * deduction has to be automatic so that it is arithmetic rather than the
 * manager's mood (CLAUDE.md); a bonus is *supposed* to be somebody's judgement,
 * and automating it would turn a reward into an entitlement nobody decided on.
 * SPEC §5.6 makes the matching point from the other side: penalties and bonuses
 * do not feed the performance score.
 *
 * The write itself is `modules/ledger`'s `recordBonus`, which owns the sign
 * rule and the mandatory reason. What this adds is the notification.
 */
export async function grantBonus(
  db: Db,
  args: GrantBonusArgs,
): Promise<{ entryId: string; amount: string }> {
  const events = args.events ?? noopMoneyEvents
  const reason = args.reason.trim()
  if (!reason) throw new DomainError('bonuses.errors.reasonRequired')

  const at = args.at ?? new Date()
  const entry = await recordBonus(db, {
    userId: args.userId,
    amount: args.amount,
    reason,
    actor: args.actor,
    cycleDay: args.cycleDay,
    at,
    ...(args.ip ? { ip: args.ip } : {}),
  })

  const magnitude = toStorageString(abs(toMoney(entry.amount)))

  await events.emit(db, {
    type: 'BonusGranted',
    userId: args.userId,
    entryId: entry.id,
    amount: magnitude,
    // Verbatim, not a template. It is the manager's own sentence and the only
    // explanation the منفّذ gets.
    reason,
    grantedById: args.actor.id,
    dismissable: true,
    at,
  })

  return { entryId: entry.id, amount: magnitude }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reversal (phase brief item 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReversePenaltyArgs {
  entryId: string
  /** Mandatory. Becomes the reversal's note, which the منفّذ reads verbatim. */
  reason: string
  actor: AuditActorRef
  cycleDay: number
  at?: Date
  ip?: string
  events?: MoneyEventBus
}

/**
 * Undo one `PENALTY` or `BONUS` by hand.
 *
 * The three refusals the brief asks for are `modules/ledger`'s already, and are
 * deliberately not re-implemented here: reversing twice is caught by the unique
 * index on `reversesEntryId`, reversing a reversal is refused by type, and
 * reversing an entry inside a `PAID` payout is refused with
 * `ledger.errors.cycleAlreadyPaid` — which `i18n/ar` renders as "لا يمكن عكس
 * قيد من دورة صُرفت بالفعل. استخدم قيد تسوية." A second copy of those rules
 * here would be a second thing that can disagree with the first.
 *
 * What this adds is the notification, and the refusal to touch anything that is
 * neither a penalty nor a bonus — the permission catalog has keys for exactly
 * those two (SPEC §6), so those are the two a human may undo.
 */
export async function reversePenaltyOrBonus(
  db: Db,
  args: ReversePenaltyArgs,
): Promise<{ entryId: string; reversalId: string; type: 'PENALTY' | 'BONUS' }> {
  const events = args.events ?? noopMoneyEvents
  const reason = args.reason.trim()
  if (!reason) throw new DomainError('penalties.errors.reverseReasonRequired')

  const original = await db.ledgerEntry.findUnique({
    where: { id: args.entryId },
    select: { id: true, userId: true, type: true, amount: true, taskId: true },
  })
  if (!original) throw new NotFoundError('LedgerEntry', args.entryId)

  if (original.type !== 'PENALTY' && original.type !== 'BONUS') {
    throw new DomainError('ledger.errors.notHumanReversible', {
      entryId: original.id,
      type: original.type,
    })
  }

  const reversal = await reverseEntry(db, {
    entryId: args.entryId,
    reason,
    actor: args.actor,
    cycleDay: args.cycleDay,
    isAutoGenerated: false,
    ...(args.at ? { at: args.at } : {}),
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await recordAudit(db, {
    actor: args.actor,
    action: original.type === 'BONUS' ? 'bonus.reversed' : 'penalty.reversed',
    entity: 'LedgerEntry',
    entityId: original.id,
    before: { amount: original.amount.toFixed(2), type: original.type },
    after: { reversalId: reversal.id },
    reason,
    ...(args.ip ? { ip: args.ip } : {}),
  })

  await events.emit(db, {
    type: 'MoneyReversed',
    userId: original.userId,
    entryId: reversal.id,
    reversesEntryId: original.id,
    reversedType: original.type,
    taskId: original.taskId,
    amount: magnitudeOf(original.amount),
    reason,
    reversedById: args.actor.id,
    isAutoGenerated: false,
    dismissable: true,
    at: args.at ?? new Date(),
  })

  return {
    entryId: original.id,
    reversalId: reversal.id,
    type: original.type as 'PENALTY' | 'BONUS',
  }
}
