import { z } from 'zod'

import { ar } from '@/i18n/ar'

/**
 * The backstop for a zod check that carries no explicit `message`.
 *
 * Every schema in `src/modules/*` /`schema.ts` is meant to pass an explicit
 * `ar.validation.*` string to each check (CLAUDE.md: no Arabic literals
 * outside `src/i18n`), so this should rarely fire. But zod's own built-in
 * checks — a missing required field, a type mismatch, an out-of-range number —
 * render in English by default when nobody supplied a message, and nothing in
 * the codebase was catching that gap. This is what stops a validation error
 * from silently surfacing as `"Too small: expected string to have >=1
 * characters"` instead of Arabic.
 *
 * Import this module once, for its side effect, at the boundary of every
 * runtime that can call `.parse()` — the Next.js server (`instrumentation.ts`),
 * the client bundle (`components/shared/toast.tsx`, mounted on every page),
 * and the Vitest setup files. `z.config()` mutates a module-level singleton
 * inside the `zod` package, so one import per runtime is enough; a schema's
 * own explicit `message` still wins over this whenever one is given.
 */
z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type' && (issue.input === undefined || issue.input === null)) {
      return ar.validation.required
    }
    return ar.errors.validation
  },
})
