import { describe, expect, it } from 'vitest'

import { isPermission } from '@/lib/rbac'
import { permissionForTransition, TRANSITION_PERMISSION } from '@/modules/task/service'
import { TASK_STATUSES } from '@/modules/task/state-machine'

/**
 * SPEC §6 gives the task domain five separate keys — `task.edit`, `task.assign`,
 * `task.approve`, `task.cancel`, `task.comment` — and the separation only means
 * anything if each edge of the state machine is gated on the right one.
 *
 * `actions.ts` derives from this table rather than repeating literals, so what
 * these tests pin is the table itself: an edge silently moving from
 * `task.approve` to `task.edit` reads like a typo in review and is a privilege
 * escalation in production.
 */

describe('modules/task — صلاحية كل انتقال (SPEC §6)', () => {
  it('يغطي الجدول كل حالات المهمة', () => {
    for (const status of TASK_STATUSES) {
      expect(
        TRANSITION_PERMISSION[status],
        `missing permission for ${status}`,
      ).toBeDefined()
    }

    expect(Object.keys(TRANSITION_PERMISSION).sort()).toEqual([...TASK_STATUSES].sort())
  })

  it('لا يستخدم إلا مفاتيح من كتالوج الصلاحيات', () => {
    for (const status of TASK_STATUSES) {
      expect(isPermission(TRANSITION_PERMISSION[status])).toBe(true)
    }
  })

  it('يحصر الاعتماد وطلب التعديل والإنهاء في صلاحية الاعتماد', () => {
    expect(permissionForTransition('APPROVED')).toBe('task.approve')
    expect(permissionForTransition('REVISION_REQUESTED')).toBe('task.approve')
    expect(permissionForTransition('DONE')).toBe('task.approve')
  })

  it('يحصر الإلغاء في صلاحية الإلغاء وحدها', () => {
    expect(permissionForTransition('CANCELLED')).toBe('task.cancel')
  })

  it('يحصر الإسناد في صلاحية الإسناد', () => {
    expect(permissionForTransition('ASSIGNED')).toBe('task.assign')
  })

  it('يكتفي بصلاحية التعديل لانتقالات سير العمل اليومية', () => {
    expect(permissionForTransition('IN_PROGRESS')).toBe('task.edit')
    expect(permissionForTransition('SUBMITTED')).toBe('task.edit')
    expect(permissionForTransition('IN_REVIEW')).toBe('task.edit')
    expect(permissionForTransition('BLOCKED')).toBe('task.edit')
  })

  it('لا يمنح صلاحية التعديل أيًا من الانتقالات المالية أو النهائية', () => {
    // `task.edit` is the widest of the five and the one most people hold, so
    // the money-touching edges must never be reachable through it.
    const moneyOrTerminal = ['APPROVED', 'DONE', 'CANCELLED'] as const

    for (const status of moneyOrTerminal) {
      expect(permissionForTransition(status)).not.toBe('task.edit')
    }
  })
})
