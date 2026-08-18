import { describe, expect, it, vi } from 'vitest'

import { NotFoundError } from '@/lib/errors'
import {
  notificationLatenessEvents,
  notificationTaskEvents,
} from '@/modules/notification/bus'
import { buildManagerDigest, deliverManagerDigest } from '@/modules/notification/digest'
import { managerIds, projectOwnerId } from '@/modules/notification/recipients'
import {
  deliverNotification,
  getUnreadCount,
  isTypeEnabled,
  listNotifications,
  markAllRead,
  markRead,
  setPreference,
} from '@/modules/notification/service'
import type { HealthThresholds } from '@/modules/project/health'

import {
  createProject,
  createTask,
  createUser,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

// `modules/notification/queries.ts` reads its actor through `@/lib/auth/session`
// (Auth.js + a cookie, neither of which exists in a Vitest process). The
// session-mock helper fakes only that boundary — `requireActor` still resolves
// a real `Actor` from a real database row via `actorFor`, so the "no
// permission key required" claim is proven against the actual read path a
// server component calls, not a stand-in for it. Same pattern as
// tests/integration/ledger/permissions.test.ts.
vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))

const { getMyNotifications, getMyUnreadCount } =
  await import('@/modules/notification/queries')

const db = testDb()
const NOW = cairo('2026-08-16T10:00')

const THRESHOLDS: HealthThresholds = {
  overdueTasksThreshold: 3,
  blockedDaysThreshold: 3,
  amberDaysBeforeDue: 3,
}

const MESSAGE = {
  title: 'عنوان تجريبي',
  body: 'نص تجريبي',
  entityType: null,
  entityId: null,
  dismissable: true,
}

/**
 * Axis 11 (docs/TESTING.md §4): a notification's `title`/`body` is composed
 * once, at delivery (`messages.ts` + the event payload), and stored on the
 * row — never re-derived from the entity it points at. Soft-deleting that
 * entity afterward must not touch what was already written, and must not hide
 * the notification itself, which belongs to the recipient's inbox, not to the
 * entity's lifecycle.
 */
describe('modules/notification — بقاء نص الإشعار بعد حذف المرجع ناعمًا', () => {
  it('نص الإشعار وظهوره في القائمة لا يتأثران بحذف المهمة المرجعية لاحقًا', async () => {
    const owner = await createUser(db)
    const submitter = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: submitter.id,
      status: 'SUBMITTED',
    })

    await notificationTaskEvents.emit(db, {
      type: 'TaskSubmitted',
      taskId: task.id,
      projectId: project.id,
      taskTitle: task.title,
      assigneeId: submitter.id,
      submittedById: submitter.id,
      at: NOW,
    })

    const before = await db.notification.findFirstOrThrow({
      where: { userId: owner.id, type: 'TASK_SUBMITTED' },
    })

    await db.task.update({ where: { id: task.id }, data: { deletedAt: NOW } })

    const page = await listNotifications(db, {
      userId: owner.id,
      page: 1,
      pageSize: 10,
      unreadOnly: false,
    })
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      title: before.title,
      body: before.body,
      entityId: task.id,
    })
    expect(page.items[0]?.body).toContain(task.title)
  })

  it('نص الإشعار وظهوره في القائمة لا يتأثران بحذف المشروع المرجعي لاحقًا', async () => {
    const owner = await createUser(db)
    const submitter = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: submitter.id,
      status: 'SUBMITTED',
    })

    await notificationTaskEvents.emit(db, {
      type: 'TaskSubmitted',
      taskId: task.id,
      projectId: project.id,
      taskTitle: task.title,
      assigneeId: submitter.id,
      submittedById: submitter.id,
      at: NOW,
    })

    const before = await db.notification.findFirstOrThrow({
      where: { userId: owner.id, type: 'TASK_SUBMITTED' },
    })

    await db.project.update({ where: { id: project.id }, data: { deletedAt: NOW } })

    const page = await listNotifications(db, {
      userId: owner.id,
      page: 1,
      pageSize: 10,
      unreadOnly: false,
    })
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ title: before.title, body: before.body })
  })
})

/**
 * A real finding from the edge-case sweep, fixed in `recipients.ts`:
 * `projectOwnerId` used to filter only `where: { id: projectId, deletedAt:
 * null }` — the *project's* `deletedAt`, never the owner user row's own
 * `deletedAt`/`isActive`. A project whose owner had since been soft-deleted
 * or deactivated kept notifying that former owner about every new
 * submission/extension/escalation targeting their old project, indefinitely
 * — the same class of bug `usersWithPermission` (the base of `managerIds`)
 * already got right by filtering `deletedAt: null, isActive: true` directly.
 * `projectOwnerId` now does the same via the `owner` relation. These tests
 * pin the fixed behaviour.
 */
