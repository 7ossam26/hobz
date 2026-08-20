import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AA_NON_TEXT, AA_TEXT, parseOklch, ratio } from '@tests/helpers/color'

/**
 * The design tokens, checked against WCAG AA — from the stylesheet itself.
 *
 * The phase brief asks for "a 10-hue semantic data palette with WCAG-AA-checked
 * text pairings". A claim like that decays the first time somebody nudges a
 * lightness value to make a chip look nicer, so it is asserted here rather than
 * written in a comment: `src/app/globals.css` is parsed, every pairing the
 * components actually produce is measured, and the numbers have to hold.
 *
 * Reading the CSS instead of a TypeScript copy of the palette is deliberate.
 * A duplicate table would let the two drift and the test would keep passing
 * against a palette nobody ships.
 */

// Comments are stripped up front: the token blocks are heavily commented, and a
// comment sitting between two declarations otherwise swallows the one after it.
const CSS = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** Pull one top-level rule's declarations, matching braces rather than guessing. */
function readBlock(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`Missing CSS block: ${selector}`)

  let depth = 0
  let end = start
  for (let i = CSS.indexOf('{', start); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++
    else if (CSS[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  const body = CSS.slice(CSS.indexOf('{', start) + 1, end)
  const declarations: Record<string, string> = {}
  for (const line of body.split(';')) {
    const match = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s.exec(line)
    if (match) declarations[match[1]!] = match[2]!.replace(/\s+/g, ' ').trim()
  }
  return declarations
}

const LIGHT_VARS = readBlock(':root')
/** Dark overrides only what it changes, exactly as the cascade does. */
const DARK_VARS = { ...LIGHT_VARS, ...readBlock('.dark') }

/** Follow `var(--x)` chains, since half the tokens are aliases by design. */
function resolveColor(vars: Record<string, string>, name: string): string {
  let value = vars[name]
  for (let depth = 0; depth < 8; depth++) {
    if (!value) throw new Error(`Unresolved token: ${name}`)
    const alias = /^var\((--[\w-]+)\)$/.exec(value)
    if (!alias) return value
    value = vars[alias[1]!]
  }
  throw new Error(`Cyclic token: ${name}`)
}

const DARK_THEME_NAME = 'dark'

const THEMES = [
  { name: 'light', vars: LIGHT_VARS },
  { name: DARK_THEME_NAME, vars: DARK_VARS },
] as const

const HUES = [
  'neutral',
  'red',
  'orange',
  'amber',
  'lime',
  'emerald',
  'teal',
  'sky',
  'blue',
  'fuchsia',
  'pink',
] as const

/**
 * Every neutral ground a chip or a piece of body text can land on.
 *
 * `--surface-overlay` was added when sheets, dialogs, popovers and toasts
 * stopped sharing a colour with cards. It is the *lightest* step in dark, so
 * leaving it out meant hue text was being verified against the second-lightest
 * ground it actually sits on — the assertion looked complete and was not.
 */
const SURFACES = [
  '--surface-sunken',
  '--surface-base',
  '--surface-raised',
  '--surface-overlay',
] as const

/**
 * The full ramp, deepest first — `--surface-inset` included, which `SURFACES`
 * leaves out because it is a well rather than a general ground for text.
 *
 * `--surface-field` is deliberately *not* here. It is a role, not a rung: in
 * dark it sits below `sunken`, and in light it is the page colour, which reads
 * as a well only because a card is lighter still. What has to be true of it in
 * both themes is asserted separately below.
 */
const RAMP = [
  '--surface-inset',
  '--surface-sunken',
  '--surface-base',
  '--surface-raised',
  '--surface-overlay',
] as const

/**
 * The minimum separation between two adjacent surfaces.
 *
 * This is the assertion whose absence let the dark theme go flat: the suite
 * checked only that the steps were *ordered*, so a ramp spanning L 0.145→0.216
 * — 1.04:1 between neighbours, invisible on any real display — passed 58 tests.
 * 1.03 is a floor, not a target; the real ramp clears 1.04–1.11.
 */
const MIN_STEP_RATIO = 1.03

describe('ألوان البيانات', () => {
  for (const theme of THEMES) {
    describe(theme.name, () => {
      for (const hue of HUES) {
        it(`نص اللون «${hue}» يحقق تباين AA على خلفيته وعلى كل الأسطح`, () => {
          const text = resolveColor(theme.vars, `--data-${hue}-text`)
          const chip = resolveColor(theme.vars, `--data-${hue}-surface`)

          expect(ratio(text, chip)).toBeGreaterThanOrEqual(AA_TEXT)

          for (const surface of SURFACES) {
            expect(ratio(text, resolveColor(theme.vars, surface))).toBeGreaterThanOrEqual(
              AA_TEXT,
            )
          }
        })

        it(`العلامة المصمتة للون «${hue}» تحقق 3:1 كعنصر رسومي`, () => {
          const solid = resolveColor(theme.vars, `--data-${hue}-solid`)
          const base = resolveColor(theme.vars, '--surface-base')
          expect(ratio(solid, base)).toBeGreaterThanOrEqual(AA_NON_TEXT)
        })
      }
    })
  }

  it('كل لون بيانات له درجة لون مختلفة عن اللون الأساسي', () => {
    // SPEC §9 reserves the accent (Virallap green) for actions. A data hue
    // drifting into the accent band would make a status chip read as a button.
    const accentHue = parseOklch(resolveColor(LIGHT_VARS, '--accent-600')).h

    for (const hue of HUES) {
      if (hue === 'neutral') continue
      const { h, c } = parseOklch(resolveColor(LIGHT_VARS, `--data-${hue}-solid`))
      const distance = Math.min(Math.abs(h - accentHue), 360 - Math.abs(h - accentHue))
      expect(distance, hue).toBeGreaterThan(20)
      expect(c, hue).toBeGreaterThan(0.05)
    }
  })

  it('درجات ألوان البيانات متباعدة بما يكفي للتمييز بينها', () => {
    const angles = HUES.filter((hue) => hue !== 'neutral').map(
      (hue) => parseOklch(resolveColor(LIGHT_VARS, `--data-${hue}-solid`)).h,
    )

    const sorted = [...angles].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      expect(
        sorted[i]! - sorted[i - 1]!,
        `${sorted[i - 1]} → ${sorted[i]}`,
      ).toBeGreaterThan(15)
    }
  })
})

describe('ألوان الواجهة', () => {
  for (const theme of THEMES) {
    describe(theme.name, () => {
      it('النص الأساسي والثانوي يحققان AA على كل الأسطح', () => {
        for (const token of ['--fg', '--fg-muted'] as const) {
          const color = resolveColor(theme.vars, token)
          for (const surface of SURFACES) {
            expect(
              ratio(color, resolveColor(theme.vars, surface)),
              `${token} on ${surface}`,
            ).toBeGreaterThanOrEqual(AA_TEXT)
          }
        }
      })

      it('نص الأزرار يحقق AA على لون الزر', () => {
        expect(
          ratio(
            resolveColor(theme.vars, '--accent-on-solid'),
            resolveColor(theme.vars, '--accent-solid'),
          ),
        ).toBeGreaterThanOrEqual(AA_TEXT)

        expect(
          ratio(
            resolveColor(theme.vars, '--danger-on-solid'),
            resolveColor(theme.vars, '--danger-solid'),
          ),
        ).toBeGreaterThanOrEqual(AA_TEXT)
      })

      it('عنصر التنقل النشط يحقق AA على خلفيته الخفيفة', () => {
        // The sidebar's active item, which is the accent's only tinted use.
        expect(
          ratio(
            resolveColor(theme.vars, '--accent-on-soft'),
            resolveColor(theme.vars, '--accent-soft'),
          ),
        ).toBeGreaterThanOrEqual(AA_TEXT)
      })

      it('حلقة التركيز تحقق 3:1 على سطح الصفحة', () => {
        expect(
          ratio(
            resolveColor(theme.vars, '--accent-ring'),
            resolveColor(theme.vars, '--surface-base'),
          ),
        ).toBeGreaterThanOrEqual(AA_NON_TEXT)
      })

      it('لا يوجد أبيض خالص ولا أسود خالص في أي سطح', () => {
        // SPEC §9: "zinc scale, not pure #fff / #000".
        for (const surface of [...SURFACES, '--surface-inset'] as const) {
          const { l } = parseOklch(resolveColor(theme.vars, surface))
          expect(l, surface).toBeGreaterThan(0)
          expect(l, surface).toBeLessThan(1)
        }
      })

      it('سلّم الأسطح مرتّب: غائر ثم أساسي ثم بارز', () => {
        const lightness = SURFACES.map((s) => parseOklch(resolveColor(theme.vars, s)).l)
        const [sunken, base, raised] = lightness as [number, number, number]

        // Light theme lifts as it comes forward; dark theme does the same, and
        // the assertion is identical because both ramps are ordered the same way.
        expect(sunken).toBeLessThan(base)
        expect(base).toBeLessThan(raised)
      })

      it('السلّم كله مرتّب: الغائر أعمق درجة في كلا الوضعين', () => {
        // `--surface-inset` used to be the *lightest* step in dark and the
        // *darkest* in light — the same token meaning "a well" on one theme and
        // "a lift" on the other, which is worse than having no token.
        const lightness = RAMP.map((s) => parseOklch(resolveColor(theme.vars, s)).l)
        for (let i = 1; i < lightness.length; i += 1) {
          expect(lightness[i - 1]!, `${RAMP[i - 1]} < ${RAMP[i]}`).toBeLessThanOrEqual(
            lightness[i]!,
          )
        }
      })

      it('كل درجة سطح تفصلها عن جارتها مسافة مرئية', () => {
        // Light's `raised` is capped at L 0.993 (pure white is banned), so the
        // top of the light ramp is legitimately tight and `overlay` aliases it.
        // The floor applies wherever two steps are genuinely distinct colours.
        for (let i = 1; i < SURFACES.length; i += 1) {
          const lower = resolveColor(theme.vars, SURFACES[i - 1]!)
          const upper = resolveColor(theme.vars, SURFACES[i]!)
          if (lower === upper) continue
          expect(
            ratio(lower, upper),
            `${SURFACES[i - 1]} → ${SURFACES[i]}`,
          ).toBeGreaterThanOrEqual(MIN_STEP_RATIO)
        }
      })

      it('حقل الإدخال أغمق من البطاقة واللوحة في كلا الوضعين', () => {
        // Whatever step it picks, a field must read as a well against the two
        // surfaces it is ever placed on. It used to be `--surface-base` in both
        // themes — in dark, the exact colour of the page behind the card.
        const field = parseOklch(resolveColor(theme.vars, '--surface-field')).l
        expect(field).toBeLessThan(parseOklch(resolveColor(theme.vars, '--card')).l)
        expect(field).toBeLessThan(
          parseOklch(resolveColor(theme.vars, '--surface-overlay')).l,
        )
      })

      it('الحدود تُرى فعلًا على كل سطح', () => {
        for (const surface of SURFACES) {
          const ground = resolveColor(theme.vars, surface)
          expect(
            ratio(resolveColor(theme.vars, '--line'), ground),
            `--line on ${surface}`,
          ).toBeGreaterThanOrEqual(1.15)
          expect(
            ratio(resolveColor(theme.vars, '--line-strong'), ground),
            `--line-strong on ${surface}`,
          ).toBeGreaterThanOrEqual(1.4)
        }
      })

      if (theme.name === DARK_THEME_NAME) {
        it('الحدود في الوضع الداكن أقوى — الظل لا يعمل هناك', () => {
          // The floor is genuinely stricter in dark, and the reason is a
          // mechanism rather than a preference: light separates surfaces with a
          // shadow *and* a border, dark has only the border and the ramp step,
          // because a black blur on a near-black ground renders as nothing.
          // The old dark `--line` measured 1.21:1 against a card.
          for (const surface of SURFACES) {
            const ground = resolveColor(theme.vars, surface)
            expect(
              ratio(resolveColor(theme.vars, '--line'), ground),
              `--line on ${surface}`,
            ).toBeGreaterThanOrEqual(1.3)
            expect(
              ratio(resolveColor(theme.vars, '--line-strong'), ground),
              `--line-strong on ${surface}`,
            ).toBeGreaterThanOrEqual(1.9)
          }
        })
      }

      it('تلوين الشرائح يبقى مرئيًا فوق أعلى سطح', () => {
        // A chip tint has to sit clear of the *lightest* surface in dark and the
        // *darkest* in light, or a status chip vanishes the moment it is
        // rendered inside a sheet.
        const top = parseOklch(resolveColor(theme.vars, '--surface-overlay')).l
        const bottom = parseOklch(resolveColor(theme.vars, '--surface-sunken')).l

        for (const hue of HUES) {
          const tint = parseOklch(resolveColor(theme.vars, `--data-${hue}-surface`)).l
          if (theme.name === DARK_THEME_NAME) {
            expect(tint, `--data-${hue}-surface vs overlay`).toBeGreaterThan(top)
          } else {
            expect(tint, `--data-${hue}-surface vs sunken`).toBeLessThan(bottom)
          }
        }
      })
    })
  }
})


/**
 * The brand accent, pinned to a value rather than left to "looks about
 * right". `scripts/generate-icons.mjs` once drifted to Tailwind's own
 * violet-600 while the manifest used the project's actual accent — a
 * silent 2% hue split nobody caught because nothing compared them. This
 * asserts the one number every brand surface (button, favicon, manifest,
 * viewport meta) is supposed to agree on.
 */
describe('لون العلامة التجارية', () => {
  it('اللون الأساسي يطابق أخضر Virallap من الشعار', () => {
    const { l, c, h } = parseOklch(resolveColor(LIGHT_VARS, '--accent-solid'))
    expect(h).toBeCloseTo(129, 0)
    expect(l).toBeCloseTo(0.7, 2)
    expect(c).toBeCloseTo(0.183, 2)
  })
})
