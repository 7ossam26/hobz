import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required for the Dokploy/Docker multi-stage image: emits .next/standalone
  // with a self-contained server.js and only the traced node_modules.
  output: 'standalone',
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
}

export default nextConfig
