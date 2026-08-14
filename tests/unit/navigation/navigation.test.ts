import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import {
  NAV_ITEMS,
  ROUTE_PERMISSIONS,
  permissionsForRoute,
  routeAllowedByToken,
  visibleNavItems,
} from '@/lib/navigation'
import { PERMISSIONS, isPermission } from '@/lib/rbac'

import { actingAs, nobody, omnipotentMember, superAdmin } from '../../helpers/auth'

/**
 * Navigation is cosmetic (CLAUDE.md invariant 3) — but a link that renders and
 * then 403s is a worse experience than no link, and an unlinked-but-unguarded
 * route is a hole. Both consumers read the same table, and these tests are what
 * keep them honest about it.
 */

describe('lib/navigation — جدول المسارات', () => {
  it('يستخدم مفاتيح صلاحيات موجودة في الكتالوج', () => {
    // A typo here would silently hide a link forever: `canAny` on an unknown
    // key returns false and nothing complains.
    for (const item of NAV_ITEMS) {
      for (const key of item.permissions) {
        expect(isPermission(key), `unknown permission ${key}`).toBe(true)
        expect(PERMISSIONS).toContain(key)
      }
    }
    for (const entry of ROUTE_PERMISSIONS) {
      for (const key of entry.permissions) {
        expect(isPermission(key), `unknown permission ${key}`).toBe(true)
      }
    }
  })

  it('يوفّر مسمى عربيًا لكل عنصر تنقّل', () => {
    for (const item of NAV_ITEMS) {
      expect(
        Object.keys(ar.nav),
        `missing Arabic label for ${item.labelKey}`,
      ).toContain(item.labelKey)
    }
  })

  it('يحرس كل مسار يحمل بيانات', () => {
    // Every nav item with a permission must also appear in ROUTE_PERMISSIONS,
    // or the sidebar hides it while the URL stays open.
    for (const item of NAV_ITEMS) {
      if (item.permissions.length === 0) continue
      expect(
        permissionsForRoute(item.href),
        `route ${item.href} is linked but unguarded`,
      ).not.toBeNull()
    }
  })
})

describe('lib/navigation — التنقّل حسب الصلاحية', () => {
  it('يخفي كل شيء عن مستخدم غير مسجَّل', () => {
    expect(visibleNavItems(null)).toEqual([])
  })

  it('يبقي لوحة التحكم لأي مستخدم مسجَّل بلا صلاحيات', () => {
    const items = visibleNavItems(nobody())
    expect(items.map((i) => i.href)).toEqual(['/dashboard'])
  })

  it('يُظهر عنصرًا واحدًا فقط لصاحب صلاحية واحدة', () => {
    // Flow #1 in docs/TESTING.md §6 turns on exactly this.
    const items = visibleNavItems(actingAs(['user.view']))
    expect(items.map((i) => i.href)).toEqual(['/dashboard', '/users'])
  })

  it('يُظهر كل شيء لمدير النظام دون تخزين أي مفتاح', () => {
    const admin = superAdmin()
    expect(admin.permissions.size).toBe(0)
    expect(visibleNavItems(admin)).toHaveLength(NAV_ITEMS.length)
  })

  it('يُظهر كل شيء لعضو يحمل كل مفاتيح الكتالوج', () => {
    expect(visibleNavItems(omnipotentMember())).toHaveLength(NAV_ITEMS.length)
  })
})

describe('lib/navigation — صلاحية المسار', () => {
  it('يطابق المسار الفرعي ببادئته', () => {
    expect(permissionsForRoute('/users')).toEqual(['user.view'])
    expect(permissionsForRoute('/users/u_1')).toEqual(['user.view'])
    expect(permissionsForRoute('/users/u_1/edit')).toEqual(['user.view'])
  })

  it('لا يطابق مسارًا يبدأ بنفس الحروف دون فاصل', () => {
    // `/usersettings` must not inherit `/users`.
    expect(permissionsForRoute('/usersettings')).toBeNull()
  })

  it('يترك المسارات غير المحروسة مفتوحة لأي مستخدم مسجَّل', () => {
    expect(permissionsForRoute('/dashboard')).toBeNull()
    expect(permissionsForRoute('/change-password')).toBeNull()
  })

  it('يمنع المسار المحروس عند غياب الرمز', () => {
    expect(routeAllowedByToken('/users', null)).toBe(false)
    // …but an unguarded route with no token is still handled by the sign-in
    // redirect, not by this function.
    expect(routeAllowedByToken('/dashboard', null)).toBe(true)
  })

  it('يسمح لصاحب الصلاحية ويمنع غيره', () => {
    const token = { isSuperAdmin: false, permissions: ['user.view'] }
    expect(routeAllowedByToken('/users', token)).toBe(true)
    expect(routeAllowedByToken('/audit', token)).toBe(false)
    expect(routeAllowedByToken('/roles', token)).toBe(false)
  })

  it('يسمح لمدير النظام بكل مسار دون أي مفتاح مخزَّن', () => {
    const token = { isSuperAdmin: true, permissions: [] }
    for (const entry of ROUTE_PERMISSIONS) {
      expect(routeAllowedByToken(entry.prefix, token)).toBe(true)
    }
  })
})