describe('modules/notification/recipients — مالك مشروع محذوف/معطّل لا يستقبل إشعارًا جديدًا', () => {
  it('صاحب مشروع محذوف ناعمًا لا يستلم إشعار TaskSubmitted جديدًا', async () => {
    const owner = await createUser(db, { deletedAt: NOW })
    const submitter = await createUser(db)
    // The project itself stays active — only the owner's user row is deleted.
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: submitter.id,
      status: 'SUBMITTED',
    })

    await notificationTaskEvents.emit(db, {
      type: 'TaskSubmitted',
      taskId: task.id,
      projectId: project.id,
      taskTitle: task.title,
      assigneeId: submitter.id,
      submittedById: submitter.id,
      at: NOW,
    })

    expect(
      await db.notification.count({
        where: { userId: owner.id, type: 'TASK_SUBMITTED' },
      }),
    ).toBe(0)
  })

  it('صاحب مشروع معطّل (isActive: false) لا يستلم إشعار TaskSubmitted جديدًا', async () => {
    const owner = await createUser(db, { isActive: false })
    const submitter = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })
    const task = await createTask(db, {
      projectId: project.id,
      assigneeId: submitter.id,
      status: 'SUBMITTED',
    })

    await notificationTaskEvents.emit(db, {
      type: 'TaskSubmitted',
      taskId: task.id,
      projectId: project.id,
      taskTitle: task.title,
      assigneeId: submitter.id,
      submittedById: submitter.id,
      at: NOW,
    })

    expect(
      await db.notification.count({
        where: { userId: owner.id, type: 'TASK_SUBMITTED' },
      }),
    ).toBe(0)
  })

  it('بالمقابل: يستثني مشروعًا محذوفًا ناعمًا هو نفسه — projectOwnerId يرجع null', async () => {
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id, deletedAt: NOW })

    expect(await projectOwnerId(db, project.id)).toBeNull()
  })
})

/**
 * `usersWithPermission` (the base of `managerIds`) filters `deletedAt: null,
 * isActive: true` directly in its `where` — unlike `projectOwnerId` above,
 * this path gets it right. These tests hold that behaviour in place.
 */
describe('modules/notification/recipients — managerIds يستثني المعطّل والمحذوف ناعمًا', () => {
  it('يستثني مديرًا معطّلاً (isActive: false) يملك project.view.all', async () => {
    await seedPermissionCatalog(db)
    const active = await createUserWithPermissions(db, ['project.view.all'])
    const deactivated = await createUserWithPermissions(db, ['project.view.all'], {
      isActive: false,
    })

    const ids = await managerIds(db)
    expect(ids).toContain(active.id)
    expect(ids).not.toContain(deactivated.id)
  })

  it('يستثني مديرًا محذوفًا ناعمًا يملك project.view.all', async () => {
    await seedPermissionCatalog(db)
    const active = await createUserWithPermissions(db, ['project.view.all'])
    const deleted = await createUserWithPermissions(db, ['project.view.all'], {
      deletedAt: NOW,
    })

    const ids = await managerIds(db)
    expect(ids).toContain(active.id)
    expect(ids).not.toContain(deleted.id)
  })

  it('deliverManagerDigest لا يسلّم للمدير المعطّل ولا للمحذوف، ويسلّم للفعّال فقط', async () => {
    await seedPermissionCatalog(db)
    const active = await createUserWithPermissions(db, ['project.view.all'])
    const deactivated = await createUserWithPermissions(db, ['project.view.all'], {
      isActive: false,
    })
    const deleted = await createUserWithPermissions(db, ['project.view.all'], {
      deletedAt: NOW,
    })

    const outcome = await deliverManagerDigest(db, {
      now: NOW,
      healthThresholds: THRESHOLDS,
    })

    expect(outcome.recipients).toBe(1)
    expect(outcome.delivered).toBe(1)
    expect(
      await db.notification.count({
        where: { userId: active.id, type: 'MANAGER_DIGEST' },
      }),
    ).toBe(1)
    for (const excluded of [deactivated, deleted]) {
      expect(
        await db.notification.count({
          where: { userId: excluded.id, type: 'MANAGER_DIGEST' },
        }),
      ).toBe(0)
    }
  })
})

/**
 * Axis 4 (docs/TESTING.md §4): notifications are personal, gated only by
 * authentication (a matching `userId`), never by a permission key — the
 * module's own doc comment on `queries.ts` says so explicitly. These prove it
 * at the service boundary every write/read path shares.
 */
