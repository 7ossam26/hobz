import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { ForbiddenError, NotImplementedError, UnauthenticatedError } from '@/lib/errors'
import {
  PERMISSIONS,
  SUPER_ADMIN_ROLE,
  assertCan,
  buildActor,
  can,
  canAll,
  canAny,
  isPermission,
  isSuperAdminRole,
  permissionDomain,
  permissionSeedRows,
  scopeProjects,
  scopeTasks,
} from '@/lib/rbac'

import { actingAs, nobody, omnipotentMember, superAdmin } from '../../helpers/auth'

describe('lib/rbac — كتالوج الصلاحيات', () => {
  it('لا يحتوي على مفاتيح مكررة', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })

  it('يلتزم بصيغة domain.action', () => {
    for (const key of PERMISSIONS) {
      expect(key).toMatch(/^[a-z]+(\.[a-zA-Z]+){1,2}$/)
    }
  })

  it('يوفّر وصفًا عربيًا لكل صلاحية', () => {
    // A permission with no Arabic description would render as a blank checkbox
    // in the role editor.
    for (const key of PERMISSIONS) {
      expect(ar.permissions[key], `missing Arabic description for ${key}`).toBeTruthy()
    }
  })

  it('يوفّر مسمى عربيًا لكل نطاق صلاحيات', () => {
    const domains = new Set(PERMISSIONS.map(permissionDomain))
    for (const domain of domains) {
      expect(
        Object.keys(ar.permissionDomains),
        `missing Arabic label for domain ${domain}`,
      ).toContain(domain)
    }
  })

  it('يميّز المفاتيح المعروفة عن غيرها', () => {
    expect(isPermission('task.approve')).toBe(true)
    expect(isPermission('task.destroyEverything')).toBe(false)
    expect(isPermission('')).toBe(false)
  })

  it('يستخرج النطاق من المفتاح', () => {
    expect(permissionDomain('project.view.assigned')).toBe('project')
    expect(permissionDomain('audit.view')).toBe('audit')
  })

  it('ينتج صفوف بذرة كاملة للكتالوج', () => {
    const rows = permissionSeedRows()
    expect(rows).toHaveLength(PERMISSIONS.length)
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
    for (const row of rows) {
      expect(row.descriptionAr).toBeTruthy()
      expect(row.domain).toBe(permissionDomain(row.key))
    }
  })

  it('يشمل كل صلاحية نصّ عليها SPEC §6', () => {
    // Spot-check the money and scoping keys, which the whole product hinges on.
    for (const key of [
      'penalty.reverse',
      'payout.approve',
      'payout.markPaid',
      'ledger.view.own',
      'ledger.view.all',
      'project.view.assigned',
      'task.view.assigned',
      'settings.edit',
      'audit.view',
      'import.run',
    ] as const) {
      expect(PERMISSIONS).toContain(key)
    }
  })
})

describe('lib/rbac — can()', () => {
  it('يمنح صاحب الصلاحية ويمنع من لا يملكها', () => {
    const actor = actingAs(['task.approve'])
    expect(can(actor, 'task.approve')).toBe(true)
    expect(can(actor, 'task.assign')).toBe(false)
  })

  it('يرفض المستخدم غير المسجَّل', () => {
    expect(can(null, 'task.approve')).toBe(false)
    expect(canAny(null, ['task.approve'])).toBe(false)
    expect(canAll(null, ['task.approve'])).toBe(false)
  })

  it('يمنح مدير النظام كل شيء ضمنيًا', () => {
    const admin = superAdmin()
    for (const key of PERMISSIONS) {
      expect(can(admin, key)).toBe(true)
    }
  })

  it('يمنح مدير النظام صلاحيات لم تُضف بعد إلى الكتالوج', () => {
    // SPEC §2: SUPER_ADMIN holds every permission *including future ones*.
    // Casting is the point of the test — a stored permission list would fail here.
    const admin = superAdmin()
    expect(
      can(admin, 'futurephase.doesNotExistYet' as (typeof PERMISSIONS)[number]),
    ).toBe(true)
  })

  it('لا يمنح المستخدم العادي صلاحية غير مخزَّنة له', () => {
    expect(can(nobody(), 'settings.view')).toBe(false)
  })

  it('يتحقق من أي/كل الصلاحيات', () => {
    const actor = actingAs(['penalty.view', 'penalty.create'])
    expect(canAny(actor, ['penalty.reverse', 'penalty.create'])).toBe(true)
    expect(canAny(actor, ['penalty.reverse', 'bonus.reverse'])).toBe(false)
    expect(canAll(actor, ['penalty.view', 'penalty.create'])).toBe(true)
    expect(canAll(actor, ['penalty.view', 'penalty.reverse'])).toBe(false)
    expect(canAll(actor, [])).toBe(true)
  })
})

