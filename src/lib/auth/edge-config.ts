import type { NextAuthConfig } from 'next-auth'

/**
 * lib/auth/edge-config — the half of the Auth.js configuration that is safe to
 * run in the Edge runtime.
 *
 * Next.js middleware runs on the Edge, where neither Prisma nor bcrypt exists.
 * So the configuration is split: this file has **no database access and no
 * providers**, and `config.ts` extends it with the Credentials provider and the
 * DB-aware `jwt` callback. `src/middleware.ts` imports only this file, which is
 * what keeps the Prisma client out of the edge bundle entirely.
 *
 * The `jwt` callback here is a pass-through by construction. Middleware calls
 * `auth()` on every protected request, and that invokes the callback — if it
 * did any work, every navigation would pay for it.
 */

/** Sign-in and error both land on the login page; it renders the message. */
export const AUTH_PAGES = {
  signIn: '/login',
  error: '/login',
} as const

/**
 * Twelve hours: one working day plus slack, so nobody is signed out mid-task,
 * and short enough that a walked-away-from laptop is not a standing session.
 */
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60

export const edgeAuthConfig = {
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: { ...AUTH_PAGES },
  // Filled in by config.ts. The Credentials provider needs bcrypt and Prisma,
  // neither of which loads in the Edge runtime.
  providers: [],
  callbacks: {
    /**
     * Copy the token onto the session object.
     *
     * `permissions` here is the edge-visible copy, used by the middleware and
     * by the navigation to decide what to *draw*. It is never the basis of a
     * read or a write — those re-resolve from the database in
     * `lib/auth/resolve` — because a JWT minted before a role change would
     * otherwise keep granting a permission that was just revoked.
     */
    session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid
        session.user.username = token.username
        session.user.name = token.fullName
        session.user.isSuperAdmin = token.isSuperAdmin
        session.user.permissions = token.permissions
        session.user.mustChangePassword = token.mustChangePassword
      }
      if (token.impersonatorId) {
        session.impersonator = {
          id: token.impersonatorId,
          fullName: token.impersonatorName ?? token.impersonatorId,
        }
      }
      return session
    },
  },
  // The app is deployed behind Dokploy's proxy; without this Auth.js rejects
  // the forwarded host and every callback 500s.
  trustHost: true,
} satisfies NextAuthConfig
