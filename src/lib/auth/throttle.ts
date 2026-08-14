import { prisma } from '@/lib/db'

import { getThrottlePolicy } from './policy'
import {
  createDbThrottleStore,
  createLoginThrottle,
  memoryThrottleStore,
  type LoginThrottle,
} from './rate-limit'

/**
 * The application's login limiter: the process-local map first, the
 * `login_throttles` table second.
 *
 * A singleton, because the in-memory layer is only useful if every request in
 * this process shares it. Tests construct their own with fake stores and a
 * frozen clock rather than reaching for this one.
 */
export const appLoginThrottle: LoginThrottle = createLoginThrottle({
  stores: [memoryThrottleStore, createDbThrottleStore(prisma)],
  policy: getThrottlePolicy,
})
