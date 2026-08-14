/**
 * tests/helpers/color — OKLCH → sRGB → WCAG contrast.
 *
 * The design tokens in `src/app/globals.css` are written in OKLCH, and the
 * phase brief requires the data palette's text pairings to be AA-checked. A
 * claim like that is worth nothing unless something recomputes it, so this is
 * the arithmetic behind `tests/unit/design/palette-contrast.test.ts` — the
 * palette is verified from the stylesheet itself, not from a copy of it.
 *
 * Conversion chain: OKLCH → OKLab → linear sRGB → gamma-encoded sRGB (clamped
 * to gamut, because that is what a display actually shows) → relative
 * luminance → WCAG 2.1 contrast ratio.
 */

export interface Oklch {
  l: number
  c: number
  /** Hue in degrees. */
  h: number
  /** 0–1. Defaults to 1. */
  alpha?: number
}

/** `oklch(0.541 0.229 288)` or `oklch(0.541 0.229 288 / 40%)`. */
const OKLCH_RE =
  /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i

export function parseOklch(input: string): Oklch {
  const match = OKLCH_RE.exec(input.trim())
  if (!match) throw new Error(`Not an oklch() colour: ${input}`)

  const [, rawL, rawC, rawH, rawA] = match
  const num = (value: string, percentBase: number): number =>
    value.endsWith('%') ? (Number(value.slice(0, -1)) / 100) * percentBase : Number(value)

  return {
    l: num(rawL!, 1),
    c: num(rawC!, 0.4),
    h: Number(rawH!),
    ...(rawA === undefined ? {} : { alpha: num(rawA, 1) }),
  }
}

/** Linear-light sRGB, unclamped — may fall outside [0,1] when out of gamut. */
export function oklchToLinearSrgb({ l: L, c: C, h }: Oklch): [number, number, number] {
  const hRad = (h * Math.PI) / 180
  const a = C * Math.cos(hRad)
  const b = C * Math.sin(hRad)

  const lp = L + 0.3963377774 * a + 0.2158037573 * b
  const mp = L - 0.1055613458 * a - 0.0638541728 * b
  const sp = L - 0.0894841775 * a - 1.291485548 * b

  const l3 = lp ** 3
  const m3 = mp ** 3
  const s3 = sp ** 3

  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ]
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

const encodeGamma = (v: number): number =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055

const decodeGamma = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)

/** Gamma-encoded sRGB in 0–255, clamped into gamut. */
export function oklchToSrgb255(color: Oklch): [number, number, number] {
  return oklchToLinearSrgb(color).map((v) =>
    Math.round(clamp01(encodeGamma(v)) * 255),
  ) as [number, number, number]
}

export function toHex(color: Oklch): string {
  return `#${oklchToSrgb255(color)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * WCAG 2.1 relative luminance. Computed from the *clamped* sRGB triple so that
 * an out-of-gamut OKLCH value is scored as it would render, not as it was
 * specified.
 */
export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(color).map((v) =>
    decodeGamma(clamp01(encodeGamma(v))),
  )
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG 2.1 contrast ratio, 1–21. Order-independent. */
export function contrastRatio(a: Oklch | string, b: Oklch | string): number {
  const ca = typeof a === 'string' ? parseOklch(a) : a
  const cb = typeof b === 'string' ? parseOklch(b) : b
  const la = relativeLuminance(ca)
  const lb = relativeLuminance(cb)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Rounded down to 2dp, so a reported 4.50 is never a rounded-up 4.495. */
export function ratio(a: Oklch | string, b: Oklch | string): number {
  return Math.floor(contrastRatio(a, b) * 100) / 100
}

/** WCAG AA: 4.5:1 for body text, 3:1 for large text and non-text graphics. */
export const AA_TEXT = 4.5
export const AA_LARGE_TEXT = 3
export const AA_NON_TEXT = 3
