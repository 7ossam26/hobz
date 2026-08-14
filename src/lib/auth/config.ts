import { CredentialsSignin, type NextAuthConfig, type User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import Credentials from 'next-auth/providers/credentials'

import { prisma } from '@/lib/db'
import { loginSchema } from '@/modules/auth/schema'
import { authenticate } from '@/modules/auth/service'

import { edgeAuthConfig } from './edge-config'
import { clientIpFromHeaders } from './ip'
import { resolveActor } from './resolve'
import { appLoginThrottle } from './throttle'

/**
 * lib/auth/config — the full, Node-runtime Auth.js configuration.
 *
 * Extends `edge-config.ts` with the two things that cannot exist at the edge:
 * the Credentials provider (bcrypt) and the `jwt` callback (Prisma).
 */

/**
 * Carries *why* a sign-in failed back to the login page.
 *
 * Auth.js normalises a `null` return from `authorize` into a single opaque
 * "credentials" error, which would leave the form unable to distinguish a wrong
 * password from a fifteen-minute lockout — and telling a locked-out user to
 * "check their password" is the kind of small dishonesty that generates support
 * tickets. Subclassing `CredentialsSignin` is the supported way to surface a
 * code; the code itself carries no information a caller did not already supply.
 */
export class LoginFailure extends CredentialsSignin {
  override code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export const LOGIN_ERROR_CODES = {
  invalid: 'invalid_credentials',
  inactive: 'inactive',
  /** Suffixed with the wait in whole minutes: `throttled:12`. */
  throttled: 'throttled',
} as const

async function toSessionUser(userId: string): Promise<User | null> {
  const resolved = await resolveActor(prisma, userId)
  if (!resolved) return null

  const { actor, mustChangePassword } = resolved
  return {
    id: actor.id,
    username: actor.username,
    fullName: actor.fullName,
    isSuperAdmin: actor.isSuperAdmin,
    permissions: [...actor.permissions],
    mustChangePassword,
  }
}

/**
 * Rewrite the token for an impersonation start or stop.
 *
 * The permission check that *authorises* impersonation lives in the server
 * action (`user.impersonate` plus SUPER_ADMIN). This is the second gate: the
 * token is the thing that actually confers access, so the rules are re-checked
 * against the database at the moment it is minted. An action that forgot its
 * check would still fail here.
 */
async function applyImpersonation(token: JWT, target: string | null): Promise<JWT> {
  // ── Stop ────────────────────────────────────────────────────────────────
  if (target === null) {
    if (!token.impersonatorId) return token

    const admin = await toSessionUser(token.impersonatorId)
    // The admin was deactivated or deleted mid-impersonation. Refusing to
    // restore leaves the session as the impersonated user, which is worse;
    // stripping the marker at least ends the elevated state.
    if (!admin?.id) {
      delete token.impersonatorId
      delete token.impersonatorName
      return token
    }

    delete token.impersonatorId
    delete token.impersonatorName
    return {
      ...token,
      uid: admin.id,
      username: admin.username,
      fullName: admin.fullName,
      isSuperAdmin: admin.isSuperAdmin,
      permissions: admin.permissions,
      mustChangePassword: admin.mustChangePassword,
    }
  }

  // ── Start ───────────────────────────────────────────────────────────────
  // Only a real SUPER_ADMIN, and never from inside an existing impersonation:
  // nesting would make "who did this" unanswerable.
  if (!token.isSuperAdmin || token.impersonatorId) return token
  if (target === token.uid) return token

  const impersonated = await toSessionUser(target)
  // `toSessionUser` returns null for a deleted or deactivated user, so this
  // also closes the "view as a disabled account" hole.
  if (!impersonated?.id) return token

  return {
    ...token,
    uid: impersonated.id,
    username: impersonated.username,
    fullName: impersonated.fullName,
    isSuperAdmin: impersonated.isSuperAdmin,
    permissions: impersonated.permissions,
    mustChangePassword: impersonated.mustChangePassword,
    impersonatorId: token.uid,
    impersonatorName: token.fullName,
  }
}

export const authConfig: NextAuthConfig = {
  ...edgeAuthConfig,

  providers: [
    Credentials({
      // No `email` field anywhere in this product (SPEC §2).
      credentials: {
        username: { label: 'username', type: 'text' },
        password: { label: 'password', type: 'password' },
      },

      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw)
        if (!parsed.success) throw new LoginFailure(LOGIN_ERROR_CODES.invalid)

        const ip = clientIpFromHeaders(request.headers)
        const result = await authenticate(prisma, {
          username: parsed.data.username,
          password: parsed.data.password,
          ip,
          throttle: appLoginThrottle,
        })

        if (!result.ok) {
          if (result.reason === 'THROTTLED') {
            throw new LoginFailure(
              `${LOGIN_ERROR_CODES.throttled}:${result.retryAfterMinutes}`,
            )
          }
          throw new LoginFailure(
            result.reason === 'INACTIVE'
              ? LOGIN_ERROR_CODES.inactive
              : LOGIN_ERROR_CODES.invalid,
          )
        }

        const user = await toSessionUser(result.userId)
        if (!user) throw new LoginFailure(LOGIN_ERROR_CODES.inactive)
        return user
      },
    }),
  ],

  callbacks: {
    ...edgeAuthConfig.callbacks,

    async jwt({ token, user, trigger, session }) {
      // Fresh sign-in. Explicitly clears any impersonation marker: signing in
      // must never inherit elevated state from a previous token.
      if (user?.id) {
        delete token.impersonatorId
        delete token.impersonatorName
        return {
          ...token,
          uid: user.id,
          username: user.username,
          fullName: user.fullName,
          isSuperAdmin: user.isSuperAdmin,
          permissions: user.permissions,
          mustChangePassword: user.mustChangePassword,
        }
      }

      if (trigger === 'update' && isImpersonationUpdate(session)) {
        return applyImpersonation(token, session.impersonate)
      }

      // A forced password change is the one flag the middleware must see
      // change without a re-login, since clearing it is what unblocks the app.
      if (trigger === 'update' && token.uid) {
        const refreshed = await toSessionUser(token.uid)
        if (refreshed) token.mustChangePassword = refreshed.mustChangePassword
      }

      return token
    },
  },
}

function isImpersonationUpdate(
  session: unknown,
): session is { impersonate: string | null } {
  return (
    typeof session === 'object' &&
    session !== null &&
    'impersonate' in session &&
    (typeof (session as { impersonate: unknown }).impersonate === 'string' ||
      (session as { impersonate: unknown }).impersonate === null)
  )
}
