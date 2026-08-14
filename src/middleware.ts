import { NextResponse } from 'next/server'
import NextAuth from 'next-auth'

import { edgeAuthConfig } from '@/lib/auth/edge-config'
import { routeAllowedByToken } from '@/lib/navigation'

/**
 * Middleware — the front door for every `/(app)` route.
 *
 * It imports `edge-config` and nothing else from `lib/auth`, which is what
 * keeps Prisma and bcrypt out of the Edge bundle. The consequence is that it
 * can only see the JWT's copy of the permission set, which may be up to a
 * session old.
 *
 * **That is fine, because this is not the enforcement.** Middleware decides
 * where to send a browser; `assertCan` in the query layer decides what data
 * exists (CLAUDE.md invariant 3). A user whose permission was revoked five
 * minutes ago may still be routed to `/users` here — and will then be met by a
 * `ForbiddenError` from the query, which is the check that counts.
 */

const { auth } = NextAuth(edgeAuthConfig)

const LOGIN_PATH = '/login'
const CHANGE_PASSWORD_PATH = '/change-password'
const DEFAULT_LANDING = '/dashboard'

/** Reachable without a session. Everything else requires one. */
function isPublicPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname.startsWith('/api/auth')
}

export default auth((request) => {
  const { nextUrl } = request
  const pathname = nextUrl.pathname
  const token = request.auth?.user ?? null

  // ── Signed out ──────────────────────────────────────────────────────────
  if (!token) {
    if (isPublicPath(pathname)) return NextResponse.next()

    const url = new URL(LOGIN_PATH, nextUrl.origin)
    // Preserve where they were going, so a bookmarked deep link survives the
    // sign-in round trip.
    if (pathname !== '/') url.searchParams.set('callbackUrl', pathname + nextUrl.search)
    return NextResponse.redirect(url)
  }

  // ── Signed in ───────────────────────────────────────────────────────────
  if (pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL(DEFAULT_LANDING, nextUrl.origin))
  }

  // A forced password change outranks everything. Until it is done, the only
  // reachable page is the one that does it — otherwise an admin reset leaves
  // the user browsing the app with a credential the admin still knows.
  if (token.mustChangePassword && pathname !== CHANGE_PASSWORD_PATH) {
    return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, nextUrl.origin))
  }
  if (!token.mustChangePassword && pathname === CHANGE_PASSWORD_PATH) {
    // Reachable on purpose for a voluntary change; only the forced-flow
    // redirect is undone here.
    return NextResponse.next()
  }

  if (pathname === '/') {
    return NextResponse.redirect(new URL(DEFAULT_LANDING, nextUrl.origin))
  }

  if (!routeAllowedByToken(pathname, token)) {
    const url = new URL(DEFAULT_LANDING, nextUrl.origin)
    url.searchParams.set('denied', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
})

export const config = {
  /**
   * Everything except Next's own assets and the public font files. Matching
   * `/api/auth` is deliberate — the handler needs the session cookie parsed,
   * and `isPublicPath` lets it straight through.
   */
  matcher: ['/((?!_next/static|_next/image|fonts/|favicon.ico|.*\\.(?:png|svg|ico|woff2)$).*)'],
}
