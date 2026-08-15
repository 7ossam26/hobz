import { describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db'
import { ConflictError } from '@/lib/errors'
import { nextProjectCode } from '@/modules/project/code'

/**
 * SPEC §4: "code (auto-generated, editable)". A fake `Db` is enough here —
 * `nextProjectCode` only ever calls `project.count` and `project.findUnique`,
 * and the whole point of testing it in isolation is that a real database
 * should never be needed to prove a counter increments correctly.
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

describe('nextProjectCode', () => {
  it('ينتج أول كود عند عدم وجود مشاريع بعد (الحد الأدنى صفر)', async () => {
    await expect(nextProjectCode(fakeDb({ count: 0 }))).resolves.toBe('PRJ-0001')
  })

  it('يبني الكود التالي من عدد المشاريع الحالي', async () => {
    await expect(nextProjectCode(fakeDb({ count: 41 }))).resolves.toBe('PRJ-0042')
  })

  it('يحافظ على أربع خانات مبطَّنة حتى مع أعداد من خمس خانات', async () => {
    await expect(nextProjectCode(fakeDb({ count: 99998 }))).resolves.toBe('PRJ-99999')
  })

  it('يتخطى الأكواد المستخدمة يدويًا حتى يجد كودًا حرًا', async () => {
    const db = fakeDb({ count: 0, taken: new Set(['PRJ-0001', 'PRJ-0002']) })
    await expect(nextProjectCode(db)).resolves.toBe('PRJ-0003')
  })

  it('يرفع تعارضًا بعد استنفاد كل محاولات إعادة المحاولة العشر', async () => {
    const taken = new Set<string>()
    for (let i = 1; i <= 20; i++) taken.add(`PRJ-${String(i).padStart(4, '0')}`)
    await expect(nextProjectCode(fakeDb({ count: 0, taken }))).rejects.toBeInstanceOf(
      ConflictError,
    )
  })
})
