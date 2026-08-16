import type { Db } from '@/lib/db'
import type { ExtensionDomainEvent, ExtensionEventBus } from '@/modules/extension/ports'
import type { LatenessDomainEvent, LatenessEventBus } from '@/modules/lateness/ports'
import type { PayoutDomainEvent, PayoutEventBus } from '@/modules/payout/ports'
import type { MoneyDomainEvent, MoneyEventBus } from '@/modules/penalty/ports'
import type { TaskDomainEvent, TaskEventBus } from '@/modules/task/ports'

import {
  bonusGrantedMessage,
  extensionDecidedMessage,
  extensionRequestedMessage,
  moneyReversedMessage,
  payoutApprovedMessage,
  payoutPaidMessage,
  penaltyAppliedMessage,
  taskApprovedMessage,
  taskAssignedMessage,
  taskDueSoonMessage,
  taskEscalatedMessage,
  taskMentionedMessage,
  taskOverdueMessage,
  taskRevisionRequestedMessage,
  taskSubmittedMessage,
} from './messages'
import { managerIds, projectOwnerId, recipientSet, taskWatcherIds } from './recipients'
import { deliverNotification } from './service'

/**
 * modules/notification/bus.ts — the central subscription.
 *
 * CLAUDE.md's phase brief: "subscribe to events centrally — do not scatter
 * notify() calls through services." Every domain module already emits its
 * events through a `ports.ts` boundary (`TaskEventBus`, `MoneyEventBus`,
 * `LatenessEventBus`, `ExtensionEventBus`, `PayoutEventBus`); this file is the
 * *one* real implementation of all five, and the module's actions/job files
 * (`task/actions.ts`, `penalty/port.ts`, `penalty/job.ts`,
 * `calendar/job.ts`, `extension/actions.ts`, `payout/actions.ts`) each wire
 * their one export in at the exact call site the corresponding phase already
 * built. No service file imports this module — the dependency runs one way,
 * from the composition root inward.
 *
 * Each adapter resolves *who* hears about an event (`recipients.ts`), builds
 * the Arabic message (`messages.ts`), and calls `deliverNotification` once per
 * recipient. A recipient who disabled the type, or a duplicate scheduled
 * delivery, is silently skipped inside that one function — a bus never needs
 * to know why a delivery did not happen.
 */

async function fullNameOf(db: Db, userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { fullName: true } })
  return user?.fullName ?? ''
}

export const notificationTaskEvents: TaskEventBus = {
  async emit(db: Db, event: TaskDomainEvent) {
    if (event.type === 'TaskAssigned') {
      await deliverNotification(db, {
        userId: event.assigneeId,
        type: 'TASK_ASSIGNED',
        message: taskAssignedMessage(event),
      })
      return
    }

    if (event.type === 'TaskSubmitted') {
      const owner = await projectOwnerId(db, event.projectId)
      const watchers = await taskWatcherIds(db, event.taskId)
      const submitterName = await fullNameOf(db, event.submittedById)
      const message = taskSubmittedMessage(event, submitterName)
      for (const userId of recipientSet([owner, ...watchers], event.submittedById)) {
        await deliverNotification(db, { userId, type: 'TASK_SUBMITTED', message })
      }
      return
    }

    if (event.type === 'TaskRevisionRequested') {
      const watchers = await taskWatcherIds(db, event.taskId)
      const message = taskRevisionRequestedMessage(event)
      for (const userId of recipientSet(
        [event.assigneeId, ...watchers],
        event.requestedById,
      )) {
        await deliverNotification(db, { userId, type: 'TASK_REVISION_REQUESTED', message })
      }
      return
    }

    if (event.type === 'TaskApproved') {
      if (!event.assigneeId) return
      const watchers = await taskWatcherIds(db, event.taskId)
      const task = await db.task.findUnique({
        where: { id: event.taskId },
        select: { title: true },
      })
      const message = taskApprovedMessage(event, task?.title ?? '')
      for (const userId of recipientSet(
        [event.assigneeId, ...watchers],
        event.approvedById,
      )) {
        await deliverNotification(db, { userId, type: 'TASK_APPROVED', message })
      }
      return
    }

    if (event.type === 'TaskMentioned') {
      const authorName = await fullNameOf(db, event.authorId)
      await deliverNotification(db, {
        userId: event.mentionedUserId,
        type: 'TASK_MENTIONED',
        message: taskMentionedMessage(event, authorName),
      })
    }

    // 'TaskCancelled' has no SPEC §8 entry — the ledger's own bus is the only
    // subscriber that cares (a REVERSAL, which SPEC §8 does surface, via
    // `MoneyReversedEvent` below).
  },
}

