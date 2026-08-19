import { ar } from '@/i18n/ar'
import type { ActionFailure } from '@/lib/action-result'

/**
 * lib/error-message — an `ActionFailure` rendered as Arabic.
 *
 * The counterpart to `lib/action-result`: the server sends a `messageKey` plus
 * `details`, and this resolves the key against `src/i18n/ar.ts` and substitutes
 * the `{placeholder}`s. Keeping the lookup here rather than at each call site
 * is what stops thirty screens each inventing their own guess at what a failure
 * meant — see `users-client.tsx`, which used to infer the cause of a failed
 * deactivation from whether the account happened to be active.
 *
 * An unknown key falls back to `ar.errors.unexpected`. That string is now the
 * honest answer to "the server failed in a way nobody has written a message
 * for" rather than the answer to every failure.
 */

/**
 * Placeholders name the concept; error details name the field that carries it.
 * `{min}` in `validation.passwordTooShort` is filled from `minLength`, which is
 * what `createUser` attaches. Listed rather than inferred so a rename breaks
 * loudly instead of silently rendering a literal `{min}` to a user.
 */
const DETAIL_ALIASES: Record<string, readonly string[]> = {
  min: ['min', 'minLength'],
  max: ['max', 'maxLength'],
  count: ['count'],
  name: ['name', 'fullName', 'nameAr'],
  username: ['username'],
  entity: ['entity'],
}

function lookup(messageKey: string): string | null {
  const value = messageKey
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      ar,
    )
  return typeof value === 'string' ? value : null
}

function interpolate(template: string, details: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, placeholder: string) => {
    const candidates = DETAIL_ALIASES[placeholder] ?? [placeholder]
    for (const key of candidates) {
      const value = details[key]
      if (value !== undefined && value !== null) return String(value)
    }
    return whole
  })
}

/** The Arabic message for a failure returned by a server action. */
export function messageForFailure(failure: ActionFailure): string {
  const template = lookup(failure.messageKey)
  if (template === null) return ar.errors.unexpected
  return failure.details ? interpolate(template, failure.details) : template
}

/**
 * The same, for a `catch` block that has an unknown value in hand. A thrown
 * `ForbiddenError` still arrives message-stripped in production, so the code is
 * all there is to go on — but "you do not have permission" is worth saying, and
 * it is the one access failure a user can act on.
 */
export function messageForError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'messageKey' in error) {
    const candidate = error as { messageKey?: unknown; details?: unknown }
    if (typeof candidate.messageKey === 'string') {
      return messageForFailure({
        ok: false,
        messageKey: candidate.messageKey,
        ...(typeof candidate.details === 'object' && candidate.details !== null
          ? { details: candidate.details as Record<string, unknown> }
          : {}),
      })
    }
  }
  return ar.errors.unexpected
}
