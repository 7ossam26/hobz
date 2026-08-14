import type { Session } from 'next-auth'

import { updateAuthSession } from './next-auth'

/**
 * Start or stop impersonation by re-minting the JWT.
 *
 * `unstable_update` is typed as `Partial<Session>`, but this payload is not a
 * session patch — it is a command, consumed by the `trigger === 'update'`
 * branch of the `jwt` callback in `config.ts`, which reads `impersonate` and
 * rewrites the whole token from the database. Auth.js passes the value through
 * opaquely, so the type is simply wrong for this use.
 *
 * The cast is confined to this one function rather than repeated at each call
 * site, so there is exactly one place that has to know both ends of the
 * protocol — and one place to fix if Auth.js ever types the update channel
 * properly.
 */
export async function setImpersonation(targetUserId: string | null): Promise<void> {
  await updateAuthSession({ impersonate: targetUserId } as unknown as Session)
}

/**
 * Re-mint the token without changing identity. Used after a password change,
 * so the `mustChangePassword` flag the middleware routes on stops being stale.
 */
export async function refreshSessionToken(): Promise<void> {
  await updateAuthSession({} as unknown as Session)
}
