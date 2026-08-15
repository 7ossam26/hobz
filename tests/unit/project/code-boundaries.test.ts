import { describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db'
import { nextProjectCode } from '@/modules/project/code'

/**
 * Axis 1 — boundaries. `tests/unit/project/code.test.ts` already proves the
 * five-digit case works (count: 99998 → PRJ-99999). This file targets the
 * exact transition point the 4-digit padding is defined against: the running
 * count crossing from 9999 to 10000, where `padStart(4, '0')` stops adding
 * zeros and must NOT truncate the fifth digit.
 */
function fakeDb(options: { count?: number; taken?: Set<string> } = {}): Db {
  const taken = options.taken ?? new Set<string>()
  return {
    project: {
      count: vi.fn(async () => options.count ?? 0),
      findUnique: vi.fn(async ({ where }: { where: { code: string } }) =>
        taken.has(where.code) ? { id: 'existing' } : null,
      ),
    },
  } as unknown as Db
}

describe('nextProjectCode — حد الانتقال من أربع إلى خمس خانات', () => {
  it('عند وصول العدّاد إلى 9999 ينتج الكود التالي بخمس خانات كاملة دون بتر', async () => {
    await expect(nextProjectCode(fakeDb({ count: 9999 }))).resolves.toBe('PRJ-10000')
  })

  it('العدّاد عند 9998 لا يزال يُنتج أربع خانات مبطَّنة بالأصفار', async () => {
    await expect(nextProjectCode(fakeDb({ count: 9998 }))).resolves.toBe('PRJ-9999')
  })
})
