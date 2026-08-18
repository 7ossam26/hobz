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
