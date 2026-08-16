import type { Db } from '@/lib/db'

/**
 * modules/extension/ports.ts — the notification boundary, in the same shape
 * Phase 4 used for `TaskEventBus`, Phase 6 for `LatenessEventBus` and Phase 8
 * for `MoneyEventBus`: this module knows *that* an extension request was
 * raised or decided, and delivering an in-app notification is Phase 9's.
 */

/** SPEC §8's "extension requested" — told to whoever decides it. */
export interface ExtensionRequestedEvent {
  type: 'ExtensionRequested'
  extensionId: string
  taskId: string
  taskTitle: string
  requestedById: string
  oldDueDate: Date
  newDueDate: Date
  reason: string
  at: Date
}

/** SPEC §8's "extension decided" — told to whoever asked. */
export interface ExtensionDecidedEvent {
  type: 'ExtensionDecided'
  extensionId: string
  taskId: string
  taskTitle: string
  requestedById: string
  decision: 'APPROVED' | 'REJECTED'
  newDueDate: Date
  decidedById: string
  at: Date
}

export type ExtensionDomainEvent = ExtensionRequestedEvent | ExtensionDecidedEvent

export interface ExtensionEventBus {
  emit(db: Db, event: ExtensionDomainEvent): Promise<void>
}

export const noopExtensionEvents: ExtensionEventBus = {
  emit: async () => {},
}
