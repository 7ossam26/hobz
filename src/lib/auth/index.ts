/**
 * lib/auth — authentication and the session seam.
 *
 *   password.ts    bcrypt cost 12, the decoy hash, the password policy check
 *   username.ts    normalisation and validation of the only login handle
 *   rate-limit.ts  the two-layer login throttle (pure logic + two stores)
 *   policy.ts      the security thresholds, read from Settings
 *   ip.ts          the client address, for throttle keys and audit rows
 *   resolve.ts     user id → Actor, always from the database
 *   edge-config.ts the Edge-safe half of the Auth.js config (middleware reads it)
 *   config.ts      the Node half: Credentials provider + DB-aware jwt callback
 *   session.ts     getActor / requireActor / requirePermission
 */

export { auth, handlers, signIn, signOut, updateAuthSession } from './next-auth'
export {
  getActor,
  getSessionState,
  requireActor,
  requireAuth,
  requirePermission,
  type SessionState,
} from './session'
export { LOGIN_ERROR_CODES, LoginFailure } from './config'
export { AUTH_PAGES } from './edge-config'
export { clientIpFromHeaders } from './ip'
export { getPasswordPolicy, getThrottlePolicy } from './policy'
export { resolveActor, type ResolvedUser } from './resolve'
export { appLoginThrottle } from './throttle'
export {
  BCRYPT_COST,
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
  type PasswordPolicy,
} from './password'
export {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isValidUsername,
  normalizeUsername,
  validateUsername,
} from './username'
