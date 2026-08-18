import { describe, expect, it } from 'vitest'

import { addCairoDays, cairoDateKey, createCalendar } from '@/lib/calendar'
import { SETTINGS_CATALOG } from '@/lib/settings'
import { recomputeTaskSchedule } from '@/modules/calendar/recompute'
import type { EscalationThresholds } from '@/modules/lateness/escalation'
import type { LatenessDomainEvent, LatenessEventBus } from '@/modules/lateness/ports'
import { deliverManagerDigest } from '@/modules/notification/digest'
import { managerDigestJob } from '@/modules/notification/job'
import { deliverNotification } from '@/modules/notification/service'
import type { HealthThresholds } from '@/modules/project/health'

import {
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { inMemoryCalendarSource } from '../../helpers/calendar'
import { cairo, findCairoTransitions, HOUR_MS, MINUTE_MS } from '../../helpers/time'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * Three axes docs/TESTING.md §4 calls out that the three existing notification
 * test files (`preferences`, `digest`, `bus`) do not cover:
 *
 *  1. The digest job's hour gate, proven through the actual job handler
 *     (`job.ts`'s `cairoParts(ctx.runAt).hour !== settings[...]` check), plus
 *     its Cairo-date dedupeKey across a real DST transition day.
 *  2. `TaskDueSoon`'s boundary — exactly at `dueSoonHours`, one minute inside,
 *     one minute outside — and that a delivered task never gets the reminder
 *     even when its due date would otherwise qualify.
 *  3. The dedupeKey unique index under real concurrency, both for a single
 *     `deliverNotification` call and for two racing scheduler ticks calling
 *     `deliverManagerDigest`.
 */

const MESSAGE = {
  title: 'عنوان تجريبي',
  body: 'نص تجريبي',
  entityType: null,
  entityId: null,
  dismissable: true,
}

const HEALTH_THRESHOLDS: HealthThresholds = {
  overdueTasksThreshold: 3,
  blockedDaysThreshold: 3,
  amberDaysBeforeDue: 3,
}

// ─────────────────────────────────────────────────────────────────────────────
// Axis 1a — the digest job's hour gate, through the real handler
// ─────────────────────────────────────────────────────────────────────────────

describe('modules/notification/job — بوابة الساعة القاهرية لملخّص المدير', () => {
  const DIGEST_HOUR = SETTINGS_CATALOG['notifications.digestHourCairo'].default
  // One hour before the configured hour, wrapping past midnight if the catalog
  // default were ever 0 — never hardcoded to 7 (CLAUDE.md invariant 4).
  const WRONG_HOUR = (DIGEST_HOUR + 23) % 24
  const DAY = '2026-08-16'

  const pad = (hour: number) => String(hour).padStart(2, '0')

  it('لا يُسلَّم شيء عند استدعاء المعالج في ساعة قاهرية غير ساعة الإعداد', async () => {
    await seedPermissionCatalog(db)
    await createUserWithPermissions(db, ['project.view.all'])

    await managerDigestJob.handler({
      db,
      runAt: cairo(`${DAY}T${pad(WRONG_HOUR)}:00`),
      trigger: 'manual',
    })

    expect(await db.notification.count({ where: { type: 'MANAGER_DIGEST' } })).toBe(0)
  })

  it('يُسلَّم عند استدعاء المعالج في الساعة القاهرية المطابقة للإعداد بالضبط', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.view.all'])

    await managerDigestJob.handler({
      db,
      runAt: cairo(`${DAY}T${pad(DIGEST_HOUR)}:00`),
      trigger: 'manual',
    })

    expect(
      await db.notification.count({
        where: { userId: manager.id, type: 'MANAGER_DIGEST' },
      }),
    ).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Axis 1b — the Cairo-date dedupeKey, across a real DST transition day
// ─────────────────────────────────────────────────────────────────────────────

describe('modules/notification/digest — مفتاح الإزالة عبر تحويل التوقيت', () => {
  const { forward, back } = findCairoTransitions(2026)
  if (!forward || !back) {
    throw new Error('Africa/Cairo has no DST transitions in the fixture year 2026')
  }
  const SHORT_DAY = cairoDateKey(forward) // the 23-hour day
  const LONG_DAY = cairoDateKey(back) // the 25-hour day

  it('يوم التحويل الربيعي (23 ساعة) واليوم التالي لا يتصادمان على المفتاح', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.view.all'])

    await deliverManagerDigest(db, {
      now: cairo(`${SHORT_DAY}T08:00`),
      healthThresholds: HEALTH_THRESHOLDS,
    })
    await deliverManagerDigest(db, {
      now: cairo(`${addCairoDays(SHORT_DAY, 1)}T08:00`),
      healthThresholds: HEALTH_THRESHOLDS,
    })

    const rows = await db.notification.findMany({
      where: { userId: manager.id, type: 'MANAGER_DIGEST' },
      select: { dedupeKey: true },
    })
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(2)
  })

  it('يوم التحويل الخريفي (25 ساعة) واليوم التالي لا يتصادمان على المفتاح', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.view.all'])

    await deliverManagerDigest(db, {
      now: cairo(`${LONG_DAY}T08:00`),
      healthThresholds: HEALTH_THRESHOLDS,
    })
    await deliverManagerDigest(db, {
      now: cairo(`${addCairoDays(LONG_DAY, 1)}T08:00`),
      healthThresholds: HEALTH_THRESHOLDS,
    })

    const rows = await db.notification.findMany({
      where: { userId: manager.id, type: 'MANAGER_DIGEST' },
      select: { dedupeKey: true },
    })
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Axis 2 — TaskDueSoon boundary precision
// ─────────────────────────────────────────────────────────────────────────────

describe('modules/calendar/job — دقة حد "قريب من الموعد" (TaskDueSoon)', () => {
  const NOW = cairo('2026-06-03T10:00')
  const GRACE_HOURS = SETTINGS_CATALOG['penalty.defaultGraceHours'].default
  const DUE_SOON_HOURS = SETTINGS_CATALOG['notifications.dueSoonHours'].default
  const ESCALATION_THRESHOLDS: EscalationThresholds = {
    pmAfterDays: SETTINGS_CATALOG['notifications.escalateToPmAfterDays'].default,
    adminAfterDays: SETTINGS_CATALOG['notifications.escalateToAdminAfterDays'].default,
  }
  // Every day working: the due-soon check is pure wall-clock hours, so the
  // calendar only needs to let `computeLateness`/`recomputeElapsed` run without
  // throwing — it is not what this axis is testing.
  const calendar = createCalendar(inMemoryCalendarSource({ weekendDays: [] }))

  function recordingBus(): LatenessEventBus & { events: LatenessDomainEvent[] } {
    const events: LatenessDomainEvent[] = []
    return {
      events,
      emit: async (_db, event) => {
        events.push(event)
      },
    }
  }

  async function scenario(
    status: 'IN_PROGRESS' | 'IN_REVIEW' | 'SUBMITTED',
    dueDate: Date,
  ): Promise<{ id: string }> {
    const owner = await createUser(db)
    const worker = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    return createTask(db, {
      projectId: project.id,
      assigneeId: worker.id,
      status,
      dueDate,
      originalDueDate: dueDate,
      assignedAt: cairo('2026-05-25T09:00'),
      submittedAt: status === 'IN_PROGRESS' ? null : cairo('2026-06-01T09:00'),
    })
  }

  async function dueSoonEventsFor(taskId: string) {
    const bus = recordingBus()
    await recomputeTaskSchedule(db, {
      taskId,
      calendar,
      defaultGraceHours: GRACE_HOURS,
      thresholds: ESCALATION_THRESHOLDS,
      dueSoonHours: DUE_SOON_HOURS,
      now: NOW,
      events: bus,
    })
    return bus.events.filter((e) => e.type === 'TaskDueSoon')
  }

  it('يُطلق التذكير عندما يبعد الموعد عن الآن بعدد الساعات المحدد بالضبط (الحد)', async () => {
    const dueDate = new Date(NOW.getTime() + DUE_SOON_HOURS * HOUR_MS)
    const task = await scenario('IN_PROGRESS', dueDate)

    expect(await dueSoonEventsFor(task.id)).toHaveLength(1)
  })

  it('يُطلق التذكير قبل الحد بدقيقة واحدة', async () => {
    const dueDate = new Date(NOW.getTime() + DUE_SOON_HOURS * HOUR_MS - MINUTE_MS)
    const task = await scenario('IN_PROGRESS', dueDate)

    expect(await dueSoonEventsFor(task.id)).toHaveLength(1)
  })

  it('لا يُطلق التذكير بعد الحد بدقيقة واحدة', async () => {
    const dueDate = new Date(NOW.getTime() + DUE_SOON_HOURS * HOUR_MS + MINUTE_MS)
    const task = await scenario('IN_PROGRESS', dueDate)

    expect(await dueSoonEventsFor(task.id)).toHaveLength(0)
  })

  it('لا يصل تذكير لمهمة قيد المراجعة (IN_REVIEW) حتى لو كان موعدها ضمن النافذة', async () => {
    const dueDate = new Date(NOW.getTime() + DUE_SOON_HOURS * HOUR_MS)
    const task = await scenario('IN_REVIEW', dueDate)

    expect(await dueSoonEventsFor(task.id)).toHaveLength(0)
  })

  it('لا يصل تذكير لمهمة مُسلَّمة (SUBMITTED) حتى لو كان موعدها ضمن النافذة', async () => {
    const dueDate = new Date(NOW.getTime() + DUE_SOON_HOURS * HOUR_MS)
    const task = await scenario('SUBMITTED', dueDate)

    expect(await dueSoonEventsFor(task.id)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Axis 3 — concurrency on the dedupeKey unique index
// ─────────────────────────────────────────────────────────────────────────────

describe('modules/notification/service — التزامن على فهرس dedupeKey الفريد', () => {
  it('نداءان متزامنان بنفس userId/type/dedupeKey يُنتجان صفًّا واحدًا فقط بلا استثناء غير مُعالَج', async () => {
    const user = await createUser(db)
    const args = {
      userId: user.id,
      type: 'TASK_DUE_SOON' as const,
      message: MESSAGE,
      dedupeKey: 'task-concurrent:2026-08-20T17:00:00.000Z',
    }

    const results = await Promise.allSettled([
      deliverNotification(db, args),
      deliverNotification(db, args),
    ])

    // Neither call may reject — the unique-violation branch inside
    // `deliverNotification` must swallow P2002, not propagate it.
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    // Exactly one of the two returned the created row; the other saw the
    // unique violation and returned null.
    const values = results.map((r) => (r as PromiseFulfilledResult<unknown>).value)
    expect(values.filter((v) => v !== null)).toHaveLength(1)

    expect(
      await db.notification.count({
        where: { userId: user.id, dedupeKey: args.dedupeKey },
      }),
    ).toBe(1)
  })
})

describe('modules/notification/digest — التزامن (محاكاة سباق جدولة)', () => {
  it('نداءان متزامنان لتسليم ملخص المدير يُنتجان إشعارًا واحدًا لكل مدير لا اثنين', async () => {
    await seedPermissionCatalog(db)
    const manager1 = await createUserWithPermissions(db, ['project.view.all'])
    const manager2 = await createUserWithPermissions(db, ['project.view.all'])
    const now = cairo('2026-08-16T08:00')

    const results = await Promise.allSettled([
      deliverManagerDigest(db, { now, healthThresholds: HEALTH_THRESHOLDS }),
      deliverManagerDigest(db, { now, healthThresholds: HEALTH_THRESHOLDS }),
    ])

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    for (const manager of [manager1, manager2]) {
      expect(
        await db.notification.count({
          where: { userId: manager.id, type: 'MANAGER_DIGEST' },
        }),
      ).toBe(1)
    }
  })
})
