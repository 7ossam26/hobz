import { describe, expect, it } from 'vitest'

import { toTaskQueryFilters, BOOLEAN_FACET_VALUE } from '@/app/(app)/tasks/task-filters'
import { DEFAULT_TABLE_STATE } from '@/components/shared/data-table/state'

describe('toTaskQueryFilters', () => {
  it('يرجع كائنًا فارغًا لحالة جدول افتراضية', () => {
    expect(toTaskQueryFilters(DEFAULT_TABLE_STATE)).toEqual({})
  })

  it('ينقل البحث كما هو دون تعديل', () => {
    const state = { ...DEFAULT_TABLE_STATE, search: 'تصميم' }
    expect(toTaskQueryFilters(state)).toEqual({ search: 'تصميم' })
  })

  it('ينقل كل قوائم التصفية متعددة القيم', () => {
    const state = {
      ...DEFAULT_TABLE_STATE,
      filters: {
        project: ['p1', 'p2'],
        assignee: ['u1'],
        status: ['DONE'],
        priority: ['HIGH', 'URGENT'],
        category: ['design'],
      },
    }
    expect(toTaskQueryFilters(state)).toEqual({
      projectId: ['p1', 'p2'],
      assigneeId: ['u1'],
      status: ['DONE'],
      priority: ['HIGH', 'URGENT'],
      categoryId: ['design'],
    })
  })

  it('يتجاهل قائمة تصفية فارغة بدل إرسال []', () => {
    const state = { ...DEFAULT_TABLE_STATE, filters: { project: [] } }
    expect(toTaskQueryFilters(state)).toEqual({})
  })

  it('يحوّل تصفية overdueOnly المنطقية عند حضور القيمة المتفَق عليها فقط', () => {
    const present = {
      ...DEFAULT_TABLE_STATE,
      filters: { overdueOnly: [BOOLEAN_FACET_VALUE] },
    }
    expect(toTaskQueryFilters(present)).toEqual({ overdueOnly: true })

    const wrongValue = {
      ...DEFAULT_TABLE_STATE,
      filters: { overdueOnly: ['not-the-agreed-value'] },
    }
    expect(toTaskQueryFilters(wrongValue)).toEqual({})
  })

  it('يحوّل تصفية dueThisWeek المنطقية بنفس الطريقة، مستقلة عن overdueOnly', () => {
    const state = {
      ...DEFAULT_TABLE_STATE,
      filters: { dueThisWeek: [BOOLEAN_FACET_VALUE] },
    }
    expect(toTaskQueryFilters(state)).toEqual({ dueThisWeek: true })
  })

  it('يدمج كل أنواع التصفية معًا دون أن يطغى نوع على آخر', () => {
    const state = {
      ...DEFAULT_TABLE_STATE,
      search: 'فيديو',
      filters: {
        status: ['IN_PROGRESS'],
        overdueOnly: [BOOLEAN_FACET_VALUE],
      },
    }
    expect(toTaskQueryFilters(state)).toEqual({
      search: 'فيديو',
      status: ['IN_PROGRESS'],
      overdueOnly: true,
    })
  })
})
