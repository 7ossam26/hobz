import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import reviewLedger from '@/i18n/review-ledger.json'
import { walkArabicLeaves } from '@tests/helpers/i18n-walk'


/**
 * "Did the Egyptian-Arabic rewrite actually reach all ~1,700 strings?" is not
 * a question `register.test.ts` can answer — a regex can only see the ~6% of
 * the file with a hard MSA marker. The other 94% is word choice and sentence
 * shape, which only reading can judge, so `src/i18n/review-ledger.json`
 * (`scripts/i18n-ledger.ts`) tracks the review pass itself: one entry per leaf
 * key, `'pending'` until someone has actually read and rewritten it.
 *
 * Two separate claims, deliberately not merged into one assertion: the ledger
 * covers exactly the keys `ar.ts` has (so a renamed or newly-added key can't
 * silently skip the process), and every one of those keys has been reviewed.
 * The first failing without the second would hide a key that was tracked but
 * never actually looked at; the second failing without the first would hide a
 * key that was renamed out from under a stale "reviewed" entry.
 */

const LEDGER = reviewLedger as Record<string, { status: 'pending' | 'reviewed' }>
const AR_KEYS = new Set(walkArabicLeaves(ar).map((leaf) => leaf.path))
const LEDGER_KEYS = new Set(Object.keys(LEDGER))

describe('src/i18n/review-ledger.json — تغطية المراجعة المصرية', () => {
  it('كل مفتاح في ar.ts له سطر في السجل، ولا سطر زائد', () => {
    const missing = [...AR_KEYS].filter((key) => !LEDGER_KEYS.has(key)).sort()
    const stale = [...LEDGER_KEYS].filter((key) => !AR_KEYS.has(key)).sort()

    expect(missing, 'موجودة في ar.ts وغائبة عن السجل — شغّل: tsx scripts/i18n-ledger.ts sync').toEqual(
      [],
    )
    expect(stale, 'موجودة في السجل ولم تعد في ar.ts').toEqual([])
  })

  it('كل مفتاح رُوجع فعليًا', () => {
    const pending = Object.entries(LEDGER)
      .filter(([, entry]) => entry.status !== 'reviewed')
      .map(([key]) => key)
      .sort()

    expect(pending).toEqual([])
  })
})
