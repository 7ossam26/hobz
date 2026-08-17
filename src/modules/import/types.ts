import type { ImportEntity } from './schema'

/**
 * modules/import/types.ts — what the preview/confirm read paths return. Never
 * the raw parsed row or the Zod-validated payload: those carry every field
 * (including a new user's plaintext password), and the dry-run response is
 * rendered straight into the page.
 */

export interface ImportRowError {
  /** The column key the error belongs to (`modules/import/columns.ts`). */
  field: string
  /** Ready to render — "<column header>: <problem>", already Arabic. */
  message: string
}

export type ImportRowAction = 'create' | 'update' | 'invalid'

export interface ImportRowResult {
  /** 1-based, counting the header row as row 1 — the row a spreadsheet user sees. */
  rowNumber: number
  action: ImportRowAction
  /** A short human-readable label for the row — the natural key plus a name. */
  summary: string
  errors: ImportRowError[]
}

export interface ImportPreviewDto {
  entity: ImportEntity
  totalRows: number
  toCreate: number
  toUpdate: number
  invalid: number
  rows: ImportRowResult[]
}

export interface ImportConfirmResultDto {
  entity: ImportEntity
  created: number
  updated: number
  skipped: number
}

/**
 * `actions.ts`'s return shape — a value, never a thrown error, for anything
 * the file itself can be wrong about (wrong template, empty, too many rows).
 * A thrown `AppError` loses its message when it crosses the Server Action
 * boundary in production (`modules/auth/actions.ts` hit this first); this
 * file's action follows the same `{ok, messageKey, params}` convention it
 * established rather than repeat the mistake.
 */
export interface ImportActionMessage {
  /** A key into `src/i18n/ar.ts`, e.g. `'import.errors.wrongTemplate'`. */
  messageKey: string
  params?: Record<string, string | number>
}

export type ImportPreviewActionResult =
  { ok: true; preview: ImportPreviewDto } | ({ ok: false } & ImportActionMessage)

export type ImportConfirmActionResult =
  { ok: true; result: ImportConfirmResultDto } | ({ ok: false } & ImportActionMessage)
