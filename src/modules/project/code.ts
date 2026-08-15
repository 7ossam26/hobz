import type { Db } from '@/lib/db'
import { ConflictError } from '@/lib/errors'

/**
 * modules/project/code.ts — the auto-generated project code (SPEC §4:
 * "code (auto-generated, editable)").
 *
 * `PRJ-0001`, `PRJ-0002`, … — sequential and language-agnostic. Project names
 * are Arabic, and deriving a short Latin code from an Arabic string needs a
 * transliteration table this product has no other use for; a plain counter is
 * shorter, never collides on two similarly-named projects, and the field is
 * editable immediately after, per the SPEC, for whoever wants "ACME-01"
 * instead.
 *
 * Codes are never reused: the count includes soft-deleted projects, and the
 * unique constraint is the real backstop under concurrency — two managers
 * creating a project in the same instant will race past `nextProjectCode`,
 * but `createProject` retries once on a unique-constraint conflict
 * (`service.ts`), which is enough at the SPEC §2 scale of "up to ~100 people".
 */

const CODE_PREFIX = 'PRJ'
const CODE_PAD = 4

function formatCode(n: number): string {
  return `${CODE_PREFIX}-${String(n).padStart(CODE_PAD, '0')}`
}

export async function nextProjectCode(db: Db): Promise<string> {
  const count = await db.project.count()
  let n = count + 1

  // Bounded retry against a stale count (a project created between the count
  // and this loop, or one whose code was hand-edited to collide with a future
  // sequence number). `createProject`'s own retry is the real backstop.
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = formatCode(n)
    const exists = await db.project.findUnique({ where: { code }, select: { id: true } })
    if (!exists) return code
    n += 1
  }

  throw new ConflictError('errors.unexpected')
}
