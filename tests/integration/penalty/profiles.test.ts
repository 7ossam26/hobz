import { describe, expect, it, vi } from 'vitest'

import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'

import {
  createPenaltyProfile as seedProfile,
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { recompute } from '../../helpers/penalty'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const {
  assignPenaltyProfile,
  createPenaltyProfile,
  deletePenaltyProfile,
  getPenaltyProfile,
  listPenaltyProfiles,
  updatePenaltyProfile,
} = await import('@/modules/penalty/profiles')

const {
  createPenaltyProfileAction,
  deletePenaltyProfileAction,
  updatePenaltyProfileAction,
  assignPenaltyProfileAction,
} = await import('@/modules/penalty/actions')

const { getPenaltyProfiles } = await import('@/modules/penalty/queries')

/**
 * SPEC R2's named formulas — phase brief item 1: "One global default in
 * Settings; an optional per-user override. Managed in UI."
 *
 * ── Why a profile is a table and not three columns on `User` ──────────────
 *
 * Because it is **shared**. an organization assigns "خصم المصممين" to eleven
 * designers and edits it once; three columns per user would mean eleven edits
 * and, the first time somebody misses one, two designers on different terms
 * with nobody able to say which was intended.
 *
 * The tests below therefore care most about the things sharing makes possible
 * and dangerous in equal measure: how many people an edit reaches, what happens
 * to them when the formula is deleted, and whether either can happen without
 * `settings.edit`.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const NOW = cairo('2026-03-05T12:00')

async function manager(
  permissions: readonly (
    'settings.edit' | 'settings.view' | 'user.edit' | 'penalty.view'
  )[],
) {
  await seedPermissionCatalog(db)
  const user = await createUserWithPermissions(db, permissions)
  return actorFor(db, user.id)
}

const validInput = {
  name: 'خصم المصممين',
  mode: 'FIXED_PER_DAY' as const,
  value: '75.00',
  graceHours: 8,
}

describe('إنشاء صيغة خصم', () => {
  it('يحفظ الصيغة كاملة ويسجّلها في التدقيق', async () => {
    const actor = await manager(['settings.edit'])

    const profile = await createPenaltyProfile(db, { input: validInput, actor })

    expect(profile.name).toBe('خصم المصممين')
    expect(profile.mode).toBe('FIXED_PER_DAY')
    expect(profile.value).toBe('75.00')
    expect(profile.graceHours).toBe(8)
    expect(profile.userCount).toBe(0)

    const audit = await db.auditLog.findFirst({
      where: { action: 'penaltyProfile.created', entityId: profile.id },
    })
    // CLAUDE.md invariant 7: a change to how somebody's pay is docked is a
    // change that touches money, even though this row is not itself money.
    expect(audit).not.toBeNull()
  })

  it('يقصّ الاسم ويرفض تكراره', async () => {
    const actor = await manager(['settings.edit'])
    await createPenaltyProfile(db, { input: validInput, actor })

    await expect(
      createPenaltyProfile(db, {
        input: { ...validInput, name: '  خصم المصممين  ' },
        actor,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('يعتبر الاسمين المتطابقين بعد التطبيع اسمًا واحدًا', async () => {
    // Two profiles a manager cannot tell apart on the screen where they pick
    // one — and picking the wrong one changes somebody's pay. Same rule
    // `lib/search` applies to finding people.
    const actor = await manager(['settings.edit'])
    await createPenaltyProfile(db, {
      input: { ...validInput, name: 'خصم الأداء' },
      actor,
    })

    await expect(
      createPenaltyProfile(db, { input: { ...validInput, name: 'خصم الاداء' }, actor }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('صيغة محذوفة لا تحجز اسمها', async () => {
    const actor = await manager(['settings.edit'])
    const first = await createPenaltyProfile(db, { input: validInput, actor })
    await deletePenaltyProfile(db, { id: first.id, actor })

    const second = await createPenaltyProfile(db, { input: validInput, actor })

    expect(second.id).not.toBe(first.id)
  })
})

describe('تعديل صيغة خصم', () => {
  it('يغيّر ما يُخصم لاحقًا ويسجّل عدد المتأثرين', async () => {
    const actor = await manager(['settings.edit'])
    const profile = await createPenaltyProfile(db, { input: validInput, actor })
    const worker = await createUser(db, { penaltyProfileId: profile.id })

    const updated = await updatePenaltyProfile(db, {
      id: profile.id,
      input: { ...validInput, value: '120.00' },
      actor,
    })

    expect(updated.value).toBe('120.00')
    expect(updated.userCount).toBe(1)

    const audit = await db.auditLog.findFirst({
      where: { action: 'penaltyProfile.updated', entityId: profile.id },
    })
    // How many people this reached, recorded at the moment it happened — an
    // edit that quietly changes eleven pay packets should say eleven.
    expect((audit?.after as { affectedUsers?: number })?.affectedUsers).toBe(1)
    expect(worker.id).toBeTruthy()
  })

  /**
   * The rule that keeps an append-only ledger honest: changing a formula
   * changes what the *next* recomputation charges, and reaches back into
   * nothing. A deduction already computed was correct under the rules in force
   * when it was computed.
   */
  it('لا يعيد كتابة خصم سبق احتسابه', async () => {
    const actor = await manager(['settings.edit'])
    const profile = await createPenaltyProfile(db, {
      input: { ...validInput, graceHours: null },
      actor,
    })
    const owner = await createUser(db)
    const worker = await createUser(db, { penaltyProfileId: profile.id })
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status: 'SUBMITTED',
      taskValue: '1000.00',
      dueDate: DUE,
      originalDueDate: DUE,
      submittedAt: cairo('2026-03-05T10:00'),
    })
    await recompute(db, task.id, { now: NOW })

    await updatePenaltyProfile(db, {
      id: profile.id,
      input: { ...validInput, value: '999.00', graceHours: null },
      actor,
    })

    const entries = await db.ledgerEntry.findMany({
      where: { taskId: task.id, type: 'PENALTY' },
      select: { amount: true },
    })
    // 75.00 × 3 days, unchanged by the edit. The task is delivered, so its
    // figure is frozen and the next run is a no-op rather than a re-pricing.
    expect(entries.map((e) => e.amount.toFixed(2))).toEqual(['-225.00'])
  })

  it('صيغة غير موجودة ترفع NotFound', async () => {
    const actor = await manager(['settings.edit'])

    await expect(
      updatePenaltyProfile(db, { id: 'missing', input: validInput, actor }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('حذف صيغة خصم', () => {
  it('يفصل كل منفّذ مسند إليها ويعيده للافتراضي العام', async () => {
    const actor = await manager(['settings.edit'])
    const profile = await createPenaltyProfile(db, { input: validInput, actor })
    const a = await createUser(db, { penaltyProfileId: profile.id })
    const b = await createUser(db, { penaltyProfileId: profile.id })

    await deletePenaltyProfile(db, { id: profile.id, actor })

    const rows = await db.user.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { penaltyProfileId: true },
    })
    // The detach is not what makes the behaviour correct — `assess.ts` already
    // refuses a deleted profile — it is what makes it *visible*. A dangling id
    // would show "الافتراضي العام" on screen and a live link in the database.
    expect(rows.map((r) => r.penaltyProfileId)).toEqual([null, null])

    const audit = await db.auditLog.findFirst({
      where: { action: 'penaltyProfile.deleted', entityId: profile.id },
    })
    expect((audit?.after as { detachedUsers?: number })?.detachedUsers).toBe(2)
  })

  it('الحذف ناعم: الصيغة تختفي من القائمة ولا تُقرأ', async () => {
    const actor = await manager(['settings.edit'])
    const profile = await createPenaltyProfile(db, { input: validInput, actor })

    await deletePenaltyProfile(db, { id: profile.id, actor })

    expect(await listPenaltyProfiles(db)).toEqual([])
    await expect(getPenaltyProfile(db, profile.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      deletePenaltyProfile(db, { id: profile.id, actor }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('إسناد صيغة لمنفّذ', () => {
  it('يسند ثم يعيد للافتراضي بـ null', async () => {
    const actor = await manager(['user.edit', 'settings.edit'])
    const profile = await createPenaltyProfile(db, { input: validInput, actor })
    const worker = await createUser(db)

    await assignPenaltyProfile(db, { userId: worker.id, profileId: profile.id, actor })
    const assigned = await db.user.findUnique({
      where: { id: worker.id },
      select: { penaltyProfileId: true },
    })
    expect(assigned?.penaltyProfileId).toBe(profile.id)

    await assignPenaltyProfile(db, { userId: worker.id, profileId: null, actor })
    const cleared = await db.user.findUnique({
      where: { id: worker.id },
      select: { penaltyProfileId: true },
    })
    expect(cleared?.penaltyProfileId).toBeNull()
  })

  it('يرفض الإسناد لصيغة محذوفة أو غير موجودة', async () => {
    const actor = await manager(['user.edit', 'settings.edit'])
    const deleted = await seedProfile(db, { deletedAt: cairo('2026-02-01T09:00') })
    const worker = await createUser(db)

    await expect(
      assignPenaltyProfile(db, { userId: worker.id, profileId: deleted.id, actor }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      assignPenaltyProfile(db, { userId: worker.id, profileId: 'missing', actor }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('يرفض الإسناد لمنفّذ محذوف', async () => {
    const actor = await manager(['user.edit', 'settings.edit'])
    const profile = await createPenaltyProfile(db, { input: validInput, actor })
    const gone = await createUser(db, { deletedAt: cairo('2026-02-01T09:00') })

    await expect(
      assignPenaltyProfile(db, { userId: gone.id, profileId: profile.id, actor }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('الصلاحيات — الصيغ إعدادات وكالة', () => {
  it('settings.edit مطلوب للإنشاء والتعديل والحذف', async () => {
    const nobody = await manager(['penalty.view'])
    setSessionActor(nobody)

    await expect(createPenaltyProfileAction(validInput)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(
      updatePenaltyProfileAction({ id: 'x', ...validInput }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(deletePenaltyProfileAction({ id: 'x' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )

    clearSessionActor()
    expect(await db.penaltyProfile.count()).toBe(0)
  })

  /**
   * Assigning a formula to a person is an edit to that *person*, so it is
   * `user.edit`. A team lead who may change who does what should not need the
   * key that changes what the organization's rules are — and vice versa.
   */
  it('الإسناد يحتاج user.edit لا settings.edit', async () => {
    const editor = await manager(['settings.edit'])
    const profile = await createPenaltyProfile(db, { input: validInput, actor: editor })
    const worker = await createUser(db)

    setSessionActor(editor)
    await expect(
      assignPenaltyProfileAction({ userId: worker.id, profileId: profile.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    clearSessionActor()

    const lead = await createUserWithPermissions(db, ['user.edit'])
    setSessionActor(await actorFor(db, lead.id))
    await assignPenaltyProfileAction({ userId: worker.id, profileId: profile.id })
    clearSessionActor()

    const row = await db.user.findUnique({
      where: { id: worker.id },
      select: { penaltyProfileId: true },
    })
    expect(row?.penaltyProfileId).toBe(profile.id)
  })

  it('settings.view مطلوب لقراءة الصيغ', async () => {
    const nobody = await manager(['penalty.view'])
    setSessionActor(nobody)

    await expect(getPenaltyProfiles()).rejects.toBeInstanceOf(ForbiddenError)

    clearSessionActor()
  })

  it('صاحب settings.view يقرأ القائمة مرتّبة بالاسم', async () => {
    const editor = await manager(['settings.edit', 'settings.view'])
    await createPenaltyProfile(db, {
      input: { ...validInput, name: 'ياء' },
      actor: editor,
    })
    await createPenaltyProfile(db, {
      input: { ...validInput, name: 'ألف' },
      actor: editor,
    })

    setSessionActor(editor)
    const profiles = await getPenaltyProfiles()
    clearSessionActor()

    expect(profiles.map((p) => p.name)).toEqual(['ألف', 'ياء'])
  })
})
