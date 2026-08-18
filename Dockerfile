# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Agency OS — production image (Dokploy-ready)
#
# Multi-stage, standalone output. The final image carries the Next.js server,
# the traced node_modules, the generated Prisma client, and the migration SQL —
# nothing else. No pnpm store, no dev dependencies, no source.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
# --ignore-scripts skips the postinstall `prisma generate`; the builder runs it
# explicitly so a generate failure is not buried in install output.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --ignore-scripts

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm prisma generate
RUN pnpm build

# ── runner ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Africa/Cairo \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache tzdata wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# `standalone` already contains a minimal node_modules; static/ must be copied
# alongside it or every asset 404s.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations run on deploy (see README). The schema, the migration SQL and the
# Prisma CLI must therefore exist in the runtime image.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

USER nextjs
EXPOSE 3000

# `--max-redirect=0` is load-bearing. Without it, a middleware change that
# starts redirecting `/api/health` to `/login` would be followed, return 200
# from a page that never touches Postgres, and report a healthy container while
# the database is down. That exact regression existed until Phase 12.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --max-redirect=0 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
