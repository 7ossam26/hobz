import { describe, expect, it } from 'vitest'

import { PERMISSIONS, buildActor, can, type Permission } from '@/lib/rbac'

import { actingAs, nobody } from '../../helpers/auth'

/**
 * docs/TESTING.md §4 axis 4 — permissions, taken to its exhaustive conclusion.
 *
 * `tests/integration/rbac/action-permissions.test.ts` proves the *actions* are
 * gated. This file proves the thing underneath them: that `can()` is
 * default-deny for every single key in the catalog, and that granting one key
 * grants exactly that key and nothing adjacent to it.
 *
 * Parameterised over `PERMISSIONS` on purpose. A hand-written list would go
 * stale the moment Phase 7 adds `payout.markPaid`; this fails loudly instead.
 */

describe('lib/rbac — مصفوفة الصلاحيات كاملة', () => {
  it.each([...PERMISSIONS])('يمنع %s افتراضيًا لمن لا يملكها', (permission) => {
    expect(can(nobody(), permission)).toBe(false)
  })

  it.each([...PERMISSIONS])('يمنح %s لمن مُنحت له وحدها', (permission) => {
    expect(can(actingAs([permission]), permission)).toBe(true)
  })

  it.each([...PERMISSIONS])('لا تمنح %s أي صلاحية أخرى في الكتالوج', (permission) => {
    // The isolation property. Without it, a `startsWith`-style check in `can`
    // would let `project.view` quietly satisfy `project.view.all`.
    const actor = actingAs([permission])
    const leaked = PERMISSIONS.filter((p) => p !== permission && can(actor, p))
    expect(leaked).toEqual([])
  })
})

describe('lib/rbac — الصلاحيات المتجاورة', () => {
  /**
   * Pairs where holding the first must NOT imply the second. Each is a case
   * where a careless implementation — prefix matching, a `.view` that implies
   * `.all`, a "read implies write" shortcut — would be invisible in review and
   * visible in an audit.
   */
  const NEIGHBOURS: ReadonlyArray<readonly [Permission, Permission]> = [
    ['user.view', 'user.edit'],
    ['user.edit', 'user.deactivate'],
    ['user.edit', 'user.impersonate'],
    ['user.view', 'user.resetPassword'],
    ['role.view', 'role.manage'],
    ['project.view.assigned', 'project.view.all'],
    ['task.view.assigned', 'task.view.all'],
    ['task.view.all', 'task.approve'],
    ['task.edit', 'task.assign'],
    ['ledger.view.own', 'ledger.view.all'],
    ['penalty.view', 'penalty.create'],
    ['penalty.create', 'penalty.reverse'],
    ['bonus.create', 'bonus.reverse'],
    ['payout.view', 'payout.approve'],
    ['payout.approve', 'payout.markPaid'],
    ['payout.generate', 'payout.approve'],
    ['settings.view', 'settings.edit'],
    ['report.view', 'report.export'],
    ['leave.view', 'leave.manage'],
    ['client.view', 'client.manage'],
  ] as const

  it.each(NEIGHBOURS)('لا تمنح %s صلاحية %s', (held, forbidden) => {
    const actor = actingAs([held])
    expect(can(actor, held)).toBe(true)
    expect(can(actor, forbidden)).toBe(false)
  })

  it('لا تمنح الصلاحية الأوسع الأضيقَ ضمنيًا', () => {
    // Deliberate: `view.all` does NOT imply `view.assigned`. They are separate
    // keys and the scope helpers branch on `all` first, so nothing depends on
    // the implication — asserting it stays absent keeps that true.
    const actor = actingAs(['project.view.all'])
    expect(can(actor, 'project.view.all')).toBe(true)
    expect(can(actor, 'project.view.assigned')).toBe(false)
  })
})

describe('lib/rbac — اتحاد صلاحيات الأدوار', () => {
  it('يجمع صلاحيات دورين في مجموعة واحدة', () => {
    // A person is a designer AND a reviewer. The effective set is the union,
    // never the intersection — otherwise adding a role would remove access.
    const actor = buildActor({
      id: 'u1',
      username: 'ahmed',
      roleNamesEn: ['DESIGNER', 'REVIEWER'],
      permissionKeys: ['task.view.assigned', 'task.comment', 'task.approve'],
    })

    expect(can(actor, 'task.comment')).toBe(true)
    expect(can(actor, 'task.approve')).toBe(true)
    expect(can(actor, 'task.assign')).toBe(false)
  })

  it('يتحمّل تكرار المفتاح بين دورين', () => {
    // Two roles both granting `task.comment` must not produce a duplicate that
    // some later `.length` check could misread.
    const actor = buildActor({
      id: 'u1',
      username: 'ahmed',
      roleNamesEn: ['A', 'B'],
      permissionKeys: ['task.comment', 'task.comment', 'task.approve'],
    })

    expect(actor.permissions.size).toBe(2)
    expect(can(actor, 'task.comment')).toBe(true)
  })

  it('لا يمنح الدور بلا صلاحيات شيئًا', () => {
    // A role with nothing ticked is legitimate — it is how an account is parked
    // without deactivating it.
    const actor = buildActor({
      id: 'u1',
      username: 'ahmed',
      roleNamesEn: ['PARKED'],
      permissionKeys: [],
    })

    expect(actor.permissions.size).toBe(0)
    for (const key of PERMISSIONS) expect(can(actor, key)).toBe(false)
  })

  it('لا يجعل حمل كل المفاتيح المستخدمَ مديرَ نظام', () => {
    // The distinction matters: SUPER_ADMIN is recognised by role NAME, and it
    // is what protects the reserved role and gates impersonation. Accumulating
    // every key must not be a back door into it.
    const actor = buildActor({
      id: 'u1',
      username: 'ahmed',
      roleNamesEn: ['EVERYTHING'],
      permissionKeys: [...PERMISSIONS],
    })

    expect(actor.isSuperAdmin).toBe(false)
  })
})
