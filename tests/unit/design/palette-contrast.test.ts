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

const THEMES = [
  { name: 'light', vars: LIGHT_VARS },
  { name: 'dark', vars: DARK_VARS },
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

/** Every neutral ground a chip or a piece of body text can land on. */
const SURFACES = ['--surface-sunken', '--surface-base', '--surface-raised'] as const

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

  it('كل لون بيانات له درجة لون مختلفة عن اللون الأساسي البنفسجي', () => {
    // SPEC §9 reserves violet for actions. A data hue drifting into the accent
    // band would make a status chip read as a button.
    const accentHue = parseOklch(resolveColor(LIGHT_VARS, '--violet-600')).h

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
      expect(sorted[i]! - sorted[i - 1]!, `${sorted[i - 1]} → ${sorted[i]}`).toBeGreaterThan(15)
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
    })
  }
})
