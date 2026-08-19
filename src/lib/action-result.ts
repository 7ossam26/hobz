import { AppError } from '@/lib/errors'

/**
 * lib/action-result — how a server action reports a *business* failure.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `lib/errors` opens with the promise that the taxonomy is there "so that
 * server actions can map a thrown error to an Arabic message without string
 * matching". Nothing implemented that mapping, and the gap is not cosmetic:
 * Next strips `Error.message` when an error crosses the Server Action boundary
 * in production, so a `DomainError('validation.passwordTooShort')` arrives in
 * the browser as an anonymous failure. Every caller therefore wrote
 * `catch { ar.errors.unexpected }`, and "your password is too short" became
 * "حدث خطأ غير متوقع".
 *
 * The fix is to translate *before* the wire. `toActionResult` catches the typed
 * error on the server and returns the `messageKey` + `details` as plain data,
 * which serialises intact. `lib/error-message` turns that back into Arabic in
 * the browser.
 *
 * ── What is deliberately NOT wrapped ───────────────────────────────────────
 *
 * Only the *body* of an action is wrapped, never `requirePermission` itself.
 * `ForbiddenError` and `UnauthenticatedError` stay thrown, because a permission
 * denial is not a message to render — it is a request that should never have
 * been made, and the RBAC suite asserts it rejects. A non-`AppError` also stays
 * thrown: that is a bug, and swallowing it into a tidy Arabic string is how a
 * bug becomes invisible.
 */

export interface ActionFailure {
  ok: false
  /** Key into `src/i18n/ar.ts`, e.g. `validation.passwordTooShort`. */
  messageKey: string
  details?: Record<string, unknown>
}

export type ActionResult<T> = { ok: true; data: T } | ActionFailure

export function actionFailure(error: AppError): ActionFailure {
  return {
    ok: false,
    messageKey: error.messageKey,
    ...(error.details === undefined ? {} : { details: error.details }),
  }
}

/**
 * Run an action body, converting a typed business failure into serialisable
 * data. Anything that is not an `AppError` — and the two access errors above —
 * is rethrown untouched.
 */
export async function toActionResult<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code !== 'FORBIDDEN' &&
      error.code !== 'UNAUTHENTICATED'
    ) {
      return actionFailure(error)
    }
    throw error
  }
}
