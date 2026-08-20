import { describe, expect, it } from 'vitest'

import { taskHref } from '@/lib/entity-href'
import { hrefFor } from '@/modules/notification/service'

describe('روابط الكيانات ذات اللوحات', () => {
  it('يربط المهمة بمسار القائمة ومعرّف اللوحة لا بصفحة غير موجودة', () => {
    expect(taskHref('task/with spaces')).toBe('/tasks?task=task%2Fwith%20spaces')
    expect(hrefFor('Task', 't1')).toBe('/tasks?task=t1')
  })

  it('يبقي المستحقات على صفحتها ويتجاهل الكيان غير القابل للفتح', () => {
    expect(hrefFor('Payout', 'p1')).toBe('/my-earnings')
    expect(hrefFor('Task', null)).toBeNull()
    expect(hrefFor(null, null)).toBeNull()
  })
})
