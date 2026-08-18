import { ar } from '@/i18n/ar'
import { formatDateTime } from '@/lib/datetime'
import { format as money } from '@/lib/money'
import type {
  ExtensionDecidedEvent,
  ExtensionRequestedEvent,
} from '@/modules/extension/ports'
import type {
  TaskDueSoonEvent,
  TaskEscalatedEvent,
  TaskOverdueEvent,
} from '@/modules/lateness/ports'
import type { PayoutApprovedEvent, PayoutPaidEvent } from '@/modules/payout/ports'
import type {
  BonusGrantedEvent,
  MoneyReversedEvent,
  PenaltyAppliedEvent,
} from '@/modules/penalty/ports'
import type {
  TaskApprovedEvent,
  TaskAssignedEvent,
  TaskMentionedEvent,
  TaskRevisionRequestedEvent,
  TaskSubmittedEvent,
} from '@/modules/task/ports'

/**
 * modules/notification/messages.ts — the one file that turns a domain event
 * into the Arabic sentence a منفّذ reads.
 *
 * Every function here is pure: an event in, a composed notification out. No
 * database access, no side effects — `bus.ts` resolves *who* hears about an
 * event (`recipients.ts`) and calls `deliverNotification` once per recipient;
 * this file only ever decides *what it says*, following the same "one file
 * owns the wording" rule `modules/penalty/breakdown.ts` set for deduction
 * text (CLAUDE.md: "no Arabic string literals in JSX", extended here to "no
 * Arabic string literals outside this file or `i18n/ar.ts`").
 */

export interface ComposedMessage {
  title: string
  body: string
  entityType: 'Task' | 'Payout' | null
  entityId: string | null
  dismissable: boolean
  payload?: Record<string, unknown>
}

const t = ar.notifications.messages

