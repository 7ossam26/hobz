import { describe, expect, it } from 'vitest'

import {
  isEmptyScope,
  projectScopeMode,
  scopeProjects,
  scopeTasks,
  taskScopeMode,
} from '@/lib/rbac'

import { actingAs, nobody, omnipotentMember, superAdmin } from '../../helpers/auth'

/**
 * SPEC §6, the scoping rule, verbatim:
 *
 *   "*.view.all sees everything; *.view.assigned is limited to projects where
 *    the user is owner/member, or tasks where they are assignee/watcher.
 *    Enforcement lives in lib/rbac and is applied in QUERIES, not in the UI."
 *
 * These assertions are written against that sentence. They check the *shape* of
 * the returned Prisma fragment, because the shape is the contract Phase 3 and
 * Phase 4 will spread into their `where` clauses — and a fragment that quietly
 * became `{}` is the failure mode that matters: it would not throw, it would
 * not look wrong in a diff, and it would return every project in the agency to
 * a freelancer.
 */

describe('lib/rbac — نطاق المشاريع', () => {
  it('يرى صاحب صلاحية العرض الشامل كل المشاريع غير المحذوفة', () => {
    const scope = scopeProjects(actingAs(['project.view.all']))
    expect(scope).toEqual({ deletedAt: null })
    expect(isEmptyScope(scope)).toBe(false)
  })

  it('يقصر صاحب صلاحية العرض المحدود على ما يملكه أو يشارك فيه', () => {
    const actor = actingAs(['project.view.assigned'], { id: 'u_ahmed' })

    expect(scopeProjects(actor)).toEqual({
      deletedAt: null,
      OR: [{ ownerId: 'u_ahmed' }, { members: { some: { userId: 'u_ahmed' } } }],
    })
  })

  it('يمنع من لا يملك أي صلاحية عرض من رؤية أي مشروع', () => {
    // The critical case: the fragment must match nothing, not be absent.
    // `{}` here would mean "no filter", which is the opposite of the intent.
    const scope = scopeProjects(nobody())
    expect(scope).toEqual({ deletedAt: null, id: { in: [] } })
    expect(isEmptyScope(scope)).toBe(true)
  })

  it('يمنع المستخدم غير المسجَّل تمامًا', () => {
    expect(isEmptyScope(scopeProjects(null))).toBe(true)
    expect(projectScopeMode(null)).toBe('none')
  })

  it('يمنح مدير النظام العرض الشامل دون أن يحمل المفتاح صراحةً', () => {
    // SPEC §2: SUPER_ADMIN holds every permission implicitly. A scope helper
    // that only consulted the stored set would lock the super admin out.
    const admin = superAdmin()
    expect(admin.permissions.size).toBe(0)
    expect(projectScopeMode(admin)).toBe('all')
    expect(scopeProjects(admin)).toEqual({ deletedAt: null })
  })

  it('يغلّب العرض الشامل على العرض المحدود عند اجتماعهما', () => {
    // A user can legitimately hold both — an admin role plus a worker role.
    // The wider grant must win, or adding a role would remove access.
    const actor = actingAs(['project.view.all', 'project.view.assigned'])
    expect(projectScopeMode(actor)).toBe('all')
    expect(scopeProjects(actor)).toEqual({ deletedAt: null })
  })

  it('لا يخلط صلاحية المهام بصلاحية المشاريع', () => {
    // `task.view.all` must not open the project list. They are separate keys in
    // the catalog precisely so that a reviewer can see every task without
    // seeing every client engagement.
    const actor = actingAs(['task.view.all'])
    expect(projectScopeMode(actor)).toBe('none')
    expect(isEmptyScope(scopeProjects(actor))).toBe(true)
  })

  it('يحترم الحذف الناعم افتراضيًا ويسمح بتجاوزه صراحةً', () => {
    // CLAUDE.md invariant 8. The override exists for an admin restore screen
    // and has to be asked for by name.
    expect(scopeProjects(actingAs(['project.view.all']))).toHaveProperty(
      'deletedAt',
      null,
    )
    expect(
      scopeProjects(actingAs(['project.view.all']), { includeDeleted: true }),
    ).toEqual({})
  })

  it('يبقي الحذف الناعم مطبَّقًا على النطاق المحدود', () => {
    const scope = scopeProjects(actingAs(['project.view.assigned'], { id: 'u1' }))
    expect(scope).toHaveProperty('deletedAt', null)
  })
})

describe('lib/rbac — نطاق المهام', () => {
  it('يرى صاحب صلاحية العرض الشامل كل المهام غير المحذوفة', () => {
    expect(scopeTasks(actingAs(['task.view.all']))).toEqual({ deletedAt: null })
  })

  it('يقصر صاحب صلاحية العرض المحدود على ما أُسند إليه أو يتابعه', () => {
    const actor = actingAs(['task.view.assigned'], { id: 'u_sara' })

    expect(scopeTasks(actor)).toEqual({
      deletedAt: null,
      OR: [{ assigneeId: 'u_sara' }, { watchers: { some: { userId: 'u_sara' } } }],
    })
  })

  it('لا يوسّع نطاق المهام بصلاحية المشاريع', () => {
    // A deliberate, literal reading of SPEC §6: owning a project does NOT by
    // itself reveal every task in it. Widening this is a policy change and
    // belongs in the SPEC first. Restrictive is the safe direction to be wrong.
    const owner = actingAs(['project.view.all', 'task.view.assigned'], { id: 'u_pm' })

    expect(scopeTasks(owner)).toEqual({
      deletedAt: null,
      OR: [{ assigneeId: 'u_pm' }, { watchers: { some: { userId: 'u_pm' } } }],
    })
  })

  it('يمنع من لا يملك أي صلاحية عرض مهام', () => {
    expect(scopeTasks(nobody())).toEqual({ deletedAt: null, id: { in: [] } })
    expect(taskScopeMode(nobody())).toBe('none')
  })

  it('يمنح مدير النظام كل المهام ضمنيًا', () => {
    expect(taskScopeMode(superAdmin())).toBe('all')
    expect(scopeTasks(superAdmin())).toEqual({ deletedAt: null })
  })

  it('يمنح العضو الذي يحمل كل مفاتيح الكتالوج النطاق الشامل', () => {
    const member = omnipotentMember({ id: 'u_all' })
    expect(member.isSuperAdmin).toBe(false)
    expect(taskScopeMode(member)).toBe('all')
    expect(projectScopeMode(member)).toBe('all')
  })
})

describe('lib/rbac — isEmptyScope', () => {
  it('يميّز النطاق المغلق عن النطاق المفتوح', () => {
    expect(isEmptyScope({ id: { in: [] } })).toBe(true)
    expect(isEmptyScope({ deletedAt: null })).toBe(false)
    expect(isEmptyScope({})).toBe(false)
    // A populated `in` is a real filter, not an empty scope.
    expect(isEmptyScope({ id: { in: ['p1'] } })).toBe(false)
    expect(isEmptyScope({ id: 'p1' })).toBe(false)
  })
})
