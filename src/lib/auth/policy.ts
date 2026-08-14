import { getSettings } from '@/lib/settings'

import type { PasswordPolicy } from './password'
import type { ThrottlePolicy } from './rate-limit'

/**
 * lib/auth/policy — the security numbers, read from Settings.
 *
 * CLAUDE.md invariant 4 makes no exception for security thresholds, and it
 * should not: during an incident an operator needs to tighten the lockout, and
 * during a lockout storm they need to loosen it, neither of which should
 * require a redeploy. Nothing in `lib/auth` inlines any of these values.
 */

export async function getThrottlePolicy(): Promise<ThrottlePolicy> {
  const settings = await getSettings([
    'security.maxLoginAttempts',
    'security.loginWindowMinutes',
    'security.lockoutMinutes',
  ])

  return {
    maxAttempts: settings['security.maxLoginAttempts'],
    windowMs: settings['security.loginWindowMinutes'] * 60_000,
    lockoutMs: settings['security.lockoutMinutes'] * 60_000,
  }
}

export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  const minLength = (await getSettings(['security.minPasswordLength']))[
    'security.minPasswordLength'
  ]
  return { minLength }
}
