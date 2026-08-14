import { foldArabicDigits } from '@/lib/phone'

/**
 * lib/search — Arabic-aware text matching for the command palette and every
 * `ابحث…` box in the product.
 *
 * The problem this solves is not fuzziness, it is that Arabic has several
 * spellings of the same name and users type whichever is fastest. A manager
 * looking for **أحمد** types `احمد`; someone looking for **فاطمة** types
 * `فاطمه`; someone looking for **يحيى** types `يحيي`. A `LIKE '%…%'` finds
 * none of them, and the user concludes the person is not in the system.
 *
 * So every string — the query and the thing being searched — is reduced to one
 * canonical form first (docs/TESTING.md §4 axis 10):
 *
 *   - diacritics (tashkeel) and tatweel removed:  مُحَمَّد → محمد،  مـحـمـد → محمد
 *   - every alef and hamza carrier folded:        أ إ آ ٱ → ا،  ؤ → و،  ئ → ي
 *   - alef maqsura folded to ya:                  يحيى → يحيي
 *   - ta marbuta folded to ha:                    فاطمة → فاطمه
 *   - Persian/Urdu lookalikes folded:             ک → ك،  ی → ي
 *   - Arabic-Indic digits folded to Western:      ٢٠٢٦ → 2026
 *   - Latin case and accents folded:              Ahmed → ahmed
 *
 * Folding is deliberately **lossy and one-way**. `فاطمه` and `فاطمة` become the
 * same key, which is the entire point; nothing in this module is ever used to
 * store, compare for equality, or display a name.
 *
 * Characters below are written as `\u` escapes rather than as themselves. The
 * repo bans Arabic literals outside `src/i18n` because Arabic *copy* belongs in
 * one file — but a normalisation table is character data, not copy, and
 * eslint.config.mjs exempts this path for exactly that reason.
 */

/** Tashkeel, superscript alef, and the Quranic annotation marks. */
const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭ]/g
/** Tatweel/kashida — a typographic stretch, never a letter. */
const TATWEEL = /ـ/g
/** Latin combining marks left behind by NFKD. */
const COMBINING_MARKS = /[̀-ͯ]/g

/**
 * Letter folds, applied after diacritics are stripped.
 *
 * Bare hamza (ء) is dropped rather than mapped: users omit it as often as they
 * type it (`سماء` / `سما`), and dropping it makes both spellings meet.
 */
const LETTER_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  /** آ أ إ ٱ ٲ ٳ ٵ → ا */
  [/[آأإٱٲٳٵ]/g, 'ا'],
  /** ؤ → و */
  [/ؤ/g, 'و'],
  /** ئ ى ی ې → ي */
  [/[ئىیې]/g, 'ي'],
  /** ء ٴ → dropped */
  [/[ءٴ]/g, ''],
  /** ة → ه */
  [/ة/g, 'ه'],
  /** ک ڪ → ك */
  [/[کڪ]/g, 'ك'],
  /** ھ ہ ە → ه */
  [/[ھہە]/g, 'ه'],
]

/** Anything that is not a letter or digit becomes a separator. */
const NON_SEARCHABLE = /[^\p{L}\p{N}]+/gu

/**
 * The canonical form. Idempotent: `normalizeArabic(normalizeArabic(x))` equals
 * `normalizeArabic(x)`, which is what lets a caller store a normalised column
 * and query it with the same function.
 */
export function normalizeArabic(input: string): string {
  if (!input) return ''

  // NFKD splits أ into ا + hamza-above, which the diacritic strip then removes.
  // The explicit folds below still matter: pre-composed text that skipped
  // decomposition — which is most of what arrives from a phone keyboard —
  // reaches them intact.
  let text = input.normalize('NFKD').replace(COMBINING_MARKS, '')

  text = text.replace(ARABIC_DIACRITICS, '').replace(TATWEEL, '')

  for (const [pattern, replacement] of LETTER_FOLDS) {
    text = text.replace(pattern, replacement)
  }

  text = foldArabicDigits(text).toLowerCase()

  return text.replace(NON_SEARCHABLE, ' ').trim().replace(/\s+/g, ' ')
}

/** The query split into terms. Every term must match, in any order. */
export function tokenize(query: string): string[] {
  const normalized = normalizeArabic(query)
  return normalized ? normalized.split(' ') : []
}

/** Relevance bands. Higher wins; the numbers only have to order correctly. */
const SCORE = {
  exact: 1000,
  prefix: 800,
  wordPrefix: 600,
  contains: 400,
  allTokens: 200,
} as const

/**
 * How well `text` answers `query`, or `null` for no match. An empty query
 * matches everything with score 0 — the palette's resting state lists commands
 * rather than nothing.
 *
 * The bands exist so that typing `مه` in the palette puts **المهام** above a
 * project called **تجديد موقع مها** — a plain `includes` would order those by
 * whatever the database felt like returning.
 */
export function scoreMatch(text: string, query: string): number | null {
  const tokens = tokenize(query)
  if (tokens.length === 0) return 0

  const haystack = normalizeArabic(text)
  if (!haystack) return null

  const needle = tokens.join(' ')

  // Shorter matches are better matches: six characters found inside a
  // six-character string is an exact hit; the same six inside a paragraph is not.
  const brevity = 100 / (100 + haystack.length)

  if (haystack === needle) return SCORE.exact + brevity
  if (haystack.startsWith(needle)) return SCORE.prefix + brevity
  if (haystack.includes(` ${needle}`)) return SCORE.wordPrefix + brevity
  if (haystack.includes(needle)) return SCORE.contains + brevity

  // Out-of-order and multi-word: `احمد علي` finds `علي احمد`.
  const words = haystack.split(' ')
  const everyTokenFound = tokens.every(
    (token) => haystack.includes(token) || words.some((word) => word.startsWith(token)),
  )
  return everyTokenFound ? SCORE.allTokens + brevity : null
}

export function matches(text: string, query: string): boolean {
  return scoreMatch(text, query) !== null
}

export interface RankOptions<T> {
  /** Every string worth searching on this item. */
  fields: (item: T) => ReadonlyArray<string | null | undefined>
  limit?: number
}

/**
 * Rank `items` against `query`, dropping non-matches.
 *
 * An item scores as its best field, so a user whose *username* matches sorts
 * with the strength of that match even though their full name did not. Ties
 * keep input order — callers pass data already sorted the way the screen wants
 * it, and a stable sort is what stops a list reshuffling under the cursor as
 * the user types.
 */
export function rankMatches<T>(
  items: readonly T[],
  query: string,
  { fields, limit }: RankOptions<T>,
): T[] {
  const scored: Array<{ item: T; score: number; index: number }> = []

  items.forEach((item, index) => {
    let best: number | null = null
    for (const field of fields(item)) {
      if (!field) continue
      const score = scoreMatch(field, query)
      if (score !== null && (best === null || score > best)) best = score
    }
    if (best !== null) scored.push({ item, score: best, index })
  })

  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  const ranked = scored.map((entry) => entry.item)
  return limit === undefined ? ranked : ranked.slice(0, limit)
}
