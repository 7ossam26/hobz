/**
 * scripts/generate-icons.mjs — the PWA icon set, drawn in code.
 *
 * Run with `node scripts/generate-icons.mjs`. Rerun it after changing the
 * accent colour in `src/app/globals.css`; the constants below are that colour.
 *
 * Why generate rather than commit a binary: CLAUDE.md invariant 9 rules out
 * object storage and external APIs, this repo has no design-tool export step,
 * and a checked-in PNG nobody can regenerate is a file that silently rots when
 * the palette moves. Everything here is `zlib` and arithmetic — no dependency,
 * no network, deterministic output.
 *
 * The mark: three descending bars — a ledger — on the Virallap green accent.
 * It is not a logo; it is a shape that reads at 32px in a tab strip and does
 * not pretend to be an illustration (SPEC §9 bans hero art, and a favicon is
 * the smallest possible place to break that rule).
 *
 * The bars are drawn in the accent's own dark ground, not white: white on
 * this green clears only 2.47:1, which is why `--accent-on-solid` in
 * globals.css isn't white either — the logo pairs the green with a dark
 * ground at 6.48:1, and this favicon uses the same pairing.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

/** `--accent-solid` / `--accent-on-solid` in light mode (globals.css). */
const ACCENT = [122, 179, 12, 255]
const ON_ACCENT = [7, 35, 36, 255]
const TRANSPARENT = [0, 0, 0, 0]

// ── PNG encoding ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** `pixels` is RGBA, row-major, `size * size * 4` bytes. */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = None) per scanline. The images are flat colour, so a
  // smarter filter would buy nothing over what deflate already collapses.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function createCanvas(size) {
  const pixels = Buffer.alloc(size * size * 4)
  return {
    size,
    pixels,
    set(x, y, [r, g, b, a]) {
      if (x < 0 || y < 0 || x >= size || y >= size) return
      const offset = (y * size + x) * 4
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = a
    },
  }
}

function fill(canvas, colour) {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) canvas.set(x, y, colour)
  }
}

/** Axis-aligned rounded rectangle, hard-edged (no anti-aliasing needed at these radii). */
function roundedRect(canvas, x0, y0, width, height, radius, colour) {
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      const dx = Math.max(x0 + radius - x, x - (x0 + width - 1 - radius), 0)
      const dy = Math.max(y0 + radius - y, y - (y0 + height - 1 - radius), 0)
      if (dx * dx + dy * dy <= radius * radius) canvas.set(x, y, colour)
    }
  }
}

/**
 * The mark itself, drawn into the square `[inset, size - inset)`.
 *
 * Three bars at 100%, 72% and 44% of the mark's width, right-aligned — the
 * product is RTL, and a ledger that ragged-lefts reads as a Latin list.
 */
function drawMark(canvas, inset) {
  const span = canvas.size - inset * 2
  const barHeight = Math.round(span * 0.17)
  const gap = Math.round(span * 0.115)
  const radius = Math.max(1, Math.round(barHeight / 2))
  const widths = [1, 0.72, 0.44]

  const totalHeight = barHeight * 3 + gap * 2
  let y = inset + Math.round((span - totalHeight) / 2)

  for (const ratio of widths) {
    const width = Math.round(span * ratio)
    // Right-aligned: the bar's end sits at the mark's right edge.
    const x = inset + span - width
    roundedRect(canvas, x, y, width, barHeight, radius, ON_ACCENT)
    y += barHeight + gap
  }
}

function appIcon(size, { maskable = false } = {}) {
  const canvas = createCanvas(size)

  if (maskable) {
    // A maskable icon is cropped to whatever shape the platform likes, so the
    // background must bleed to the edge and the mark must stay inside the
    // 80% safe zone the spec defines.
    fill(canvas, ACCENT)
    drawMark(canvas, Math.round(size * 0.28))
  } else {
    fill(canvas, TRANSPARENT)
    roundedRect(canvas, 0, 0, size, size, Math.round(size * 0.22), ACCENT)
    drawMark(canvas, Math.round(size * 0.26))
  }

  return encodePng(size, canvas.pixels)
}

// ── Output ──────────────────────────────────────────────────────────────────

const OUTPUTS = [
  ['icon-192.png', appIcon(192)],
  ['icon-512.png', appIcon(512)],
  ['maskable-192.png', appIcon(192, { maskable: true })],
  ['maskable-512.png', appIcon(512, { maskable: true })],
  // iOS ignores the manifest's icons and reads this one; it also composites it
  // on an opaque background, so the rounded corners must not be transparent.
  ['apple-touch-icon.png', appIcon(180, { maskable: true })],
  ['icon-32.png', appIcon(32)],
]

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, buffer] of OUTPUTS) {
  writeFileSync(resolve(OUT_DIR, name), buffer)
  console.info(`${name}  ${buffer.length} bytes`)
}
