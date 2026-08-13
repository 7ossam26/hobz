/**
 * Typed error taxonomy. Every layer throws these — never bare `Error` — so that
 * server actions can map a thrown error to an Arabic message without string
 * matching, and so tests can assert on a code rather than on prose.
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'DOMAIN'
  | 'NOT_IMPLEMENTED'

export class AppError extends Error {
  readonly code: AppErrorCode
  /**
   * Key into `src/i18n/ar.ts`. The error carries the key, not the Arabic text —
   * that keeps the "no Arabic literals outside i18n" rule true in lib/ too.
   */
  readonly messageKey: string
  readonly details?: Record<string, unknown>

  constructor(code: AppErrorCode, messageKey: string, details?: Record<string, unknown>) {
    super(`${code}: ${messageKey}`)
    this.name = 'AppError'
    this.code = code
    this.messageKey = messageKey
    if (details !== undefined) this.details = details
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super('UNAUTHENTICATED', 'errors.unauthenticated')
    this.name = 'UnauthenticatedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(permission?: string) {
    super(
      'FORBIDDEN',
      'errors.forbidden',
      permission === undefined ? undefined : { permission },
    )
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', 'errors.notFound', { entity, ...(id ? { id } : {}) })
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(messageKey: string, details?: Record<string, unknown>) {
    super('CONFLICT', messageKey, details)
    this.name = 'ConflictError'
  }
}

/** Business-rule violation: an illegal state transition, a negative payout, … */
export class DomainError extends AppError {
  constructor(messageKey: string, details?: Record<string, unknown>) {
    super('DOMAIN', messageKey, details)
    this.name = 'DomainError'
  }
}

/**
 * Thrown by the Phase 0 seams that later phases fill in. Deliberately loud: a
 * stub must never silently return a plausible-looking value, because a silent
 * zero in `lateWorkingDays()` is a wrong payout.
 */
export class NotImplementedError extends AppError {
  constructor(what: string, plannedPhase: string) {
    super('NOT_IMPLEMENTED', 'errors.notImplemented', { what, plannedPhase })
    this.name = 'NotImplementedError'
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
