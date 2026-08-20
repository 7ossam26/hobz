# Virallap

Internal operations system for an organization (~100 people). Projects, tasks,
workers, deadlines, deductions, bonuses and payouts.

**Arabic only, full RTL.** Code, database and identifiers are English.

> The one thing this product exists to do: make deductions and payments feel
> like arithmetic, not like the manager's mood.

Start here:

| Document                                 | What it is                                           |
| ---------------------------------------- | ---------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                 | The engineering contract. Non-negotiable invariants. |
| [`docs/SPEC.md`](docs/SPEC.md)           | The product specification. The source of truth.      |
| [`docs/TESTING.md`](docs/TESTING.md)     | The testing contract.                                |
| [`docs/PHASES.md`](docs/PHASES.md)       | The 13-phase build plan.                             |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | What each phase built, deferred and learned.         |

---

## Status

**Phase 12 - hardening, and feature-complete.** All twelve phases have shipped:
identity and RBAC, clients/projects/milestones, the task engine and its
experience, the work calendar and lateness, the ledger and payout cycles,
penalties and bonuses, notifications, dashboards and reports, `.xlsx` import,
and this phase's Settings screen, PWA, performance and security passes, backups
and deployment path.

Two things are known not to work, both recorded in
[`docs/DECISIONS.md`](docs/DECISIONS.md) under Phase 12: **approving a task from
its detail sheet does not reach the server** (which is what fails e2e flows #2
and #5), and there is no leave-management screen. Everything else in
[`docs/SPEC.md`](docs/SPEC.md) is built and tested.

---

## Requirements

- **Node 22+**
- **pnpm 10+** (`corepack enable`)
- **Docker** - for Postgres. The app itself runs on the host in development.

---

## Local setup

```bash
# 1. Environment
cp .env.example .env
#    Fill in SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD before seeding.
#    Generate AUTH_SECRET with: openssl rand -base64 32

# 2. Dependencies
pnpm install

# 3. Postgres - creates BOTH `agency` and `agency_test`
docker compose up -d postgres

# 4. Schema + seed
pnpm db:migrate          # applies prisma/migrations
pnpm db:seed             # permission catalog, SUPER_ADMIN, default settings

# 5. Run
pnpm dev                 # http://localhost:3000
```

`docker compose up -d postgres` creates the test database through
`docker/postgres/init-test-db.sh`, which runs **only on an empty data
directory**. If `agency_test` is missing:

```bash
docker compose down -v && docker compose up -d postgres
```

### The seed

Creates the first `SUPER_ADMIN` from `SEED_ADMIN_USERNAME` /
`SEED_ADMIN_PASSWORD`, and **does not** set `mustChangePassword` - the operator
chose that password deliberately.

It is idempotent and safe to re-run: it refreshes the permission catalog from
code, removes permissions that no longer exist there, and **adds only missing
settings**. A `Setting` an operator has already changed is never overwritten.

---

## Commands

| Command                             | What it does                              |
| ----------------------------------- | ----------------------------------------- |
| `pnpm dev`                          | Development server                        |
| `pnpm build` / `pnpm start`         | Production build (standalone) and server  |
| `pnpm typecheck`                    | `tsc --noEmit`, strict                    |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                    |
| `pnpm format` / `pnpm format:check` | Prettier                                  |
| `pnpm test`                         | Unit + integration                        |
| `pnpm test:unit`                    | Unit only - no database, no network       |
| `pnpm test:integration`             | Requires Postgres on `agency_test`        |
| `pnpm test:coverage`                | Coverage with the gates enforced          |
| `pnpm test:e2e`                     | Playwright (builds and boots the app)     |
| `pnpm db:migrate`                   | `prisma migrate dev`                      |
| `pnpm db:seed`                      | Permissions, settings, the SUPER_ADMIN    |
| `pnpm db:seed:demo`                 | A small readable demo dataset (see below) |
| `pnpm db:backup`                    | Take a `pg_dump` now, into `BACKUP_DIR`   |
| `pnpm db:studio`                    | Prisma Studio                             |
| `pnpm perf:bundle`                  | Route JS, gzipped; fails over 180 KB      |
| `pnpm perf:lcp`                     | Median LCP per route on emulated 4G       |
| `pnpm perf:explain`                 | `EXPLAIN ANALYZE` the ten heaviest reads  |
| `pnpm security:scan-bundle`         | Fails if a secret reached `.next/static`  |
| `pnpm icons:generate`               | Redraw the PWA icons from the accent      |

The four measurement commands all read a **built** app, so run `pnpm build`
first. `perf:explain --load` and `db:seed:demo` write data and refuse to touch
anything but a scratch database.

### The demo dataset

```bash
pnpm db:seed        # first — permissions, settings, the admin account
pnpm db:seed:demo   # then — 12 منفّذين, 5 projects, 60 tasks, one closed cycle
```

Every row goes through the real services, so nothing in it is a state the
product could not reach. It refuses to run twice (it is additive, not
idempotent) and refuses to run in production; `ALLOW_DEMO_SEED=yes` overrides
both, deliberately noisily. Demo accounts sign in with `demo-password-2026`.

---

## Architecture

```
src/
  app/                      Routes. Server Components by default.
  modules/<domain>/
    actions.ts              Thin server actions: session -> permission -> zod -> service
    service.ts              Business logic. Pure, DB-injected, no next/* imports.
    queries.ts              Read paths with RBAC scoping baked in
    schema.ts               Zod, shared with the form
    types.ts                DTOs
  components/{ui,shared,layout}
  lib/{db,money,settings,rbac,audit,calendar,scheduler,auth,errors,utils}
  i18n/ar.ts                The Arabic string table
prisma/                     Schema, migrations, seed
tests/{unit,integration,e2e,factories,fixtures,helpers,setup}
```

`src/modules/setting/` is the reference implementation of the module pattern -
read it before adding a module.

### What the lint rules enforce

Several invariants are lint rules rather than review comments. If a build fails
on one of these, the rule is right:

- **No Arabic literals outside `src/i18n/ar.ts`.**
- **No physical CSS directions** (`ml-`, `pr-`, `text-left`, `left-`,
  `border-l-`). Use logical properties: `ms-`, `pe-`, `text-start`, `start-`,
  `border-s-`. This is checked in `src/components/ui/**` too - registry
  components are written for LTR.
- **No `next/*` or `react` imports in `src/lib/**` or `*/service.ts`.** Services
  must run under plain Vitest.
- **No `radix-ui` umbrella imports.** Use the scoped `@radix-ui/react-*`
  package; the umbrella costs ~77 kB of client JS per route.

### The pieces that carry the money

| Module          | Guarantee                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/money`     | `Decimal` everywhere, HALF_UP at 2dp, `format()` in `ar-EG` with Western digits. Money is never a `number`.                                      |
| `lib/settings`  | Typed, Zod-validated, cached accessor over the `Setting` table. Missing -> catalog default; **present but invalid -> throws**. No magic numbers. |
| `lib/rbac`      | Permission catalog in code, seeded to the DB. `SUPER_ADMIN` holds every permission implicitly, including future ones.                            |
| `lib/audit`     | Append-only writer. Redacts password hashes and tokens. Records both identities during impersonation.                                            |
| `lib/scheduler` | node-cron + a Postgres **transaction-level** advisory lock, so a restart or a second container cannot double-charge.                             |
| `lib/calendar`  | Interface only until Phase 6. Every function throws - a stub returning `0` working days would silently produce zero deductions.                  |

---

## Testing

Two Vitest projects: `unit` (no database) and `integration` (real Postgres).

`tests/setup/db-guard.ts` runs before anything else and **aborts unless the
database name ends in `_test`**, and aborts outright if `NODE_ENV=production`.
It is load-bearing - treat it as such.

Coverage gates (`pnpm test:coverage`): 70% global, 90% for `lib/money`,
`lib/rbac` and `lib/settings`. Coverage `include` is scoped to code that has
landed; each phase widens it as its modules arrive.

---

## Deployment - Dokploy

The `Dockerfile` is multi-stage and emits Next.js **standalone** output. The
runtime image contains the server, traced `node_modules`, the generated Prisma
client, and the migration SQL - no source, no dev dependencies.

### 1. Application

- **Type:** Docker / Dockerfile
- **Dockerfile:** `./Dockerfile`
- **Port:** `3000`
- **Healthcheck:** `GET /api/health` - returns `503` when Postgres is
  unreachable, so a bad rollout fails the check instead of serving errors.

### 2. Database

Create a Postgres 16 service in Dokploy. Do **not** expose it publicly; connect
over the internal network.

### 3. Environment variables

Every variable the runtime reads, and nothing else. Login throttling, password
length, penalty rates and cycle day are **not** here — they live in Settings so
an operator can change them during an incident without a redeploy (CLAUDE.md
invariant 4, SPEC §7).

| Variable                                      | Required  | Notes                                                                               |
| --------------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`                                | yes       | Internal Postgres URL. Never exposed publicly.                                      |
| `AUTH_SECRET`                                 | yes       | `openssl rand -base64 32`. Rotating it signs every session out.                     |
| `AUTH_URL`                                    | yes       | Public origin, e.g. `https://ops.example.com`                                       |
| `ENABLE_SCHEDULER`                            | yes       | `true` on **exactly one** instance; `false` everywhere else                         |
| `TZ`                                          | yes       | `Africa/Cairo`                                                                      |
| `NODE_ENV`                                    | yes       | `production`                                                                        |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | first run | Needed only for the initial `pnpm db:seed`                                          |
| `SEED_ADMIN_FULL_NAME`                        | no        | Defaults to the username                                                            |
| `BACKUP_DIR`                                  | no        | Server path for nightly dumps. **Unset disables the backup job entirely.**          |
| `BACKUP_RETENTION_DAYS`                       | no        | Nights kept. Default `14`. A property of the disk, not a business rule — see below. |
| `PG_DUMP_PATH`                                | no        | Defaults to `pg_dump` on `PATH`                                                     |
| `NEXT_DISABLE_STANDALONE`                     | no        | Build-time only. `1` skips file tracing; the Playwright config sets it              |

### 3a. Nightly backups

The `backup.nightly` job runs at **02:00 Cairo** — an hour before the two 03:00
jobs, so a dump captures the day that ended rather than a night mid-recompute.
It writes one gzipped `pg_dump` per night to `BACKUP_DIR` and deletes anything
older than `BACKUP_RETENTION_DAYS`.

Three things it needs, and one it deliberately does not have:

- `BACKUP_DIR` set, and pointing at a **mounted volume** — a path inside the
  container's own layer is deleted by the next deploy.
- `pg_dump` present in the runtime image (Alpine: `apk add postgresql-client`)
  and version-compatible with the server.
- Disk sized for `BACKUP_RETENTION_DAYS` gzipped dumps.
- **No download button, and there must never be one.** A dump is every salary,
  every deduction and every password hash in one file. Restoring is an operator
  task with shell access — `docs/RUNBOOK.md` has the procedure.

Take one on demand with `pnpm db:backup`, which runs the same code path.

### 4. Migrations on deploy

Run as a pre-deploy/release command, not at container start - two starting
replicas would race:

```bash
node_modules/.bin/prisma migrate deploy
```

Then, once, for a new installation, run the seed with
`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` set.

### 5. Scaling

`ENABLE_SCHEDULER=true` on one instance only. If a second instance does run
jobs, the advisory lock in `lib/scheduler` makes it harmless rather than
catastrophic - but the lock is a safety net, not a scaling strategy.

### 6. Rollback

Application rollback is a redeploy of the previous image tag in Dokploy.

**Migrations do not roll back automatically.** Before deploying a migration that
drops or narrows a column, take a `pg_dump`. Prefer expand/contract: add the new
column, deploy, backfill, and drop the old column in a _later_ release, so any
single rollback stays safe.

The `LedgerEntry` table (Phase 7) is append-only and will carry a database-level
trigger rejecting `UPDATE`/`DELETE`. No rollback procedure may work around it -
corrections are `REVERSAL` rows.

---

## Conventions

- Conventional commits, small and reviewable.
- Update `docs/SPEC.md` when a decision changes. The spec is the memory, not
  chat.
- Append to `docs/DECISIONS.md` at the end of every phase.
- If a request contradicts an invariant in `CLAUDE.md`, raise it rather than
  compromising the invariant.
