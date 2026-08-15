import type { LeaveLookup } from '@/modules/task/ports'

import { leaveWarningsForWindow } from './service'

/**
 * The real implementation of `modules/task`'s `LeaveLookup` port.
 *
 * It lives in `modules/leave` rather than in `modules/task` on purpose: the
 * task domain declares what it needs to *ask*, and the module that owns leave
 * answers. Wiring the two together is the action layer's job, which is why
 * this file has no Prisma singleton in it either.
 */
export const prismaLeaveLookup: LeaveLookup = {
  approvedLeaveInWindow: (db, args) => leaveWarningsForWindow(db, args),
}
