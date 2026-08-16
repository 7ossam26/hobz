import { describe, expect, it } from 'vitest'

import { DomainError, NotFoundError } from '@/lib/errors'
import {
  deliverNotification,
  getUnreadCount,
  isTypeEnabled,
  listNotifications,
  listPreferences,
  markAllRead,
  markRead,
  setPreference,
} from '@/modules/notification/service'
import { ALL_NOTIFICATION_TYPES } from '@/modules/notification/types'

import { createUser } from '../../factories/db'
import { testDb } from '../../setup/reset'

const db = testDb()

const MESSAGE = {
  title: 'عنوان تجريبي',
  body: 'نص تجريبي',
  entityType: null,
  entityId: null,
  dismissable: true,
}

/**
 * SPEC §8: "Per-user preferences, except two that cannot be disabled" —
 * `TASK_ASSIGNED` and `TASK_OVERDUE`. Enforced in `service.ts.setPreference`,
 * the one write path both the server action and any other caller shares, so
 * these tests exercise it directly rather than through the Next.js action —
 * proving the *rule*, not the wrapper around it (CLAUDE.md invariant 3: the
 * enforcement is the query/service layer, never the UI).
 */
describe('modules/notification/service — تفضيلات الإشعارات', () => {
  it('لا يمكن إيقاف TASK_ASSIGNED', async () => {
    const user = await createUser(db)
    await expect(
      setPreference(db, { userId: user.id, type: 'TASK_ASSIGNED', enabled: false }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('لا يمكن إيقاف TASK_OVERDUE', async () => {
    const user = await createUser(db)
    await expect(
      setPreference(db, { userId: user.id, type: 'TASK_OVERDUE', enabled: false }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('لا تُكتب أي صفوف عند رفض إيقاف نوع إلزامي', async () => {
    const user = await createUser(db)
    await expect(
      setPreference(db, { userId: user.id, type: 'TASK_ASSIGNED', enabled: false }),
    ).rejects.toBeInstanceOf(DomainError)

    const rows = await db.notificationPreference.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(0)
  })

  it('يمكن "تفعيل" نوع إلزامي بلا خطأ (لا تغيير فعلي)', async () => {
    const user = await createUser(db)
    const result = await setPreference(db, {
      userId: user.id,
      type: 'TASK_OVERDUE',
      enabled: true,
    })
    expect(result).toMatchObject({ enabled: true, locked: true })
  })

  it('يوقف نوعًا اختياريًا ويستمر الإيقاف', async () => {
    const user = await createUser(db)
    await setPreference(db, { userId: user.id, type: 'TASK_MENTIONED', enabled: false })

    expect(await isTypeEnabled(db, user.id, 'TASK_MENTIONED')).toBe(false)
    expect(await isTypeEnabled(db, user.id, 'TASK_ASSIGNED')).toBe(true)
  })

  it('صف مفقود يعني مفعّل — بلا حاجة لصفوف بذر لمستخدم جديد', async () => {
    const user = await createUser(db)
    for (const type of ALL_NOTIFICATION_TYPES) {
      expect(await isTypeEnabled(db, user.id, type)).toBe(true)
    }
  })

  it('listPreferences يرجع الأنواع الستة عشر كاملة مع قفل الإلزامي', async () => {
    const user = await createUser(db)
    await setPreference(db, { userId: user.id, type: 'BONUS_GRANTED', enabled: false })

    const prefs = await listPreferences(db, user.id)
    expect(prefs).toHaveLength(ALL_NOTIFICATION_TYPES.length)

    const mandatory = prefs.filter((p) => p.locked)
    expect(mandatory.map((p) => p.type).sort()).toEqual(
      ['TASK_ASSIGNED', 'TASK_OVERDUE'].sort(),
    )
    expect(mandatory.every((p) => p.enabled)).toBe(true)

    const bonus = prefs.find((p) => p.type === 'BONUS_GRANTED')
    expect(bonus).toMatchObject({ enabled: false, locked: false })
  })

  it('إعادة تفعيل نوع اختياري تُحدّث الصف بدل تكراره', async () => {
    const user = await createUser(db)
    await setPreference(db, { userId: user.id, type: 'PAYOUT_PAID', enabled: false })
    await setPreference(db, { userId: user.id, type: 'PAYOUT_PAID', enabled: true })

    const rows = await db.notificationPreference.findMany({
      where: { userId: user.id, type: 'PAYOUT_PAID' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.enabled).toBe(true)
  })
})

describe('modules/notification/service — التسليم يحترم التفضيل', () => {
  it('لا يُنشئ إشعارًا لنوع موقَف', async () => {
    const user = await createUser(db)
    await setPreference(db, { userId: user.id, type: 'TASK_MENTIONED', enabled: false })

    const result = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_MENTIONED',
      message: MESSAGE,
    })

    expect(result).toBeNull()
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(0)
  })

  it('ينشئ إشعارًا لنوع إلزامي حتى لو حاول أحد إيقافه سابقًا', async () => {
    const user = await createUser(db)
    await expect(
      setPreference(db, { userId: user.id, type: 'TASK_ASSIGNED', enabled: false }),
    ).rejects.toBeInstanceOf(DomainError)

    const result = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_ASSIGNED',
      message: MESSAGE,
    })

    expect(result).not.toBeNull()
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(1)
  })

  it('يتجاهل تسليمًا مكرَّرًا بنفس dedupeKey', async () => {
    const user = await createUser(db)
    const first = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_DUE_SOON',
      message: MESSAGE,
      dedupeKey: 'task1:2026-08-20',
    })
    const second = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_DUE_SOON',
      message: MESSAGE,
      dedupeKey: 'task1:2026-08-20',
    })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(1)
  })

  it('تسليمان بلا dedupeKey (أحداث لمرة واحدة) لا يتصادمان', async () => {
    const user = await createUser(db)
    const first = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_APPROVED',
      message: MESSAGE,
    })
    const second = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_APPROVED',
      message: MESSAGE,
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(2)
  })

  it('dedupeKey مختلف لنفس النوع يُنشئ إشعارًا جديدًا', async () => {
    const user = await createUser(db)
    await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_OVERDUE',
      message: MESSAGE,
      dedupeKey: 'task1:2026-08-20',
    })
    const second = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_OVERDUE',
      message: MESSAGE,
      dedupeKey: 'task1:2026-09-01',
    })

    expect(second).not.toBeNull()
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(2)
  })
})