export const notificationMoneyEvents: MoneyEventBus = {
  async emit(db: Db, event: MoneyDomainEvent) {
    if (event.type === 'PenaltyApplied') {
      await deliverNotification(db, {
        userId: event.userId,
        type: 'PENALTY_APPLIED',
        message: penaltyAppliedMessage(event),
      })
      return
    }
    if (event.type === 'BonusGranted') {
      await deliverNotification(db, {
        userId: event.userId,
        type: 'BONUS_GRANTED',
        message: bonusGrantedMessage(event),
      })
      return
    }
    await deliverNotification(db, {
      userId: event.userId,
      type: 'MONEY_REVERSED',
      message: moneyReversedMessage(event),
    })
  },
}

export const notificationLatenessEvents: LatenessEventBus = {
  async emit(db: Db, event: LatenessDomainEvent) {
    if (event.type === 'TaskEscalated') {
      const task = await db.task.findUnique({
        where: { id: event.taskId },
        select: { title: true },
      })
      const message = taskEscalatedMessage(event, task?.title ?? '')
      if (!message) return

      const owner = await projectOwnerId(db, event.projectId)
      const recipients =
        event.to === 'ADMIN'
          ? recipientSet([owner, ...(await managerIds(db))])
          : recipientSet([owner])

      for (const userId of recipients) {
        await deliverNotification(db, { userId, type: 'TASK_ESCALATED', message })
      }
      return
    }

    if (event.type === 'TaskDueSoon') {
      if (!event.assigneeId) return
      await deliverNotification(db, {
        userId: event.assigneeId,
        type: 'TASK_DUE_SOON',
        message: taskDueSoonMessage(event),
        dedupeKey: `${event.taskId}:${event.dueDate.toISOString()}`,
      })
      return
    }

    const owner = await projectOwnerId(db, event.projectId)
    const message = taskOverdueMessage(event)
    for (const userId of recipientSet([event.assigneeId, owner])) {
      await deliverNotification(db, {
        userId,
        type: 'TASK_OVERDUE',
        message,
        dedupeKey: `${event.taskId}:${event.dueDate.toISOString()}`,
      })
    }
  },
}

export const notificationExtensionEvents: ExtensionEventBus = {
  async emit(db: Db, event: ExtensionDomainEvent) {
    if (event.type === 'ExtensionRequested') {
      const task = await db.task.findUnique({
        where: { id: event.taskId },
        select: { projectId: true },
      })
      const owner = task ? await projectOwnerId(db, task.projectId) : null
      if (!owner || owner === event.requestedById) return

      const requesterName = await fullNameOf(db, event.requestedById)
      await deliverNotification(db, {
        userId: owner,
        type: 'EXTENSION_REQUESTED',
        message: extensionRequestedMessage(event, requesterName),
      })
      return
    }

    await deliverNotification(db, {
      userId: event.requestedById,
      type: 'EXTENSION_DECIDED',
      message: extensionDecidedMessage(event),
    })
  },
}

export const notificationPayoutEvents: PayoutEventBus = {
  async emit(db: Db, event: PayoutDomainEvent) {
    if (event.type === 'PayoutApproved') {
      await deliverNotification(db, {
        userId: event.userId,
        type: 'PAYOUT_APPROVED',
        message: payoutApprovedMessage(event),
      })
      return
    }
    await deliverNotification(db, {
      userId: event.userId,
      type: 'PAYOUT_PAID',
      message: payoutPaidMessage(event),
    })
  },
}