export function taskAssignedMessage(event: TaskAssignedEvent): ComposedMessage {
  return {
    title: t.taskAssigned.title,
    body: t.taskAssigned.body
      .replace('{task}', event.taskTitle)
      .replace('{due}', formatDateTime(event.dueDate)),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

export function taskSubmittedMessage(
  event: TaskSubmittedEvent,
  submitterName: string,
): ComposedMessage {
  return {
    title: t.taskSubmitted.title,
    body: t.taskSubmitted.body
      .replace('{name}', submitterName)
      .replace('{task}', event.taskTitle),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

export function taskRevisionRequestedMessage(
  event: TaskRevisionRequestedEvent,
): ComposedMessage {
  return {
    title: t.taskRevisionRequested.title,
    body: t.taskRevisionRequested.body
      .replace('{task}', event.taskTitle)
      .replace('{due}', formatDateTime(event.newDueDate))
      .replace('{reason}', event.reason),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

export function taskApprovedMessage(
  event: TaskApprovedEvent,
  taskTitle: string,
): ComposedMessage {
  return {
    title: t.taskApproved.title,
    body: t.taskApproved.body.replace('{task}', taskTitle),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

export function taskMentionedMessage(
  event: TaskMentionedEvent,
  authorName: string,
): ComposedMessage {
  return {
    title: t.taskMentioned.title.replace('{name}', authorName),
    body: t.taskMentioned.body
      .replace('{name}', authorName)
      .replace('{task}', event.taskTitle),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

/**
 * `null` for a de-escalation (`to === 'NONE'`) — dropping back to normal is
 * not one of the two notifications the phase brief asks for ("N days →
 * notify PM; M days → notify admin"), and the board already shows the flag
 * gone.
 */
export function taskEscalatedMessage(
  event: TaskEscalatedEvent,
  taskTitle: string,
): ComposedMessage | null {
  if (event.to === 'NONE') return null
  const template = event.to === 'ADMIN' ? t.taskEscalatedAdmin : t.taskEscalatedPm
  return {
    title: template.title,
    body: template.body
      .replace('{task}', taskTitle)
      .replace('{days}', String(event.lateWorkingDays)),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

export function taskDueSoonMessage(event: TaskDueSoonEvent): ComposedMessage {
  return {
    title: t.taskDueSoon.title,
    body: t.taskDueSoon.body
      .replace('{task}', event.taskTitle)
      .replace('{due}', formatDateTime(event.dueDate)),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

export function taskOverdueMessage(event: TaskOverdueEvent): ComposedMessage {
  return {
    title: t.taskOverdue.title,
    body: t.taskOverdue.body
      .replace('{task}', event.taskTitle)
      .replace('{due}', formatDateTime(event.dueDate)),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

/**
 * SPEC §5.4: "Worker gets a non-dismissable notification." `event.dismissable`
 * is `false` on every auto-generated deduction and carries a manual one's
 * decision too — this function never overrides it.
 */
export function penaltyAppliedMessage(event: PenaltyAppliedEvent): ComposedMessage {
  if (event.breakdown) {
    return {
      title: t.penaltyApplied.title,
      body: t.penaltyApplied.body
        .replace('{amount}', money(event.amount))
        .replace('{task}', event.breakdown.taskTitle)
        .replace('{formula}', event.breakdown.formula),
      entityType: 'Task',
      entityId: event.taskId,
      dismissable: event.dismissable,
    }
  }
  return {
    title: t.penaltyAppliedManual.title,
    body: t.penaltyAppliedManual.body.replace('{amount}', money(event.amount)),
    entityType: event.taskId ? 'Task' : null,
    entityId: event.taskId,
    dismissable: event.dismissable,
  }
}

export function bonusGrantedMessage(event: BonusGrantedEvent): ComposedMessage {
  return {
    title: t.bonusGranted.title,
    body: t.bonusGranted.body
      .replace('{amount}', money(event.amount))
      .replace('{reason}', event.reason),
    entityType: 'Payout',
    entityId: null,
    dismissable: event.dismissable,
  }
}

export function moneyReversedMessage(event: MoneyReversedEvent): ComposedMessage {
  return {
    title: t.moneyReversed.title,
    body: t.moneyReversed.body
      .replace('{amount}', money(event.amount))
      .replace('{reason}', event.reason),
    entityType: event.taskId ? 'Task' : 'Payout',
    entityId: event.taskId,
    dismissable: event.dismissable,
  }
}

export function payoutApprovedMessage(event: PayoutApprovedEvent): ComposedMessage {
  return {
    title: t.payoutApproved.title,
    body: t.payoutApproved.body.replace('{amount}', money(event.net)),
    entityType: 'Payout',
    entityId: event.payoutId,
    dismissable: true,
  }
}

export function payoutPaidMessage(event: PayoutPaidEvent): ComposedMessage {
  return {
    title: t.payoutPaid.title,
    body: t.payoutPaid.body.replace('{amount}', money(event.amount)),
    entityType: 'Payout',
    entityId: event.payoutId,
    dismissable: true,
  }
}

export function extensionRequestedMessage(
  event: ExtensionRequestedEvent,
  requesterName: string,
): ComposedMessage {
  return {
    title: t.extensionRequested.title,
    body: t.extensionRequested.body
      .replace('{name}', requesterName)
      .replace('{task}', event.taskTitle)
      .replace('{due}', formatDateTime(event.newDueDate)),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

export function extensionDecidedMessage(event: ExtensionDecidedEvent): ComposedMessage {
  const template =
    event.decision === 'APPROVED' ? t.extensionApproved : t.extensionRejected
  return {
    title: template.title,
    body: template.body
      .replace('{task}', event.taskTitle)
      .replace('{due}', formatDateTime(event.newDueDate)),
    entityType: 'Task',
    entityId: event.taskId,
    dismissable: true,
  }
}

export interface ManagerDigestSummary {
  overdueCount: number
  awaitingApprovalCount: number
  atRiskProjectCount: number
}

export function managerDigestMessage(summary: ManagerDigestSummary): ComposedMessage {
  return {
    title: t.managerDigest.title,
    body: t.managerDigest.body
      .replace('{overdue}', String(summary.overdueCount))
      .replace('{awaiting}', String(summary.awaitingApprovalCount))
      .replace('{atRisk}', String(summary.atRiskProjectCount)),
    entityType: null,
    entityId: null,
    dismissable: true,
    payload: { ...summary },
  }
}