describe('modules/notification/service — القراءة وتعليم القراءة', () => {
  it('markRead يعلّم إشعار المستخدم نفسه فقط', async () => {
    const owner = await createUser(db)
    const stranger = await createUser(db)
    const created = await deliverNotification(db, {
      userId: owner.id,
      type: 'TASK_ASSIGNED',
      message: MESSAGE,
    })
    if (!created) throw new Error('expected a delivered notification')

    await expect(
      markRead(db, { userId: stranger.id, id: created.id }),
    ).rejects.toBeInstanceOf(NotFoundError)

    await markRead(db, { userId: owner.id, id: created.id })
    const row = await db.notification.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.isRead).toBe(true)
    expect(row.readAt).not.toBeNull()
  })

  it('markAllRead يعلّم غير المقروء فقط ويرجع العدد', async () => {
    const user = await createUser(db)
    await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_ASSIGNED',
      message: MESSAGE,
    })
    const second = await deliverNotification(db, {
      userId: user.id,
      type: 'TASK_APPROVED',
      message: MESSAGE,
    })
    if (!second) throw new Error('expected a delivered notification')
    await markRead(db, { userId: user.id, id: second.id })

    const count = await markAllRead(db, user.id)
    expect(count).toBe(1)
    expect(await getUnreadCount(db, user.id)).toBe(0)
  })

  it('listNotifications يرجّع عدد غير المقروء الصحيح مع الصفحات', async () => {
    const user = await createUser(db)
    for (let i = 0; i < 3; i += 1) {
      await deliverNotification(db, {
        userId: user.id,
        type: 'TASK_ASSIGNED',
        message: MESSAGE,
      })
    }

    const page = await listNotifications(db, {
      userId: user.id,
      page: 1,
      pageSize: 2,
      unreadOnly: false,
    })

    expect(page.total).toBe(3)
    expect(page.unreadCount).toBe(3)
    expect(page.items).toHaveLength(2)
  })

  it('عزل بين المستخدمين: لا يرى مستخدم إشعارات غيره', async () => {
    const a = await createUser(db)
    const b = await createUser(db)
    await deliverNotification(db, { userId: a.id, type: 'TASK_ASSIGNED', message: MESSAGE })

    const bPage = await listNotifications(db, {
      userId: b.id,
      page: 1,
      pageSize: 10,
      unreadOnly: false,
    })
    expect(bPage.total).toBe(0)
  })
})
