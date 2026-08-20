import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { walkArabicLeaves } from '@tests/helpers/i18n-walk'

/**
 * The Egyptian-Arabic register gate for `src/i18n/ar.ts`.
 *
 * A regex can only see the mechanical fraction of "does this read as Modern
 * Standard Arabic" — the accusative tanween, a few fossilised MSA
 * function-words, Arabic-Indic digits. A rewrite of 1,700+ strings by hand
 * still needs a machine-checkable floor under it, even though the harder 90%
 * (word choice, sentence shape) can only be judged by reading — see
 * `coverage.test.ts` for how that part is tracked instead.
 *
 * Every check here is a CLAUDE.md invariant or an explicit product decision,
 * not a style opinion: Western numerals only, no literal whitespace bugs, no
 * silently-renamed `{placeholder}` tokens (which would break
 * `lib/error-message.ts`'s interpolation without any type error to catch it).
 */

const LEAVES = walkArabicLeaves(ar)

/** Leaves that legitimately need a trailing/leading space or are empty by design. */
const WHITESPACE_EXEMPT = new Set<string>([
  // The Arabic list-comma. Joining with a plain ',' reads wrong in RTL, and
  // the space after it is part of the character most Arabic typography uses.
  'common.listSeparator',
])

/** xlsx template sample cells that are deliberately blank ("leave this empty"). */
const EMPTY_EXEMPT = new Set<string>([
  'import.columns.users.monthlySalary.sample',
  'import.columns.projects.code.sample',
  'import.columns.projects.name.hint',
  'import.columns.projects.engagementType.hint',
  'import.columns.projects.status.sample',
  'import.columns.tasks.title.hint',
  'import.columns.tasks.description.sample',
  'import.columns.tasks.categoryLabel.sample',
  'import.columns.tasks.taskValue.sample',
  'designSystem.samples.people.3.phone',
])

describe('src/i18n/ar.ts — قواعد عامة', () => {
  it('لا أرقام هندية عربية — الأرقام لاتينية فقط (CLAUDE.md)', () => {
    const offenders = LEAVES.filter((leaf) => /[\u0660-\u0669\u06F0-\u06F9]/.test(leaf.value))
    expect(offenders.map((leaf) => leaf.path)).toEqual([])
  })

  it('لا فراغ زائد في البداية أو النهاية', () => {
    const offenders = LEAVES.filter(
      (leaf) => !WHITESPACE_EXEMPT.has(leaf.path) && /^\s|\s$/.test(leaf.value),
    )
    expect(offenders.map((leaf) => leaf.path)).toEqual([])
  })

  it('لا مسافات مزدوجة', () => {
    const offenders = LEAVES.filter((leaf) => / {2,}/.test(leaf.value))
    expect(offenders.map((leaf) => leaf.path)).toEqual([])
  })

  it('لا نص فارغ خارج عيّنات القالب المقصودة', () => {
    const offenders = LEAVES.filter(
      (leaf) => leaf.value === '' && !EMPTY_EXEMPT.has(leaf.path),
    )
    expect(offenders.map((leaf) => leaf.path)).toEqual([])
  })
})

/**
 * Hard, regex-detectable Modern Standard Arabic markers. Measured against the
 * pre-rewrite file: 94 of 1,669 strings (6%) tripped one of these — the floor
 * these tests hold, not the whole of what "Egyptian" means. See
 * `coverage.test.ts` for the part that has to be read, not matched.
 */
const MSA_MARKERS: Array<[name: string, pattern: RegExp]> = [
  ['tanween accusative (ـً)', /[\u0621-\u064A]\u064B/],
  ['جارٍ (MSA active participle)', /جارٍ/],
  ['يجب أن / يتعيّن', /يجب\s+أن|يتعيّ?ن|يتوجب/],
  // `\b` does not fire around Arabic letters (they are outside `\w`), so the
  // boundary is spelled out with whitespace/start/end instead.
  ['الذي / التي / الذين', /(^|\s)(الذين|الذي|التي)(\s|$)/],
  ['لم/لن يتم', /ل[من]\s+يتم/],
  ['يرجى / الرجاء', /ي\u064F?رجى|الرجاء/],
]

describe('src/i18n/ar.ts — لا علامات فصحى واضحة', () => {
  for (const [name, pattern] of MSA_MARKERS) {
    it(`خالٍ من: ${name}`, () => {
      const offenders = LEAVES.filter((leaf) => pattern.test(leaf.value))
      expect(offenders.map((leaf) => `${leaf.path}: ${leaf.value}`)).toEqual([])
    })
  }
})

/**
 * Every `{token}` currently used across `ar.ts`, extracted once and pinned
 * here. `lib/error-message.ts`'s `DETAIL_ALIASES` and ~26 other call sites
 * substitute these by name — a rename during the copy rewrite would leave a
 * literal `{oldName}` on screen with no type error to catch it. Adding a
 * genuinely new placeholder is fine; it just has to be added here too, in the
 * same commit, so the addition is visible in review.
 */
const KNOWN_PLACEHOLDERS = new Set([
  'amount',
  'atRisk',
  'awaiting',
  'basis',
  'cause',
  'count',
  'created',
  'days',
  'due',
  'formula',
  'from',
  'grace',
  'hours',
  'invalid',
  'list',
  'max',
  'maxMb',
  'min',
  'minutes',
  'n',
  'name',
  'overdue',
  'page',
  'pages',
  'perMonth',
  'reason',
  'round',
  'salary',
  'skipped',
  'task',
  'to',
  'total',
  'value',
])

describe('src/i18n/ar.ts — العناصر النائبة {placeholder} معروفة', () => {
  it('كل {placeholder} مستخدَم موجود في القائمة المعتمدة', () => {
    const unknown = new Map<string, string>()
    for (const leaf of LEAVES) {
      for (const match of leaf.value.matchAll(/\{(\w+)\}/g)) {
        const token = match[1]!
        if (!KNOWN_PLACEHOLDERS.has(token)) unknown.set(token, leaf.path)
      }
    }
    expect([...unknown.entries()]).toEqual([])
  })
})