describe('modules/notification — لا حاجة لأي صلاحية للتعامل مع إشعارات المرء نفسه', () => {
  it('مستخدم بلا أي دور أو صلاحية يقرأ إشعاراته ويُعلّمها كمقروءة', async () => {
    const user = await createUser(db) // no roleIds at all
    const created = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_ASSIGNED',
      message: MESSAGE,
    })
    if (!created) throw new Error('expected a delivered notification')

    const page = await listNotifications(db, {
      userId: user.id,
      page: 1,
      pageSize: 10,
      unreadOnly: false,
    })
    expect(page.total).toBe(1)

    await markRead(db, { userId: user.id, id: created.id })
    expect(await getUnreadCount(db, user.id)).toBe(0)

    // Already all read — a legal no-op, not an error.
    expect(await markAllRead(db, user.id)).toBe(0)
  })

  it('markRead على معرف غير موجود لأحد إطلاقًا يرمي NotFoundError لا تجاهلًا صامتًا', async () => {
    const user = await createUser(db)
    await expect(
      markRead(db, { userId: user.id, id: 'this-notification-id-does-not-exist' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('تفضيل مستخدم لا يُسرَّب ولا يؤثر في تفضيل مستخدم آخر', async () => {
    const a = await createUser(db)
    const b = await createUser(db)
    await setPreference(db, { userId: a.id, type: 'TASK_MENTIONED', enabled: false })

    expect(await isTypeEnabled(db, a.id, 'TASK_MENTIONED')).toBe(false)
    expect(await isTypeEnabled(db, b.id, 'TASK_MENTIONED')).toBe(true)
  })

  it('getMyNotifications وgetMyUnreadCount يعملان لممثّل موثّق بلا أي مفتاح صلاحية', async () => {
    const user = await createUser(db)
    const actor = await actorFor(db, user.id)
    // No roles were granted — `resolveActor` still resolves a real actor with
    // an empty permission set, which is exactly the case this queries.ts path
    // must accept: authentication, not authorization.
    expect(actor.permissions.size).toBe(0)

    await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_ASSIGNED',
      message: MESSAGE,
    })
    setSessionActor(actor)

    const page = await getMyNotifications()
    expect(page.total).toBe(1)
    expect(await getMyUnreadCount()).toBe(1)
    clearSessionActor()
  })
})

/**
 * Axis 12 (docs/TESTING.md §4): brand-new/empty state must degrade to zero,
 * never throw.
 */
describe('modules/notification/digest — قاعدة بيانات فارغة تمامًا (بلا مستخدمين أو مشاريع أو مهام)', () => {
  it('buildManagerDigest يرجع أصفارًا بلا أي انهيار', async () => {
    const summary = await buildManagerDigest(db, {
      now: NOW,
      healthThresholds: THRESHOLDS,
    })
    expect(summary).toEqual({
      overdueCount: 0,
      awaitingApprovalCount: 0,
      atRiskProjectCount: 0,
    })
  })

  it('deliverManagerDigest بلا أي مدير لا يحاول التكرار ولا ينهار (recipients: 0)', async () => {
    const outcome = await deliverManagerDigest(db, {
      now: NOW,
      healthThresholds: THRESHOLDS,
    })
    expect(outcome.recipients).toBe(0)
    expect(outcome.delivered).toBe(0)
    expect(await db.notification.count()).toBe(0)
  })
})

/**
 * `bus.ts` looks the referenced task back up by id at processing time
 * (`db.task.findUnique(...).then((task) => task?.title ?? '')`) rather than
 * trusting a title carried on the event. If the row is gone by then — a
 * theoretically possible race between the event firing and the bus adapter
 * running — the fallback empty string must flow through to a delivered
 * notification, not an unhandled rejection.
 */
describe('modules/notification/bus — مهمة اختفت بين إطلاق الحدث ومعالجته', () => {
  it('TaskApproved لمهمة غير موجودة يسلّم بعنوان مهمة فارغ بدل الانهيار', async () => {
    const assignee = await createUser(db)

    await expect(
      notificationTaskEvents.emit(db, {
        type: 'TaskApproved',
        taskId: 'vanished-task-id',
        projectId: 'project-does-not-matter-here',
        assigneeId: assignee.id,
        taskValue: '500.00',
        qualityRating: 5,
        approvedAt: NOW,
        approvedById: 'manager-x',
      }),
    ).resolves.not.toThrow()

    const row = await db.notification.findFirstOrThrow({
      where: { userId: assignee.id, type: 'TASK_APPROVED' },
    })
    expect(row.body).toBe('تم اعتماد مهمة "".')
  })

  it('TaskEscalated لمهمة غير موجودة يسلّم بعنوان مهمة فارغ بدل الانهيار', async () => {
    const owner = await createUser(db)
    const project = await createProject(db, { ownerId: owner.id })

    await expect(
      notificationLatenessEvents.emit(db, {
        type: 'TaskEscalated',
        taskId: 'vanished-task-id',
        projectId: project.id,
        assigneeId: null,
        from: 'NONE',
        to: 'PM',
        lateWorkingDays: 2,
        dueDate: NOW,
        at: NOW,
      }),
    ).resolves.not.toThrow()

    const row = await db.notification.findFirstOrThrow({
      where: { userId: owner.id, type: 'TASK_ESCALATED' },
    })
    expect(row.body).toBe('مهمة "" تجاوزت 2 يوم عمل تأخيرًا وتحتاج متابعتك.')
  })
})

describe('modules/notification — مستخدم لم يُسلَّم له أي إشعار إطلاقًا', () => {
  it('getUnreadCount يرجع صفرًا وlistNotifications يرجع صفحة فارغة، لا خطأ', async () => {
    const user = await createUser(db)

    expect(await getUnreadCount(db, user.id)).toBe(0)

    const page = await listNotifications(db, {
      userId: user.id,
      page: 1,
      pageSize: 10,
      unreadOnly: false,
    })
    expect(page).toMatchObject({ items: [], total: 0, unreadCount: 0 })
  })
})
