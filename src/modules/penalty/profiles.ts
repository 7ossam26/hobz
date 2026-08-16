import { recordAudit, type AuditActorRef } from '@/lib/audit'
import type { Db } from '@/lib/db'
import { ConflictError, NotFoundError } from '@/lib/errors'
import { toStorageString } from '@/lib/money'
import { normalizeArabic } from '@/lib/search'

import type { PenaltyMode } from './mode'
import type { PenaltyProfileDto } from './types'

/**
 * modules/penalty/profiles — managing SPEC R2's named formulas.
 *
 *   > **R2 — per-user formula.** Implemented as a `PenaltyProfile`
 *   > (mode + value + grace), defaulted globally and overridable per user.
 *
 * A profile is **shared**: an agency assigns "خصم المصممين" to eleven people
 * and edits it once. That is the whole reason it is a table rather than three
 * more columns on `User`.
 *
 * ── Editing a profile does not rewrite history ────────────────────────────
 *
 * Changing a profile changes what the *next* recomputation charges. It does not
 * reach back into the ledger, because nothing may: entries are append-only, and
 * a deduction already computed was correct under the rules in force when it was
 * computed. A manager who wants an old deduction undone reverses it, with a
 * reason — which records a decision instead of pretending the arithmetic always
 * said something else.
 *
 * The one exception, and it is deliberate: a task whose *live* round is still
 * accruing will pick the new formula up on the next run, because that round's
 * figure was never final.
 */

type DecimalLike = { toFixed(dp: number): string }

interface ProfileRow {
  id: string
  name: string
  mode: string
  value: DecimalLike
  graceHours: number | null
  createdAt: Date
  _count?: { users: number }
}

const PROFILE_SELECT = {
  id: true,
  name: true,
  mode: true,
  value: true,
  graceHours: true,
  createdAt: true,
  _count: { select: { users: true } },
} as const

function toDto(row: ProfileRow): PenaltyProfileDto {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode as PenaltyMode,
    value: row.value.toFixed(2),
    graceHours: row.graceHours,
    userCount: row._count?.users ?? 0,
    createdAt: row.createdAt,
  }
}

export async function listPenaltyProfiles(db: Db): Promise<PenaltyProfileDto[]> {
  const rows = await db.penaltyProfile.findMany({
    where: { deletedAt: null },
    orderBy: [{ name: 'asc' }],
    select: PROFILE_SELECT,
  })
  return (rows as unknown as ProfileRow[]).map(toDto)
}

export async function getPenaltyProfile(db: Db, id: string): Promise<PenaltyProfileDto> {
  const row = await db.penaltyProfile.findFirst({
    where: { id, deletedAt: null },
    select: PROFILE_SELECT,
  })
  if (!row) throw new NotFoundError('PenaltyProfile', id)
  return toDto(row as unknown as ProfileRow)
}

/**
 * Two profiles called the same thing are two things a manager cannot tell apart
 * on the screen where they pick one — and picking the wrong one changes
 * somebody's pay. Compared on the normalised Arabic form, so "خصم المصممين" and
 * "خصم المصممين" with a different hamza are the same name, which is the same
 * rule `lib/search` applies to finding people.
 */
async function assertNameFree(db: Db, name: string, exceptId?: string): Promise<void> {
  const normalized = normalizeArabic(name)
  const existing = await db.penaltyProfile.findMany({
    where: { deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true },
  })
  if (existing.some((row) => normalizeArabic(row.name) === normalized)) {
    throw new ConflictError('penaltyProfiles.errors.duplicateName', { name })
  }
}

export interface PenaltyProfileInput {
  name: string
  mode: PenaltyMode
  /** Currency for `FIXED_*`, a percentage for `PCT_*`. Never negative. */
  value: string
  graceHours: number | null
}

export interface PenaltyProfileMutationArgs {
  input: PenaltyProfileInput
  actor: AuditActorRef
  at?: Date
  ip?: string
}

