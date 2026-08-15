import { ar } from '@/i18n/ar'
import { formatDateKey } from '@/lib/datetime'
import type { AssignmentLeaveWarning } from '@/modules/task/ports'

/**
 * The Phase 6 assignment warning, as one line of Arabic.
 *
 * Shared by both assignment dialogs — the first assignment out of BACKLOG and
 * the SPEC M4 reassignment — because a manager should read the same sentence
 * whichever door they came through. The dates are Cairo date keys, formatted
 * without ever becoming a `Date`: leave has no time of day, and converting
 * would re-introduce the timezone question the key exists to avoid.
 */
export function leaveWarningMessage(warning: AssignmentLeaveWarning): string {
  return ar.leave.assignWarning
    .replace('{name}', warning.userFullName)
    .replace('{from}', formatDateKey(warning.startDate))
    .replace('{to}', formatDateKey(warning.endDate))
}
