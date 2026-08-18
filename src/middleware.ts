import { NextResponse } from 'next/server'
import NextAuth from 'next-auth'

import { edgeAuthConfig } from '@/lib/auth/edge-config'
import { routeAllowedByToken } from '@/lib/navigation'
import { contentSecurityPolicy, createNonce } from '@/lib/security-headers'

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
/**
 * The PWA's offline fallback (`public/sw.js`). Public because the service
 * worker pre-fetches it at install time and, more to the point, because a page
 * whose entire content is "there is no network" has nothing to protect.
 */
const OFFLINE_PATH = '/offline'
/**
 * The container healthcheck (`src/app/api/health/route.ts`), which is designed
 * unauthenticated and says so — it reports `ok` or `degraded` and no schema,
 * version or count.
 *
 * It was being redirected to `/login` until Phase 12, which is worse than it
 * sounds: Docker's `HEALTHCHECK` follows the redirect, gets a 200 from the
 * login page, and reports a healthy container **without ever touching
 * Postgres** — exactly the failure the endpoint exists to detect.
 */
const HEALTH_PATH = '/api/health'

/** Reachable without a session. Everything else requires one. */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === LOGIN_PATH ||
    pathname === OFFLINE_PATH ||
    pathname === HEALTH_PATH ||
    pathname.startsWith('/api/auth')
  )
}

export default auth((request) => {
  const { nextUrl } = request
  const pathname = nextUrl.pathname
  const token = request.auth?.user ?? null

  // Before anything else, including the forced-password-change redirect: the
  // healthcheck must answer identically whoever asks, or a container's health
  // starts depending on which session happens to probe it.
  if (pathname === HEALTH_PATH) return NextResponse.next()

  /**
   * One nonce per request, and the CSP built around it.
   *
   * The header is set on the **request** as well as the response: that copy is
   * how Next.js discovers the nonce and stamps it onto its own bootstrap
   * script tags. Without it `'strict-dynamic'` would block the app's own
   * JavaScript, which is a blank page rather than a subtle bug — and is
   * exactly what `tests/e2e/flow-1-access-control.spec.ts` would catch.
   */
  const nonce = createNonce()
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  /** `NextResponse.next()`, with the request headers Next needs to see. */
  const proceed = (): NextResponse => {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('content-security-policy', csp)
    return response
  }

  /** A redirect carries the policy too — its body is a short HTML document. */
  const redirect = (url: URL): NextResponse => {
    const response = NextResponse.redirect(url)
    response.headers.set('content-security-policy', csp)
    return response
  }

  // ── Signed out ──────────────────────────────────────────────────────────
  if (!token) {
    if (isPublicPath(pathname)) return proceed()

    const url = new URL(LOGIN_PATH, nextUrl.origin)
    // Preserve where they were going, so a bookmarked deep link survives the
    // sign-in round trip.
    if (pathname !== '/') url.searchParams.set('callbackUrl', pathname + nextUrl.search)
    return redirect(url)
  }

  // ── Signed in ───────────────────────────────────────────────────────────
  if (pathname === LOGIN_PATH) {
    return redirect(new URL(DEFAULT_LANDING, nextUrl.origin))
  }

  // A forced password change outranks everything. Until it is done, the only
  // reachable page is the one that does it — otherwise an admin reset leaves
  // the user browsing the app with a credential the admin still knows.
  if (token.mustChangePassword && pathname !== CHANGE_PASSWORD_PATH) {
    return redirect(new URL(CHANGE_PASSWORD_PATH, nextUrl.origin))
  }
  if (!token.mustChangePassword && pathname === CHANGE_PASSWORD_PATH) {
    // Reachable on purpose for a voluntary change; only the forced-flow
    // redirect is undone here.
    return proceed()
  }

  if (pathname === '/') {
    return redirect(new URL(DEFAULT_LANDING, nextUrl.origin))
  }

  if (!routeAllowedByToken(pathname, token)) {
    const url = new URL(DEFAULT_LANDING, nextUrl.origin)
    url.searchParams.set('denied', pathname)
    return redirect(url)
  }

  return proceed()
})

export const config = {
  /**
   * Everything except Next's own assets and the public font files. Matching
   * `/api/auth` is deliberate — the handler needs the session cookie parsed,
   * and `isPublicPath` lets it straight through.
   *
   * `sw.js`, `manifest.webmanifest` and `icons/` are excluded because the
   * browser fetches all three *without* the session in some contexts, and a
   * 307 to `/login` in place of a service worker script silently disables the
   * PWA — the failure looks like "install never appears", with nothing in the
   * console to say why.
   */
  matcher: [
    '/((?!_next/static|_next/image|fonts/|icons/|sw\\.js|manifest\\.webmanifest|favicon.ico|.*\\.(?:png|svg|ico|woff2)$).*)',
  ],
}