export async function createPenaltyProfile(
  db: Db,
  args: PenaltyProfileMutationArgs,
): Promise<PenaltyProfileDto> {
  const name = args.input.name.trim()
  await assertNameFree(db, name)

  const row = await db.penaltyProfile.create({
    data: {
      name,
      mode: args.input.mode,
      value: toStorageString(args.input.value),
      graceHours: args.input.graceHours,
      ...(args.at ? { createdAt: args.at } : {}),
    },
    select: PROFILE_SELECT,
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'penaltyProfile.created',
    entity: 'PenaltyProfile',
    entityId: row.id,
    after: {
      name,
      mode: args.input.mode,
      value: toStorageString(args.input.value),
      graceHours: args.input.graceHours,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toDto(row as unknown as ProfileRow)
}

export async function updatePenaltyProfile(
  db: Db,
  args: PenaltyProfileMutationArgs & { id: string },
): Promise<PenaltyProfileDto> {
  const before = await db.penaltyProfile.findFirst({
    where: { id: args.id, deletedAt: null },
    select: PROFILE_SELECT,
  })
  if (!before) throw new NotFoundError('PenaltyProfile', args.id)

  const name = args.input.name.trim()
  await assertNameFree(db, name, args.id)

  const row = await db.penaltyProfile.update({
    where: { id: args.id },
    data: {
      name,
      mode: args.input.mode,
      value: toStorageString(args.input.value),
      graceHours: args.input.graceHours,
    },
    select: PROFILE_SELECT,
  })

  // A change to how somebody's pay is docked is exactly what CLAUDE.md
  // invariant 7 means by "audit everything that touches money" — even though
  // this row is not itself money.
  await recordAudit(db, {
    actor: args.actor,
    action: 'penaltyProfile.updated',
    entity: 'PenaltyProfile',
    entityId: args.id,
    before: {
      name: before.name,
      mode: before.mode,
      value: before.value.toFixed(2),
      graceHours: before.graceHours,
    },
    after: {
      name,
      mode: args.input.mode,
      value: toStorageString(args.input.value),
      graceHours: args.input.graceHours,
      affectedUsers: (before as unknown as ProfileRow)._count?.users ?? 0,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return toDto(row as unknown as ProfileRow)
}

/**
 * Soft-delete, and **detach every member explicitly**.
 *
 * `assess.ts` already refuses to apply a deleted profile, so the detach is not
 * what makes the behaviour correct — it is what makes it *visible*. A منفّذ
 * left pointing at an invisible formula would show "الافتراضي العام" on one
 * screen and a dangling id in the database, and the first person to restore the
 * profile would silently re-apply it to people nobody re-assigned.
 */
export async function deletePenaltyProfile(
  db: Db,
  args: { id: string; actor: AuditActorRef; at?: Date; ip?: string },
): Promise<void> {
  const before = await db.penaltyProfile.findFirst({
    where: { id: args.id, deletedAt: null },
    select: PROFILE_SELECT,
  })
  if (!before) throw new NotFoundError('PenaltyProfile', args.id)

  const detached = await db.user.updateMany({
    where: { penaltyProfileId: args.id },
    data: { penaltyProfileId: null },
  })

  await db.penaltyProfile.update({
    where: { id: args.id },
    data: { deletedAt: args.at ?? new Date() },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'penaltyProfile.deleted',
    entity: 'PenaltyProfile',
    entityId: args.id,
    before: { name: before.name, mode: before.mode, value: before.value.toFixed(2) },
    after: { detachedUsers: detached.count },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

export interface AssignPenaltyProfileArgs {
  userId: string
  /** Null returns the منفّذ to the agency default. */
  profileId: string | null
  actor: AuditActorRef
  ip?: string
}

export async function assignPenaltyProfile(
  db: Db,
  args: AssignPenaltyProfileArgs,
): Promise<void> {
  const user = await db.user.findFirst({
    where: { id: args.userId, deletedAt: null },
    select: { id: true, penaltyProfileId: true },
  })
  if (!user) throw new NotFoundError('User', args.userId)

  if (args.profileId) {
    const profile = await db.penaltyProfile.findFirst({
      where: { id: args.profileId, deletedAt: null },
      select: { id: true },
    })
    if (!profile) throw new NotFoundError('PenaltyProfile', args.profileId)
  }

  await db.user.update({
    where: { id: args.userId },
    data: { penaltyProfileId: args.profileId },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'penaltyProfile.assigned',
    entity: 'User',
    entityId: args.userId,
    before: { penaltyProfileId: user.penaltyProfileId },
    after: { penaltyProfileId: args.profileId },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}
