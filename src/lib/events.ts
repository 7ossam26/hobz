import type { Db } from '@/lib/db'

/**
 * lib/events — where domain events get more than one subscriber.
 *
 * Every module's `ports.ts` (`TaskEventBus`, `MoneyEventBus`,
 * `LatenessEventBus`, `ExtensionEventBus`, `PayoutEventBus`) is one emitter
 * wired to exactly one bus at its call site — Phase 7's `ledgerTaskEvents` is
 * `task.actions.ts`'s `events:` argument, for instance. Phase 9 needs a
 * *second* subscriber on several of those same buses (the notification
 * module), and CLAUDE.md's phase brief is explicit that this must not turn
 * into scattered `notify()` calls inside services: "subscribe to events
 * centrally."
 *
 * `fanOut` is that one place. It composes any number of buses that share the
 * `{ emit(db, event) }` shape into one, so a call site keeps passing a single
 * `events:` argument and every module that cares about the event still runs —
 * in the order listed, so a ledger write always lands before the notification
 * that describes it.
 *
 * Generic over the event type rather than importing any one `*DomainEvent`
 * union, so it works unmodified for every bus shape in the codebase and never
 * needs to change when a new one is added.
 */
export interface EventBus<TEvent> {
  emit(db: Db, event: TEvent): Promise<void>
}

export function fanOut<TEvent>(buses: ReadonlyArray<EventBus<TEvent>>): EventBus<TEvent> {
  return {
    async emit(db, event) {
      for (const bus of buses) await bus.emit(db, event)
    },
  }
}
