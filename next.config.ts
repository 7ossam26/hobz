import type { NextConfig } from 'next'

import { STATIC_SECURITY_HEADERS } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  /**
   * Required for the Dokploy/Docker multi-stage image: emits `.next/standalone`
   * with a self-contained `server.js` and only the traced `node_modules`.
   *
   * `NEXT_DISABLE_STANDALONE=1` turns it off, and the Playwright config sets it.
   * That is not a shortcut: `next start` serves from `.next/` and never reads
   * `.next/standalone`, so for an e2e run the tracing step is pure cost — and on
   * Windows without Developer Mode it fails outright, because tracing builds the
   * standalone tree out of symlinks. The compiled application is byte-identical
   * either way; only the packaging differs.
   */
  output: process.env.NEXT_DISABLE_STANDALONE === '1' ? undefined : 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Linting is a separate, explicit `pnpm lint` step in CI — not a build-time
    // side effect. Keeps `next build` fast and failures unambiguous.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Same reasoning: `pnpm typecheck` owns this.
    ignoreBuildErrors: false,
  },
  experimental: {
    // node-cron and the Prisma client must never be bundled into the client graph.
    serverActions: {
      bodySizeLimit: '2mb',
    },
    /**
     * The client router cache. Next 15 defaults `dynamic` to 0, and every route
     * here is dynamic (the root layout reads cookies, every page calls
     * `auth()`), so without this the back button and every revisit re-render
     * the whole tree on the server — layout, header and page — for a page the
     * browser was showing a second ago.
     *
     * **Five seconds, not thirty.** Thirty was the first choice, on the grounds
     * that SPEC §2 already promises only 30s freshness via polling. That
     * reasoning is wrong in the one place this product cannot afford it: the
     * poll refreshes the page you are *looking at*, while this cache serves a
     * page you are *arriving at*. Approving a task and then opening مستحقاتي is
     * two different routes, and `router.refresh()` — which every mutation path
     * calls, and which bypasses this cache — only covers the first. A منفّذ
     * seeing a stale balance is precisely the failure this product exists to
     * prevent.
     *
     * Five seconds still removes the double fetch on an immediate back/forward,
     * which is the case that actually feels slow, and caps staleness below the
     * time it takes to read a screen.
     */
    staleTimes: {
      dynamic: 5,
      static: 180,
    },
  },
  serverExternalPackages: ['@prisma/client', 'node-cron', 'bcryptjs'],

  /**
   * The headers that are identical on every response.
   *
   * Set here rather than in the middleware so they also cover the paths the
   * middleware's matcher deliberately skips — `/_next/static`, `/fonts`,
   * `/icons`, `sw.js`. The nonce-bearing CSP is the one header that cannot
   * live here; it is built per request in `src/middleware.ts`.
   */
  async headers() {
    return [{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }]
  },
}

export default nextConfig
