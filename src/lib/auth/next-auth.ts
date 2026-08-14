import NextAuth from 'next-auth'

import { authConfig } from './config'

/**
 * The Auth.js singleton.
 *
 * Kept in its own file so that `session.ts` can import `auth` without
 * `index.ts` importing `session.ts` back — the cycle that would otherwise make
 * `requirePermission` undefined at module-evaluation time in exactly the code
 * path that guards every write.
 */
export const {
  handlers,
  auth,
  signIn,
  signOut,
  /** Re-minting the JWT: used only to start and stop impersonation. */
  unstable_update: updateAuthSession,
} = NextAuth(authConfig)
