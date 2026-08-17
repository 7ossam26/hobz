import { ar } from '@/i18n/ar'

import type { ImportColumnDef } from './columns'

/**
 * modules/import/cells.ts — one raw SheetJS cell value → the shape the
 * entity's own Zod schema (`modules/*\/schema.ts`) expects. Read with
 * `raw: true` (`parse.ts`), a cell arrives as whatever type Excel gave it —
 * string, number, boolean or (with `cellDates: true`) a `Date` — never
 * pre-stringified, so a date typed straight into a General cell survives as a
 * real `Date` instead of a locale-formatted display string.
 */

export function cellText(raw: unknown): string {
  if (raw === undefined || raw === null) return ''
  if (raw instanceof Date) return raw.toISOString()
  return String(raw).trim()
}

/** `''` reads as "not provided" everywhere else in this codebase's schemas — same rule here. */
export function cellOptionalText(raw: unknown): string | null {
  const text = cellText(raw)
  return text === '' ? null : text
}

/** The two-value dropdown every `bool`-kind column uses. `null` covers blank *and* unrecognised text. */
export function cellBool(raw: unknown): boolean | null {
  const text = cellText(raw)
  if (text === ar.common.yes) return true
  if (text === ar.common.no) return false
  return null
}

/** A real `Date` cell passes through; typed text is left for `z.coerce.date()` to parse. `''` → `null`. */
export function cellDateInput(raw: unknown): string | Date | null {
  if (raw instanceof Date) return raw
  const text = cellText(raw)
  return text === '' ? null : text
}

/** The dropdown's Arabic display text → the code value it stands for (`columns.ts`'s `optionValues`). */
export function cellEnumValue(column: ImportColumnDef, raw: unknown): string | null {
  const text = cellText(raw)
  if (text === '') return null
  return column.optionValues?.get(text) ?? null
}

/**
 * `weeklyCapacityHours`/`estimatedHours` are genuinely `z.number()` in their
 * schemas (money fields stay strings — CLAUDE.md invariant 2 — and pass
 * through `cellOptionalText` instead). `ok: false` on unparseable text lets
 * the caller report *that*, in Arabic, rather than let Zod's generic
 * type-mismatch message through unrendered.
 */
export function cellNumber(
  raw: unknown,
): { ok: true; value: number | undefined } | { ok: false } {
  const text = cellText(raw)
  if (text === '') return { ok: true, value: undefined }
  const value = Number(text)
  return Number.isFinite(value) ? { ok: true, value } : { ok: false }
}