describe('lib/rbac — assertCan()', () => {
  it('يمرّ بصمت لصاحب الصلاحية', () => {
    expect(() => assertCan(actingAs(['settings.edit']), 'settings.edit')).not.toThrow()
  })

  it('يرمي خطأ عدم تسجيل الدخول قبل خطأ الصلاحية', () => {
    // Order matters: an unauthenticated caller must see "sign in", not
    // "forbidden", or the UI shows the wrong recovery path.
    expect(() => assertCan(null, 'settings.edit')).toThrow(UnauthenticatedError)
  })

  it('يرمي خطأ الصلاحية ويسمّي الصلاحية الناقصة', () => {
    try {
      assertCan(nobody(), 'payout.approve')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError)
      expect((error as ForbiddenError).code).toBe('FORBIDDEN')
      expect((error as ForbiddenError).details?.permission).toBe('payout.approve')
      expect((error as ForbiddenError).messageKey).toBe('errors.forbidden')
    }
  })
})

describe('lib/rbac — بناء الفاعل', () => {
  it('يجمع صلاحيات كل الأدوار في مجموعة واحدة', () => {
    const actor = buildActor({
      id: 'u1',
      username: 'ahmed',
      roleNamesEn: ['DESIGNER', 'REVIEWER'],
      permissionKeys: ['task.view.assigned', 'task.comment', 'task.approve'],
    })
    expect(actor.isSuperAdmin).toBe(false)
    expect(can(actor, 'task.approve')).toBe(true)
    expect(can(actor, 'task.assign')).toBe(false)
  })

  it('يتعرّف على دور مدير النظام بالاسم المحجوز', () => {
    const actor = buildActor({
      id: 'u1',
      username: 'root',
      roleNamesEn: ['DESIGNER', SUPER_ADMIN_ROLE],
      permissionKeys: [],
    })
    expect(actor.isSuperAdmin).toBe(true)
    expect(isSuperAdminRole(SUPER_ADMIN_ROLE)).toBe(true)
    expect(isSuperAdminRole('super_admin')).toBe(false)
    expect(isSuperAdminRole('ADMIN')).toBe(false)
  })

  it('يحفظ هوية المنتحِل عند العرض كمستخدم آخر', () => {
    const actor = buildActor({
      id: 'target',
      username: 'worker',
      roleNamesEn: [],
      permissionKeys: [],
      impersonatorId: 'root',
    })
    expect(actor.impersonatorId).toBe('root')
  })

  it('لا يضيف حقل المنتحِل عند عدم وجوده', () => {
    expect('impersonatorId' in actingAs([])).toBe(false)
  })

  it('يمنح عضوًا يملك كل مفاتيح الكتالوج نفس القدرات دون أن يصبح مدير نظام', () => {
    const member = omnipotentMember()
    expect(member.isSuperAdmin).toBe(false)
    for (const key of PERMISSIONS) {
      expect(can(member, key)).toBe(true)
    }
  })
})

describe('lib/rbac — نطاق الرؤية (المرحلة الأولى)', () => {
  it('يرفض العمل بدل السماح الصامت قبل التنفيذ', () => {
    // A stub returning `{}` would silently grant every user access to every
    // project the moment a caller wired it up. Failing loudly is the safe default.
    expect(() => scopeProjects(nobody())).toThrow(NotImplementedError)
    expect(() => scopeTasks(nobody())).toThrow(NotImplementedError)
  })

  it('يذكر المرحلة المسؤولة عن التنفيذ', () => {
    try {
      scopeProjects(nobody())
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as NotImplementedError).details?.plannedPhase).toBe('Phase 1')
    }
  })
})
