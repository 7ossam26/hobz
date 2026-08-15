import type { Db } from '@/lib/db'
import { OPEN_TASK_STATUSES } from '@/modules/task/state-machine'

import type { OpenTaskRef } from './types'

/**
 * The open-task lookup, as a port.
 *
 * Phase 1 had to block deactivation while a user still owns work (the phase
 * brief is explicit about the Arabic error listing the tasks), but `Task` was a
 * Phase 4 table. So the *rule* shipped then — guarded, audited, and unit-tested
 * against a lookup that returns real tasks — and only the query behind it was
 * deferred.
 *
 * **Phase 4 filled it in.** `openTasksForUser` below is the real query; the
 * port and its injection point are unchanged, so every test written against
 * the rule in Phase 1 kept its meaning without being touched. That was the
 * whole point of shipping the guard before the table.
 */
export type OpenTaskLookup = (db: Db, userId: string) => Promise<OpenTaskRef[]>

/**
 * Statuses that count as "still owns this": everything except the terminal
 * ones (DONE, CANCELLED) and the unassigned BACKLOG.
 *
 * Re-exported rather than redefined — `modules/task/state-machine.ts` owns the
 * status vocabulary now that it exists, and two lists would eventually disagree
 * about whether, say, a BLOCKED task counts.
 */
export { OPEN_TASK_STATUSES }

/**
 * Tasks this user is still accountable for.
 *
 * Watched tasks deliberately do not count. A watcher has no obligation and
 * earns nothing; blocking an account's deactivation because that person was
 * cc'd on something would make the guard fire on people who owe no work.
 *
 * Tasks on a soft-deleted project are excluded too: nothing at the database
 * level hides them (`deleteProject` only sets `deletedAt`), and a task nobody
 * can open is not work anyone can be asked to hand over first.
 */
export const openTasksForUser: OpenTaskLookup = async (db, userId) => {
  return db.task.findMany({
    where: {
      assigneeId: userId,
      deletedAt: null,
      project: { deletedAt: null },
      status: { in: [...OPEN_TASK_STATUSES] },
    },
    select: { id: true, title: true },
    orderBy: { dueDate: 'asc' },
  })
}

/**
 * Kept for the tests that prove the *rule* rather than the query, and for any
 * caller that genuinely means "ignore open work". Not the default any more.
 */
export const noOpenTasks: OpenTaskLookup = async () => []
