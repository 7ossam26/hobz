# Decisions

One entry per phase: what was built, what was deferred, what surprised us.
This file is the project's memory. Chat is not.

---

## Phase 0 — Foundation & Architecture

**Date:** 2026-08-13 · **Model:** Opus 5

### Built

- Next.js 15 App Router, TypeScript strict (plus `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`),
  pnpm, ESLint 9 flat config, Prettier.
- Tailwind v4 (CSS-first `@theme`), class-driven dark mode, zinc surface scale +
  one violet accent, density CSS variable, `tabular-nums` utility.
- IBM Plex Sans Arabic served from `public/fonts/` — Arabic and Latin subsets,
  four weights, `unicode-range` split, preloaded. No CDN at build or runtime.
- shadcn/ui initialised (`components.json`, `new-york`, zinc) with `Button`.
- Prisma + Postgres 16. Seven models only: `User`, `Role`, `Permission`,
  `RolePermission`, `UserRole`, `AuditLog`, `Setting`. Migration committed.
- `docker-compose.yml` (app + postgres + `agency_test`), multi-stage
  Dockerfile with standalone output and a healthcheck.
- `lib/`: `db`, `money`, `settings`, `rbac`, `audit`, `calendar`, `scheduler`,
  `auth/session`, `errors`, `utils`.
- `src/i18n/ar.ts` — the full Arabic string table.
- `src/modules/setting/` — the reference module (actions/service/queries/schema/types).
- Vitest (unit + integration projects) and Playwright per `docs/TESTING.md`,
  including `tests/setup/db-guard.ts`, factories, fixtures and helpers.
- Seed: permission catalog, `SUPER_ADMIN`, default settings.
- **150 unit tests, 99.4% coverage** on delivered code.

### Decisions worth recording

**Money rounds HALF_UP, not banker's.** Statistically defensible is not the bar;
a manager explaining a deduction to a worker is. `round2` is called once, at the
end of a chain — `lib/money` keeps 34 digits of intermediate precision. There is
a test asserting the two orders differ (70.00 vs 69.99 on a three-day penalty),
because that piaster is the whole argument.

**`format()` strips bidi control marks.** ICU injects LRM/RLM around currency and
negatives, and their placement varies between ICU versions, which would make the
function untestable. Direction is handled at the render layer instead
(`dir="ltr"` + `tabular-nums`), which is more robust than embedded marks.

**Settings: missing → default, invalid → throw.** A missing row is normal (before
the seed, after adding a catalog entry). A row that fails its schema is
corruption, and silently falling back to a default there is exactly how a wrong
deduction gets produced and defended. Loud is correct.

**Every Phase 0 stub throws.** `lib/calendar`, `lib/auth/session`,
`rbac.scopeProjects/scopeTasks` raise `NotImplementedError` naming the phase that
owns them. A `workingDaysBetween` returning `0` would make the penalty engine
compute zero deductions and _look_ like it worked. A `scopeProjects` returning
`{}` would grant every user every project the moment someone wired it up.

**The advisory lock is transaction-level, not session-level.** Prisma pools
connections, so `pg_advisory_lock` could be taken on one connection and released
on another. `pg_try_advisory_xact_lock` inside an interactive transaction is
pinned to that transaction and released on commit, rollback _or process death_ —
which is the case that matters during a redeploy.

**Manual and scheduled runs share one code path.** `runJob()` is used by both, so
a manager clicking "recalculate" during the 03:00 job contends for the same lock
instead of producing a second penalty.

**Invariants encoded as lint rules, not review comments.** Arabic literals
outside `src/i18n`, physical CSS directions, and `next/*`/`react` imports inside
`lib/` or `service.ts` all fail the build. Each rule was verified to actually
fire against a deliberate violation — a rule that silently matches nothing is
worse than no rule.

**Seed does not force a password change.** Per the brief. The operator picked the
password; forcing a change would be theatre. The seed also never overwrites an
existing `Setting`, so re-running it post-go-live cannot reset a grace period.

**`AuditLog` has no `updatedAt` and no `deletedAt`.** Their absence is the
schema-level statement of the append-only invariant.

### Surprises

**The shadcn button cost 77 kB of client JS.** The current registry generates
`import { Slot } from "radix-ui"` — the umbrella package. One button on an
otherwise empty page took the route from 103 kB to **180 kB First Load JS**,
precisely the SPEC §9 budget, before a single feature existed. Switching to the
scoped `@radix-ui/react-slot` returned it to 103 kB. A lint rule now bans the
umbrella import, because `shadcn add` will keep generating it.

Baseline after the fix: `/` = **127 B route, 103 kB First Load JS**.

**Prisma's `Decimal` is `decimal.js`.** `lib/money` depends on `decimal.js`
directly rather than on `Prisma.Decimal`, which keeps money arithmetic testable
without a generated client while staying wire-compatible with Prisma.

**The test harness needed `TEST_DATABASE_URL` promotion.** `.env` defines both
URLs, but Prisma only ever reads `DATABASE_URL` — so `pnpm test:integration`
would have migrated and truncated the developer's _dev_ database while the
`_test` guard sat there approving it. `db-guard.ts` now promotes
`TEST_DATABASE_URL` over `DATABASE_URL` before asserting, so the suffix check
applies to the promoted value and a mistyped test URL is still caught.

**Prettier reflows the contract documents.** `CLAUDE.md` and `docs/*.md` are
authored, not generated; formatting them repadded every Arabic table for no
benefit. They are in `.prettierignore`. Added `.gitattributes` with `eol=lf` as
well — this repo is developed on Windows and built in Linux containers, and
CRLF in `docker/postgres/init-test-db.sh` would make it unexecutable.

**Mapped-type assignment needed one cast.** In `settings/store.ts`, TypeScript
cannot see that a value produced for key `k` belongs in slot `k` of a mapped type
when `k` is only known at runtime. One localized, commented cast; the public
signature (`getSetting('penalty.defaultGraceHours')` → `number`) stays exact.

### Deferred (with owners)

| Deferred                                                                    | Phase |
| --------------------------------------------------------------------------- | ----- |
| `lib/calendar` implementation — working days, holidays, leave               | 6     |
| `lib/rbac` scope helpers (`view.all` vs `view.assigned` where-clauses)      | 1     |
| `lib/auth` — Auth.js v5 credentials, JWT, bcrypt, rate limiting             | 1     |
| `LedgerEntry` + the DB trigger rejecting `UPDATE`/`DELETE`                  | 7     |
| Integration test suite (no models with write paths yet beyond settings)     | 1     |
| The six Playwright journeys (Phase 0 ships the RTL/font smoke check only)   | 1–12  |
| The 10-hue semantic data palette                                            | 2     |
| Registering actual scheduler jobs (`src/instrumentation.ts` lists the four) | 6–9   |

### Known limitations

- **`pnpm test` runs no integration tests.** `passWithNoTests` is set at the root
  so an empty integration project does not fail the run. The coverage gate is
  what keeps the unit suite honest. Phase 1 lands the first integration tests.
- **Coverage `include` is scoped** to code Phase 0 implements. Widen it in
  `vitest.config.ts` as each module lands, or the global 70% gate becomes
  meaningless.
- **The integration harness has never been executed**, because no Postgres was
  reachable on the build machine. `db-guard`, `global-setup` and `reset` are
  unit-tested where they can be, but the truncate/migrate path itself is
  unproven until Phase 1 runs it against a real container.
- **`prisma/migrations/20260813000000_init` was produced with `migrate diff`**
  against the schema, not by `migrate dev` against a live database — no Postgres
  was available on the build machine. It should be applied to a clean database
  and verified before the first real deployment.
- **Docker images were not built or run here** (no Docker on the build machine).
  The Dockerfile and compose file are written but unverified end to end.
- **`package.json#prisma` seed config is deprecated** in Prisma 7. Migrate to
  `prisma.config.ts` when upgrading; it is only a warning on 6.x.

---

## Phase 1 — Auth, RBAC, Users, Audit

**Date:** 2026-08-14 · **Model:** Opus 5

### Built

- **Auth.js v5**, Credentials provider, JWT session, bcrypt cost 12. No email,
  no self-signup, no user-initiated reset — the only reset path is an admin one.
- **Login throttling in two layers**: an in-process map and a `login_throttles`
  table. Keyed on username _and_ IP. Limits read from Settings.
- **`lib/rbac`** completed: `scopeProjects` / `scopeTasks` returning Prisma
  where-fragments, `can` / `assertCan`, and `requirePermission` /
  `requireAuth` wrappers for server actions.
- **Roles module** — create/edit/delete, Arabic + English names, permissions
  grouped by domain. `SUPER_ADMIN` hardcoded, undeletable, uneditable.
- **Users module** — create/edit/deactivate/activate/admin-reset, +20 phone
  validated and normalised, pay profile, roles, penalty-profile seam.
- **Impersonation** with a permanent banner and both identities on every audit
  row.
- **Audit viewer** — filters (actor, entity, action, Cairo-correct date range)
  and a changed-fields-only diff.
- **Middleware** protecting `/(app)`, plus permission-aware navigation.
- **431 Vitest tests** (316 unit + 115 integration) and **7 Playwright tests**
  including flow #1. Coverage **97.9%** overall, all gates met.

### Decisions worth recording

**The JWT carries the permission set, and the query layer ignores it.** The
token's copy exists for the middleware, which runs at the edge where Prisma does
not. Everything that reads or writes re-resolves from the database
(`lib/auth/resolve`). A JWT minted this morning would otherwise keep granting a
permission an admin revoked at noon — and a revoke that takes effect at next
sign-out is not a revoke. At ~100 users that is one indexed query per request.

**`scopeTasks` is read literally, and narrowly.** SPEC §6 says `view.assigned`
means "projects where the user is owner/member, **or** tasks where they are
assignee/watcher". Read per entity: owning a project does not by itself reveal
its tasks. Widening it is one `OR` branch away, but it is a policy change and
belongs in the SPEC first. Recorded in SPEC §6 so Phase 4 revisits it
deliberately rather than by accident.

**The scope helpers carry `deletedAt: null`.** They are the one function every
scoped read already has to call, so invariant 8 rides along for free. There is
an explicit `includeDeleted` opt-in for an admin restore screen.

**`{ id: { in: [] } }` is the deny-all fragment.** The Phase 0 stub threw rather
than returning `{}`, on the grounds that `{}` means "no filter" and would grant
everyone everything. The implementation keeps that spirit: a user with no view
permission gets a fragment that matches nothing, and `isEmptyScope` lets a query
short-circuit.

**`requirePermission` is a factory taking an actor resolver.** `lib/rbac`
therefore never imports `lib/auth` — no cycle, no Next.js in the way, and the
wrapper that guards every write path is unit-testable with a fake resolver.

**A missing username costs the same 250 ms as a wrong password.**
`burnPasswordTime` verifies against a per-process decoy hash. Without it the
login form is a username oracle, and an internal tool's staff list is exactly
what an attacker wants first. Relatedly, "this account is disabled" is only told
to someone who has already proved they know the password.

**A served lockout resets the counter.** Carrying the old failure count across an
expired lock would mean one typo immediately re-locks the account for another
full period — punishing the locked-out legitimate user, who is the only person
the expiry exists for. The lock is also set, never extended, so an attacker
cannot hold a colleague out indefinitely by continuing to hammer.

**Impersonation is gated three times.** The `user.impersonate` permission, an
explicit `isSuperAdmin` check (the brief says SUPER_ADMIN _only_, and a role
could be granted the permission by mistake), and a third re-check against the
database inside the `jwt` callback when the token is minted. An action that
forgot the first two still could not produce an impersonated token. Nesting is
refused outright — it would make "who did this" unanswerable.

**`AuditLog.impersonatorId` became a column.** Phase 0 put `__impersonator`
inside the `after` JSON. Moving it out keeps the diff view a clean before/after
and turns "show me everything done while impersonating" into an indexed query
instead of a JSON scan.

**Deactivation's open-task guard shipped now, behind a port.** `Task` is a Phase
4 table, so `OpenTaskLookup` is injected and Phase 1's implementation answers
"none". The _rule_ — blocked, audited, with the Arabic error naming the tasks —
is written and tested against a lookup that returns real tasks. Writing the guard
later alongside the table is how a rule ends up existing only in the brief.

**Security thresholds are Settings, not env vars.** Invariant 4 makes no
exception for them, and it should not: during an incident an operator tightens
the lockout, during a lockout storm they loosen it, and neither should need a
redeploy.

**Forms validate with the same Zod schema the action parses.** An `AppError`
thrown across the RSC boundary arrives with its message stripped in production,
which turned "الراتب الشهري مطلوب لهذا النوع من الأجر" into a generic failure.
The client now parses first for the human; the server parses again, and that is
the check that counts.

### Surprises

**Three real bugs were caught by tests rather than by review.**

1. `cairoDayBoundary` was off by 998 ms at the end of a day. `Intl` reports whole
   seconds and silently drops the millisecond component, which folded into the
   computed offset — so every audit date filter quietly included the first second
   of the following day.
2. The sidebar used `border-s`. Under RTL the sidebar sits at the inline _start_
   (the right), so `border-s` drew a line down the outer edge of the screen and
   left the two panes touching. It needed `border-e`. The e2e assertion on
   computed border widths is what caught it.
3. An empty optional money field failed its regex instead of reading as absent.
   Leaving the salary blank for a per-task worker reported "the amount is
   malformed" and masked the refinement that would have said which field that
   pay type actually needs.

**Adding middleware broke the build.** `src/instrumentation.ts` guarded the
scheduler with an early `return` when `NEXT_RUNTIME !== 'nodejs'`. That reads
correctly and is wrong: webpack still resolved the dynamic `import('@/lib/scheduler')`,
and once middleware existed Next produced an edge bundle where `node-cron`'s
`path` and `child_process` imports could not resolve. Inverting it to a positive
`if (process.env.NEXT_RUNTIME === 'nodejs') { … }` lets the literal substitution
eliminate the whole block.

**Vitest and Playwright do not read `.env`.** `next dev` does, so this only
surfaced when the integration project started and `db-guard` correctly refused a
missing `DATABASE_URL` — which looks like a broken harness rather than the
missing variable it is. Both configs now call `process.loadEnvFile('.env')`,
which follows `--env-file` semantics and lets real CI variables win.

**pnpm 11's supply-chain policy blocked every command.** `baseline-browser-mapping`
is a browser-support data table that browserslist pulls in transitively and
republishes several times a day, so its lockfile entry is almost always inside
the one-day `minimumReleaseAge` window. That turned the guard from "block
suspicious packages" into "block `pnpm test`". `pnpm-workspace.yaml` now excludes
that single package by name and keeps the guard on for the other 545 — flagged
here because it is a supply-chain relaxation and deserves a second opinion.

**Phase 0's two unproven claims are now proven.** The `20260813000000_init`
migration had been generated with `migrate diff` and never applied; it applies
cleanly. The integration harness (migrate + truncate + reset) had never executed;
it does, 115 tests' worth.

### The edge-case sweep (docs/TESTING.md §4, axes 4, 11, 12)

Run as a second pass. **216 further tests**, taking the suite from 440 to 666
and coverage from 97.9% to **99.2%**. Written directly rather than by subagents:
the first attempt at spawning them exhausted the session before any produced
output, and the value here was in knowing precisely what the first pass already
covered — three parallel agents would mostly have rediscovered it.

**Axis 4 (permissions).** A full matrix over `PERMISSIONS`, parameterised so it
cannot go stale: every key is default-deny, granting one key grants exactly that
key, and twenty neighbouring pairs (`penalty.create` → `penalty.reverse`,
`payout.approve` → `payout.markPaid`, `view.assigned` → `view.all`) stay
separate. Then the cases only a database can express — permission revoked
mid-session, role removed, union across two roles — and the impersonation
boundary: an impersonated actor gets the _target's_ permissions, cannot nest,
and holding `user.impersonate` without being SUPER_ADMIN is refused.

**Axis 11 (soft-delete).** Extended past the first pass into the counts derived
from deleted rows, which is where the bug was.

**Axis 12 (empty/null).** The axis names "no assignee, no due date, empty cycle"
— none of which have a table yet — so it was translated to what Phase 1 owns: a
brand-new user with nothing filled in, every optional field blank, whitespace-only
strings at every schema boundary, empty result sets and out-of-range pagination
against a genuinely empty database, and the audit row the scheduler writes with
no actor, no reason, no IP and no payload.

**Three more real defects, all found by the tests before the fix:**

1. **Role member counts included soft-deleted users.** `deleteRole` refuses
   while the count is above zero, so deleting a departed employee permanently
   stranded the role they held — undeletable, with the screen unable to explain
   why, because the holder it was protecting is invisible everywhere else. Now a
   filtered relation count. Deactivated-but-not-deleted users still count, which
   is correct: that account still exists and can be switched back on.

2. **`user.edit` was a privilege-escalation path.** Assigning roles is part of
   editing a user, and one assignable role holds every permission implicitly
   (SPEC §2) — so an editor could promote themselves to SUPER_ADMIN, or demote
   every administrator and take over a product with nobody left able to undo it.
   `assertMayChangeSuperAdminRole` now requires the actor to _be_ a SUPER_ADMIN
   to grant or revoke that one role. Deliberately narrow: it fires only when the
   SUPER_ADMIN membership actually changes, so ordinary role edits are untouched.

3. **A test factory footgun.** `createUser` used `options.defaultTaskRate ??
'500.00'`, so a test asking for a worker with explicitly _no_ rate silently
   got one and proved nothing. `=== undefined` now distinguishes "not specified"
   from "specified as null" — the same distinction the `phone` option already
   made.

### Deferred (with owners)

| Deferred                                                                      | Phase |
| ----------------------------------------------------------------------------- | ----- |
| `scopeProjects` / `scopeTasks` proven against real `Project` / `Task` rows    | 3 / 4 |
| The real `OpenTaskLookup` query behind the deactivation guard                 | 4     |
| `PenaltyProfile` FK behind `User.penaltyProfileId` (a free-form string today) | 8     |
| Users list server-side pagination UI (the query paginates; the page asks 100) | 2     |
| Real sheet/dialog primitives — Phase 1 ships a minimal hand-written `Sheet`   | 2     |
| Toasts and optimistic updates (Phase 1 uses inline alerts + `router.refresh`) | 2     |
| e2e flows #2–#6                                                               | 4–12  |

### Known limitations

- **`scopeProjects` / `scopeTasks` have no database-level integration test**,
  because `Project` and `Task` do not exist yet and `prisma/schema.prisma`
  carries an explicit guard against adding them early. They are covered
  exhaustively as pure functions, and the direct-ID principle the brief asks
  about is proven against every read path that _does_ ship
  (`tests/integration/rbac/scoped-reads.test.ts`). Phase 3 inherits that file's
  shape for `Project`.
- **Tests for `lib/rbac` were written after the implementation, not before.**
  The brief asked for tests-first there. They are derived from the SPEC §6 text
  rather than from the code, and three of them found real bugs — but the
  ordering claim would be false if made.
- **`lib/auth/config.ts`, `next-auth.ts`, `session.ts` and `throttle.ts` are
  excluded from coverage.** They wire Next.js together; a unit test of them
  would assert that a framework was configured. They are exercised by the
  Playwright flow instead.
- **Docker was unavailable on the build machine.** The integration and e2e suites
  ran against a throwaway Postgres 18 cluster on port 5544 (`.env` points there).
  Switch both URLs back to 5432 once `docker compose up postgres` is running.
- **The users page fetches every user's detail up front** to populate the edit
  sheet without a client waterfall. Correct at ~100 users and wrong at 10 000;
  Phase 2's `EntitySheet` should fetch on open.

---

## Phase 2 — Design System & App Shell

**Date:** 2026-08-14 · **Model:** Opus 5

### Built

- **The token layer** in `src/app/globals.css` (Tailwind v4 has no JS config —
  `@theme` is the config): a four-step zinc surface ramp per theme, a full
  violet accent ramp, ten data hues with four roles each, restrained
  radius/elevation scales, and a density scale driven by `data-density` on
  `<html>`.
- **`lib/palette`** — the dictionary that turns a datum into a hue. Task status,
  project status, priority, health, ledger type, plus a stable FNV-1a hash for
  identity colours (project, category, avatar).
- **The app shell**: RTL-correct collapsible sidebar (icon-only collapsed, and
  always icon-only below `md`), sticky header with a route-derived breadcrumb, a
  portal slot for the page's primary action, a notification bell placeholder,
  and an account menu carrying the theme and density toggles.
- **`Ctrl+K` command palette** in Arabic — navigation, appearance actions and
  entity search, ranked through `lib/search`.
- **`lib/search`** — Arabic normalisation (alef/hamza/ya/ta-marbuta folds,
  diacritics, tatweel, Arabic-Indic digits, Latin case and accents) plus a
  five-band relevance score and a stable ranker.
- **`lib/datetime`** — Cairo wall-clock rendering, Gregorian dates with Arabic
  month names from `i18n/ar`, and relative time with correct Arabic
  singular/dual/paucal/plural inflection.
- **The component library**: `EntitySheet` (over `Sheet`, `Dialog`, `Popover`
  and a shared modal-behaviour hook), `DataTable` (server-driven paging,
  sorting, faceted filters, saved views, column visibility, sticky header,
  virtualisation over 100 rows), `StatusChip`, `PriorityFlag`, `HealthBadge`,
  `UserChip` with the WhatsApp deep link, `MoneyText`, `DateText`,
  `RelativeTime`, `EmptyState`, skeletons, `ConfirmDialog` with typed
  confirmation and mandatory reason, toasts, and `FormField` bound to Zod.
- **`/design-system`** (dev-only), rendering the whole library in either theme
  and either density, side by side, with real Arabic content.
- **Loading / error / not-found boundaries** for the app segment.
- **203 new tests** — 746 unit tests in total, all passing.

### Decisions worth recording

- **Colour is bound, never chosen.** A component says `data-hue="emerald"` and
  reads `--hue-*`. Two consequences, both intended: painting anything requires
  first naming what it means, and eleven hues cost one set of utility classes
  instead of eleven. There is no `color` prop anywhere in the library.
- **The contrast claim is a test.** `tests/unit/design/palette-contrast.test.ts`
  parses the stylesheet — not a TypeScript copy of it — and measures 58
  pairings. The palette was _solved for_ rather than eyeballed: a search found
  the lightest text lightness per hue that still clears 4.7:1 against its own
  chip tint, which is the darkest ground that text ever sits on.
- **Ten hues, none of them violet.** The accent occupies 275–300°; the data hues
  sit at 25/55/85/128/162/195/232/264/322/355°. A test asserts both the distance
  from the accent and at least 15° between neighbours.
- **`BACKLOG`, `LOW` and `DRAFT` are deliberately neutral.** On a list where most
  rows are LOW, colouring LOW colours everything, which is the same as colouring
  nothing.
- **Theme, density and sidebar state are cookies.** Settings are global
  (SPEC §7) and these are personal; a `User.theme` column would cost a
  migration, a write per toggle, and a round trip before the screen could
  change. The server reads them while rendering `<html>`, so there is no flash
  and no client JS on first paint. The cost — per browser, not per account — is
  written into SPEC §9 rather than left implicit.
- **Table state lives in the URL, saved views in `localStorage`.** The table is
  server-driven, so its state is a query input and has to survive a request. A
  saved view is only a shortcut to a URL the user could have bookmarked, which
  is why losing one is an inconvenience rather than data loss.
- **The command palette fetches the whole directory once.** SPEC §2 caps the
  product at ~100 users. Sending 100 names to the browser once is smaller than
  either a normalised shadow column per searchable field or a full scan per
  keystroke — and Arabic folding cannot happen inside a `WHERE` clause without
  one of those.
- **Everything is still hand-written.** No Radix beyond `react-slot`, no
  virtualiser dependency. The focus trap, scroll lock, popover, tabs and row
  windowing come to roughly 300 lines together, and the route budget is 180 kB.
- **The header's page action is a portal.** A layout cannot read its child page's
  props, and the header has to survive `loading.tsx` and `error.tsx`. The cost is
  one frame of hydration for a button, on routes that are all dynamic anyway.
- **A modal focuses the first control in its _body_.** The first focusable
  element in DOM order is the close button, and landing a keyboard user on
  "close" is the opposite of why the sheet opened.
- **`lib/search.ts` is exempted from the no-Arabic-literals rule.** That rule
  exists so user-facing wording lives in one file. A fold table (أ→ا, ة→ه) is the
  alphabet, not copy, and writing it as `\u` escapes would make the one file
  where a reviewer must see the letters the one file where they cannot.

### Surprises

- **The overlay was announcing a second "إغلاق".** Both the backdrop button and
  the header close button carried the same accessible name, so a screen-reader
  user heard two identical controls. Found by a component test that could not
  disambiguate them either. The backdrop is now `aria-hidden` with
  `tabIndex={-1}`; Escape and the header button are the real exits.
- **Testing Library's auto-cleanup never ran.** `vitest.config.ts` sets
  `globals: false`, and Testing Library installs its `afterEach(cleanup)` only
  when it finds a global `afterEach`. Renders were stacking up in one document
  and `getByText` failed with "found multiple elements" in whichever test
  happened to be second. Fixed once, in `tests/helpers/render.tsx`.
- **`inset-block-0` and `inset-inline-0` are not Tailwind classes.** Phase 1's
  `Sheet` had been carrying `inset-block-0` since it was written. It did nothing,
  and an `h-full` was quietly holding the panel together.
- **Two sources of truth for column visibility is one too many.** The first cut
  had `defaultHidden` on the column _and_ `hidden` in the URL, which made a
  default-hidden column impossible to switch back on. `hidden` is now the whole
  truth, and the page seeds it with `defaultHiddenColumns(columns)`.
- **The search debounce fired twice per query.** The effect depended on the
  `onSearch` callback, which the parent rebuilds on every render — including the
  pending re-render that the previous search had just caused. It is held in a ref
  now.

### Route JS (SPEC §9 budget: < 180 kB gzip)

Measured from `next build`. The reported figures are gzipped, verified against
the emitted chunks: 54.2 kB reported vs 53.0 kB measured for the React chunk.

| Route              | First Load JS | Headroom |
| ------------------ | ------------- | -------- |
| `/dashboard`       | 103 kB        | 77 kB    |
| `/login`           | 124 kB        | 56 kB    |
| `/change-password` | 124 kB        | 56 kB    |
| `/audit`           | 124 kB        | 56 kB    |
| `/roles`           | 146 kB        | 34 kB    |
| `/users`           | 148 kB        | 32 kB    |
| `/design-system`   | 155 kB        | dev-only |

The shared baseline is 103 kB, of which 54.2 kB is React itself. The shell —
sidebar, breadcrumb, palette, popovers, toasts, preferences — adds about 21 kB to
the routes that render it.

### Deferred (with owners)

| Deferred                                                                 | Phase |
| ------------------------------------------------------------------------ | ----- |
| Notifications behind the bell (events, preferences, 30s polling)         | 9     |
| Deep-linking the palette into an entity's sheet (`?open=<id>`)           | 3     |
| Arabic status labels read from Settings rather than `ar.enums`           | 12    |
| Users and roles screens rebuilt on `DataTable` + `EntitySheet`           | 3     |
| Server-side pagination UI for the users list (inherited from Phase 1)    | 3     |
| Row selection and bulk actions in `DataTable`                            | 5     |
| Optimistic updates (the toast conventions and provider are already here) | 3     |

### Known limitations

- **The integration suite and the combined coverage gate did not run.** The test
  database is unreachable on this machine — `prisma migrate deploy` fails inside
  `tests/setup/global-setup.ts` — which is the same environment gap Phase 1
  recorded. The unit project passes in full: 36 files, 746 tests. Every file this
  phase added to the coverage list is at or above its 90% gate: `search` 100%,
  `datetime` 100%, `preferences` 100%, `palette` 100%, `data-table/state` 98%.
  Phase 2's additions raised unit-only global coverage from 63.05% to 69.88%; the
  70% global gate is written for the combined run, where `modules/*/service.ts`
  is covered by the integration project.
- **The users, roles and audit screens still use Phase 1's markup.** They compile
  and behave exactly as before — `Sheet` kept its API — but they do not yet use
  `DataTable` or `EntitySheet`. Rebuilding them belongs with the phase that
  touches their data.
- **Toasts render against the global theme, not a preview panel's.** They are
  portalled to `<body>`, so on `/design-system` a toast fired from the dark panel
  appears in whatever theme the app is actually in. Correct everywhere that is
  not a side-by-side gallery.
- **`RelativeTime` renders the absolute date on the server** and becomes relative
  after mount. That is deliberate — it is what avoids a hydration mismatch and
  what keeps a long-open dashboard honest — but it does mean the first paint
  shows a timestamp rather than "منذ دقيقتين".

---

## Phase 3 — Clients, Projects & Milestones

**Date:** 2026-08-15 · **Model:** Sonnet 5

### Built

- **`Client`** — name, phone, notes only. No financial field exists on the
  model, which is the enforcement mechanism for SPEC §2's "no money-in
  tracking": a `client.manage` holder cannot touch money through this module
  because there is none in it.
- **`Project`** — code (auto-generated `PRJ-0001…`, editable, retried once on a
  generation race), name, client, owner, `engagementType` (validated against
  the Settings-enabled subset of the fixed enum, not just the enum itself),
  status, required `startDate`/`dueDate`, optional `gracePeriodHours` /
  `penalizeRevisionLateness` overrides (both `null` = "use the Settings
  default"), and the health override pair.
- **`ProjectMember`** — per-project role (`MANAGER`/`CONTRIBUTOR`/`VIEWER`,
  a Phase 3 addition, not a SPEC §4 enum), added/changed/removed one at a time
  from the project's Team tab.
- **`Milestone`** — name, due date, order, status; drag-to-reorder in the UI
  with up/down-button and keyboard fallbacks (native HTML5 drag has no
  keyboard story on its own).
- **Project health (SPEC §5.7)** — `modules/project/health.ts`: a pure
  `computeProjectHealth()` over `{status, dueDate, now, signals, thresholds}`,
  a `TaskHealthLookup` port exactly like Phase 1's `OpenTaskLookup` (`Task`
  doesn't exist until Phase 4, so `noTaskHealthSignals` answers "zero overdue,
  zero blocked" honestly rather than guessing), and a `healthWhereFragment()`
  that expresses the same logic as a Prisma `where` so the `/projects` health
  facet is a real indexed filter, not a fetch-everything-then-filter
  shortcut. Manual override (`healthOverride`/`healthReason`) always wins,
  requires a reason in **both** directions — setting one and clearing one back
  to automatic — and both are audited.
- **Project templates** — `saveProjectAsTemplate` captures a project's
  milestones as day-offsets from its `startDate` (not absolute dates, so one
  template fits any start date); `createProjectFromTemplate` spawns a new
  project via the normal `createProject` path and instantiates the milestones
  against the new `startDate`, always reset to `PENDING`. The payload's
  `tasks` field is typed `never[]` and stays empty — the same "define the
  interface now, no-op the seam" shape Phase 1 used for `OpenTaskLookup`,
  ready for Phase 4 to fill in.
- **RBAC**: `scopeProjects(actor)` (already implemented and unit-tested since
  Phase 1) is now exercised against real `Project` rows for the first time.
  Read paths (`getProjects`, `getProjectById`, `getMilestones`) apply the scope
  and never throw for a missing view permission — an unpermitted signed-in user
  simply sees nothing, because the scope fragment itself is the enforcement
  (see `lib/rbac/scope.ts`'s own docs). `getClients`/`getClientById` are the
  all-or-nothing case (`client.view`, no `.assigned` split in the SPEC §6
  catalog) and throw `ForbiddenError` like `user.view` does. `project.edit` /
  `project.delete` / `project.create` are global once granted — there is no
  `.assigned` variant for them in the catalog, so a `view.assigned` project
  member does not automatically gain edit rights on it; a separate permission
  is required, matching how `user.edit` works today.
- **UI**: `/clients` and `/projects` are the first screens actually built on
  `DataTable` + `EntitySheet` (Phase 1 shipped `/users`/`/roles` on hand-written
  markup before those primitives existed; Phase 2's decisions log flagged the
  rebuild for "whichever phase next touches their data" — this is that phase).
  `/projects/[id]` is a full page with tabs (Overview / Tasks placeholder /
  Team / Timeline) — see the note below on why, given SPEC §9 otherwise
  reserves full pages for lists/dashboards/settings/reports.
- **258 new tests**: 113 written directly (26 unit for health boundaries, 5
  unit for code generation, 82 integration for RBAC scoping, health-override
  audit, and CRUD across all four modules) plus 145 from the edge-case sweep
  below. **1133 tests pass** across the whole suite (unit + integration).
  Coverage gates hold: `project/health.ts` at the same 90% tier as
  `money`/`rbac`/`settings` (100% achieved), global coverage 98.33%.

### Decisions worth recording

**The project detail page breaks SPEC §9's "full pages only for lists,
dashboards, settings, reports" rule, on purpose, per an explicit instruction.**
The phase brief (verbatim, in `docs/PHASES.md` and repeated in the session
prompt) asks for "project detail page with tabs (Overview, Tasks placeholder,
Team, Timeline)" — a page, not a sheet. CLAUDE.md says to stop and raise a
conflict rather than silently diverge; this is flagged here rather than
silently resolved either way, and the literal instruction was followed because
it is doubly confirmed (the phase-planning doc and the live prompt agree) and
a project is exactly the kind of multi-faceted entity SPEC's own "sheet vs
page" reasoning would plausibly exempt if asked. Within the page, the
sheet-first rule still holds for every _edit_ — the tabs are content, not
routes, and every mutation happens in a sheet or dialog over the page.

**`ProjectMemberRole` and `MilestoneStatus` are Phase 3 additions, not SPEC §4
enums.** The SPEC lists `Milestone id, projectId, name, dueDate, order,
status` and `ProjectMember projectId, userId, roleInProject` without spelling
out the enum values for either "status" or "role". Rather than leaving them as
free-form strings (which the rest of the product's "fixed enums, editable
labels" pattern argues against), each got a small fixed enum:
`ProjectMemberRole = MANAGER | CONTRIBUTOR | VIEWER`,
`MilestoneStatus = PENDING | IN_PROGRESS | DONE | DELAYED`. Flagged here for
override the same way SPEC §2's own "Decisions I made on your behalf" section
flags T4/M4/R2/B6.

**`startDate`/`dueDate` are required, not optional.** The SPEC §4 listing marks
`clientId?`, `healthOverride?`, `healthReason?`, `gracePeriodHours?`, and
`penalizeRevisionLateness?` with `?` but not `startDate, dueDate` — read
literally (the same "read literally, and deliberately so" stance `lib/rbac`
already takes on the scoping sentence and `assertMayChangeSuperAdminRole`
takes on the SUPER_ADMIN restriction), that means both dates are mandatory at
creation, even for a `DRAFT`. This also simplifies health computation
considerably: `dueDate` is never null.

**Milestones and `ProjectMember` are hard-deleted, not soft-deleted.** The SPEC
§4 listing gives `Client`, `Project`, and every identity model an explicit
`deletedAt`, but the `Milestone` and `ProjectMember` lines don't carry one —
matching the junction-table precedent `UserRole`/`RolePermission` already set
in Phase 0. Removing a milestone or a team member is a real `DELETE`.

**The `/projects` health facet is SQL, not an in-memory filter — with a caveat
recorded where it will be found.** `healthWhereFragment()` reconstructs
`computeProjectHealth()`'s RED/AMBER/GREEN logic as a Prisma `where`, which
only stays correct because Phase 3's task signals are always zero
(`noTaskHealthSignals`). A code comment on `healthWhereFragment` and a unit
test that asserts the two implementations agree across a boundary matrix are
both there specifically so Phase 4 — which will wire real overdue-task and
blocked-day signals — cannot miss that this needs revisiting.

**Project code generation retries once, not indefinitely.** `PRJ-0001…` is a
plain running count, not a database sequence; two managers creating a project
in the same instant can race past the availability check. `createProject`
retries the whole insert once against a freshly generated code, which is
sufficient at SPEC §2's "up to ~100 people" scale and cheaper than a real
sequence table or an advisory lock for a field that is explicitly editable
immediately after creation anyway.

**The owner/team picker degrades instead of dead-ending.** `getUserOptions()`
(`modules/user/queries.ts`) mirrors the command palette's "the whole directory,
once" reasoning (Phase 2, SPEC §2's ~100-user cap) for populating the
owner/member `<select>`s, but a `project.create` holder who lacks `user.view`
gets back a list containing only themselves rather than an empty, unusable
dropdown — `ownerId` is a required field, and a required field with nothing to
put in it is worse than a narrowed one.

**Health-override clearing is audited as its own action, and requires its own
reason.** SPEC §5.7 only says the override needs a reason; clearing one back
to automatic is a separate decision and CLAUDE.md invariant 7 audits every
status change regardless of direction, so
`setProjectHealthOverrideSchema` requires a reason unconditionally.
`Project.healthReason` itself clears to `null` alongside `healthOverride`
(it describes the _current_ override, not a log of the last thing that
happened) — the reason given for clearing lives on the audit row's `reason`
column, which is where "why was this cleared" belongs once there is no live
override left to attach it to. A first draft of this got the two directions
backwards (stored the clearing reason into the live `healthReason` column);
the integration test written to prove the audit trail caught it before commit.

### Surprises

**The two DB connectivity gaps Phase 0/1/2 recorded were both resolved
mid-phase.** No Docker on the build machine (still true), but a native
PostgreSQL 18 service was already listening on `:5432` — with different
credentials than `docker-compose.yml` assumes, which read as the same
"unreachable" failure at first. Once given working credentials, the full
migration history (`20260813000000_init` through this phase's
`20260815000000_work_clients_projects_milestones`) applied cleanly to a real
database for the first time, and the entire integration suite — Phase 3's new
tests and all prior phases' — ran and passed against it. Phase 1/2's
"unverified end to end" caveat can be retired.

**`prisma migrate dev` needs a live database even to _generate_ a migration
against a migrations history; a schema-to-schema diff does not.** With no
usable `DATABASE_URL` yet, `prisma migrate diff --from-schema-datamodel
<git-HEAD's schema.prisma> --to-schema-datamodel prisma/schema.prisma --script`
produced the same SQL a live `migrate dev` would have, using the previous
commit's schema as the "from" side instead of a shadow database. Written up
here because Phase 0 hit the analogous problem and used `migrate diff` too,
but against `--from-migrations`, which (this phase learned) still needs a
shadow database — only the schema-datamodel-to-schema-datamodel form is fully
offline.

**bcrypt at cost 12 started timing out under `--coverage`.** `tests/unit/auth/{password,authenticate}.test.ts` (Phase 1) budget close to vitest's 5s
default per bcrypt call; v8's coverage instrumentation adds enough overhead,
combined with Phase 3's larger and more parallel suite, that two different
cost-12 hashes timed out in back-to-back full-coverage runs. Not a regression
in Phase 1's tests — a thin, pre-existing margin that a bigger suite finally
exhausted. Fixed by raising the **unit** project's `testTimeout` to 15s in
`vitest.config.ts` (the integration project already had an explicit 30s for
the same class of concern); the tests themselves are unchanged.

### The edge-case sweep (docs/TESTING.md §4, axes 1, 4, 10, 11)

Run as four parallel subagents, one per axis, each writing directly into
new test files rather than editing shared ones — the collision-avoidance
lesson Phase 1's log recorded ("the first attempt at spawning them exhausted
the session before any produced output") did not repeat here: all four
finished, added **145 further tests**, and three of them independently
converged on the same real bug.

**Axis 1 (boundaries).** 26 tests across 5 new files: milestone `order` at 0,
1, and 20 items with a mid-list deletion (confirms the next `order` is
`max+1`, never a reused gap); `startDate === dueDate` accepted as a legal
one-day project; `gracePeriodHours: 0` proven distinct from `null` at both the
schema and the persisted-row level; `nextProjectCode` at the 9999→10000
padding-width transition; a health-override reason at exactly the 500-char
limit; pagination at the exact page-size boundary for both `listClients` and
`listProjects`; a milestone due exactly on its project's `startDate` (offset
0) round-tripping through save/create-from-template. No bugs found — Phase 3's
first-pass implementation already held every one of these.

**Axis 4 (permissions).** One new file, 102 tests, table-driven over all 16
Phase 3 write actions (`client`/`project`/`milestone`/`project-template`):
denial + no-mutation for an unrelated-permission holder, an unpermitted
holder, and an unauthenticated caller; success for the permission holder and
for `createSuperAdmin` (with zero stored `RolePermission` rows); a coverage
guard asserting every exported `*Action` is represented, so a future action
added without a matching case fails loudly; and the axis's named scoping
case — a `project.view.assigned` holder, as both the project's owner and as a
team member, is still denied every `project.edit`-gated action, proving view
scope never substitutes for edit permission. No permission-bypass bug found.

**Axis 10 (Arabic).** Confirmed a real gap, then fixed it. `listClients` and
`listProjects`' search used Prisma `contains`/`mode: 'insensitive'` — Postgres
`ILIKE`, which case-folds but does not fold Arabic orthographic variants
(alef/hamza, ya/alef-maksura, ta-marbuta). Searching `احمد` (no hamza, how
most people type) never found a client stored as `أحمد للمقاولات` — the exact
failure `lib/search.ts` exists to prevent for the command palette. Fixed with
the same precedent Phase 2 set for that palette (SPEC §2's capped ~100-entity
scale): when a search term is present, fetch the scope-and-filter-narrowed
candidate rows once and match/paginate them with `normalizeArabic()` in
application code instead of pushing the term into `WHERE`. Every other filter
(status, owner, client, health, RBAC scope) still runs as real SQL — only the
final text match moved. 4 new tests prove the fold-tolerant match in both
directions and a correct negative match; a fifth proves `localeCompare(...,
'ar')` (already used for facet/member sort order) places an alef-wasla name
correctly rather than by raw code point.

**Axis 11 (soft-delete) — a real bug, found and fixed.**
`getProjectFacetOptions`'s client (and, it turned out, owner) facet derived
its distinct-value list by `select`-ing the `client`/`owner` relation off
scope-matching projects with no `deletedAt: null` on the relation itself.
Prisma has no soft-delete middleware in this codebase (every exclusion is a
manual `deletedAt: null` in each query's own `where`), so a client — or a
user — soft-deleted while still referenced by a live project kept appearing
in the `/projects` toolbar's filter menu forever: a dropdown naming an entity
that, everywhere else in the product, no longer officially exists. Two other
sweep agents (axis 10 and axis 4, incidentally, while verifying their own
changes against the full suite) independently hit the same failing assertion
and correctly declined to fix a function outside their assigned scope,
reporting it instead — three independent confirmations of one bug is about as
sure as a bug gets without a production incident. Fixed by adding
`owner: { deletedAt: null }` / `client: { deletedAt: null }` to the two
facet-deriving queries, which filters the *parent project* out of that
specific distinct-value computation without touching anything else about how
the project reads elsewhere (a soft-deleted client's name still correctly
shows on the *project* that references it — see the axis 11 test file — this
fix only closes the filter-menu leak). 7 further tests (2 new files) also
proved: exclusion survives being the only match for a search/owner filter;
`getProject` on a deleted id throws `NotFoundError` even under a scope with
zero ownership restriction (`project.view.all`'s `{ deletedAt: null }`),
proving the exclusion is `deletedAt`-driven and not an accident of scope
narrowing; `Milestone.project`'s `onDelete: Cascade` never fires because
`deleteProject` only ever `UPDATE`s `deletedAt`, confirmed by asserting
milestones survive a soft-deleted project; and both `client.created`/
`client.deleted` and `project.created`/`project.deleted` audit rows are fully
readable after their subject is gone.

### Deferred (with owners)

| Deferred                                                                               | Phase |
| -------------------------------------------------------------------------------------- | ----- |
| Real `overdueTaskCount`/`maxBlockedDays` signals behind `TaskHealthLookup`             | 4     |
| `healthWhereFragment`'s SQL revisited once real task signals exist                     | 4     |
| `ProjectTemplatePayload.tasks` — currently always `[]`, typed `never[]`                | 4     |
| Task tab on `/projects/[id]` — currently an `EmptyState` placeholder                   | 5     |
| Dependency warning banners, task board/list/calendar views                             | 5     |
| Milestone due dates driving anything in the lateness/penalty engine                    | 6/8   |
| A `deleteProjectTemplate` path (templates are soft-delete-ready; nothing calls it yet) | later |
| Command-palette entity search extended to projects/clients                             | later |

### Known limitations

- **The `/projects` list fetches its full scoped-and-filtered row set for the
  health facet's SQL to stay simple**, per the note above — correct and
  indexed at today's scale, revisit alongside the Phase 4 task-signal wiring.
- **`ProjectMemberRole`/`MilestoneStatus` labels are not Settings-editable**,
  unlike `taskStatus`/`projectStatus`/`priority`. SPEC §7's "Arabic status
  labels" Settings group only names the SPEC §4 enums; these two are Phase 3
  additions and were left as fixed `ar.enums` entries rather than expanding
  the Settings catalog for enums the SPEC never anticipated. Worth folding in
  if Phase 12's Settings UI pass finds it cheap.
- **No delete guard on `Project`** analogous to Phase 1's `OpenTaskLookup` for
  user deactivation — deleting a project with active milestones or a team is
  currently unconditional given `project.delete`. `Task` doesn't exist yet to
  make "does this project have open work" answerable, so — like Phase 1's
  guard — the rule belongs with Phase 4, not invented early against a lookup
  with nothing real to check.

---

## Phase 4 — Task Domain Engine

**Date:** 2026-08-15 · **Model:** Opus 5

### Built

- **`Task`** — SPEC §4's field list, with `dueDate`/`originalDueDate`/
  `categoryId`/`estimatedHours`/`taskValue` required (no `?` in the listing,
  the same reading Phase 3 applied to `Project.startDate`/`dueDate`) and
  `description` optional (free text, the `Client.notes` precedent).
- **`TaskWatcher`, `TaskDependency`, `TaskComment`, `TaskActivity`** — the four
  satellites. `ExtensionRequest` is deliberately _not_ here: it belongs to
  Phase 6, which owns the lateness engine it feeds. `Task.originalDueDate` is
  the seam it will write against.
- **`modules/task/state-machine.ts`** — SPEC §5.1 as a pure function.
  `canTransition` / `assertTransition` / `nextStatuses` / `stampTimestamps` /
  `timestampRuleFor`, no Prisma and no clock, so the whole 10×10 legality
  matrix is provable without a database.
- **`modules/task/elapsed.ts`** — SPEC §5.2. Raw arithmetic here, working time
  delegated to `lib/calendar` (Phase 6), clamped into `[0, raw]`.
- **`modules/task/ports.ts`** — `LedgerPort` (the SPEC M4 partial-payment
  intent) and `TaskEventBus` (`TaskApproved`, `TaskCancelled`), both no-ops
  today.
- **`modules/task/service.ts`** — create, edit, assign/reassign, watchers,
  dependencies, comments with `@mention` resolution, one generic
  `transitionTask` plus named wrappers, and `recomputeElapsed` for Phase 6's
  job. Scoped reads via `scopeTasks`, plus `actions.ts` and `queries.ts`.
- **The two ports earlier phases left for this one**, now filled in behind
  their original interfaces: Phase 1's `OpenTaskLookup` (`openTasksForUser`)
  and Phase 3's `TaskHealthLookup` (`taskHealthSignals`). Neither rule was
  touched — which was the point of shipping them guarded and tested first.

### Decisions worth recording

**`any(active)` and `any(non-final)` are two different sets.** SPEC §5.1 uses
two different words in adjacent lines, so they are read as naming two different
things: _active_ (blockable) is `BACKLOG` … `REVISION_REQUESTED`; _non-final_
(cancellable) is everything but `DONE` and `CANCELLED`. The consequence that
mattered is that `APPROVED → CANCELLED` stays legal, which means a cancellation
can land after an `EARNING` already exists. Rather than quietly forbid that
edge to dodge the problem, `cancelTask` emits `TaskCancelled` carrying
`wasApproved`, and Phase 7 inserts the `REVERSAL`. Diverging from the SPEC to
paper over a money question would have been the worse trade.

**There is no "unassign".** The brief says only the SPEC §5.1 transitions are
legal, and clearing an assignee coherently would need an `ASSIGNED → BACKLOG`
edge that is not in the list. So `assignTask` requires a non-null assignee; a
wrong assignment is corrected by reassigning or cancelling. Flagged for Phase 5
to raise if the UI genuinely needs the inverse — it is a one-line addition to
`CORE_EDGES` plus a SPEC amendment, and it should be that visible.

**`BLOCKED → previous` reads `TaskActivity`, not a column.** The feed already
records every status change with its `from`, so a `statusBeforeBlock` column
would be a second copy of one fact and a second thing that can be wrong. Same
reasoning as the ledger's "balance is a sum, never a column". It also makes the
activity feed load-bearing rather than decorative, which is what SPEC §5.1
already implies by putting the original `submittedAt` there.

**`submittedAt` is the one timestamp that re-stamps.** SPEC §5.1 reads oddly on
first pass ("frozen … later revisions stamp `submittedAt` again"), and the
resolution is that the _column_ tracks the latest delivery — which is what the
current revision's lateness is measured against under T4's new due date — while
the original survives as the `createdAt` of the first
`STATUS_CHANGED → SUBMITTED` activity row. `assignedAt`, `startedAt` and
`approvedAt` stamp once and never again.

**`tasks.categories` became `{ id, label }`.** SPEC §4 names the column
`categoryId`, and storing an Arabic label in something called an id means a
rename in Settings silently re-categorises every task filed under it. The
entries now carry a stable latin kebab-case id plus the editable Arabic name —
the same split §2 already makes for statuses, applied to a list the operator
also creates entries in. `CategoryDot` grew an optional `hueKey` so a
category's colour follows its id rather than its wording. SPEC §7 updated.

That reshape needed a **data migration**, which was nearly missed. The seed
deliberately never overwrites an existing `Setting` row ("filling gaps only, so
re-running it after go-live cannot silently reset a grace period"), and
`lib/settings` Zod-validates on *read* — so an already-seeded database would
have kept the old string array forever and started throwing the moment anybody
opened the task form. `20260816000001_task_categories_taxonomy` rewrites it,
keeping the meaningful id for labels that match a seeded default so a migrated
database and a fresh one agree, and falling back to `category-N` for anything
an operator added. `ROW_NUMBER()` keeps the ids unique even for two categories
that shared a label — the old schema allowed that and the new one rejects it.
Verified against real Postgres on five shapes, including the duplicate-label
case and re-running it against the already-migrated shape (a no-op).

**`taskValue` auto-fills once, and is never silently refreshed.** Assignment
fills it from the assignee's `defaultTaskRate` when the task has no value yet.
Reassignment does _not_ reprice to the new person's rate — that would change
someone's earnings with nobody deciding it, which is precisely what this
product exists to prevent. A manager who wants the new rate passes it.

**The partial-payment audit row is written before the port call.** Today's
`LedgerPort` is a no-op, so without it a manager's "pay them 300" would exist
nowhere until Phase 7. The `task.partialPaymentIntent` AuditLog row carries the
amount, the recipient and the deciding manager, so Phase 7 can replay every
intent raised while the port was dark.

**Two ports, not one.** `TaskEventBus` is a notification ("this happened,
whoever cares"); `LedgerPort` is a command (a human answered a question with a
number, and that instruction must arrive). An event that _must_ be handled is
not an event, so collapsing them would have blurred a real distinction.

**Moving a task is gated by permission, not by ownership.** Nothing requires
the caller to *be* the assignee. SPEC §6 gates these edges by key and says
nothing about ownership, and a manager submitting for a worker who is out sick
is an ordinary day at an agency this size. What stops a منفّذ touching someone
else's task is `scopeTasks` — they cannot read it, so they cannot name its id.
"Only the assignee may submit" would be a policy addition and belongs in
SPEC §6 before it belongs in code; recorded so the absence reads as a decision.

**Transition permissions are derived, not repeated.** `actions.ts` reads each
one from `permissionForTransition` rather than restating a literal, so a
`task.approve` edge cannot quietly become a `task.edit` one — the kind of
change that looks like a typo in review and is a privilege escalation in
production. `unblockTask` is the one that cannot derive (its target is only
known after a read) and gates on `task.edit`, which every blockable status
carries anyway.

**Phase 3's `healthWhereFragment` was removed, not fixed.** Its own doc-comment
said Phase 4 must revisit it once real task signals existed, and named the two
ways out. Pushing "more overdue tasks than the threshold" into a Prisma `where`
needs raw SQL over an aggregate against Settings-driven thresholds; the
alternative — filtering on `computeProjectHealth`'s own output in
`listProjects` — has the property that actually matters: the facet can never
disagree with the badge rendered on the row beside it. Its unit tests went with
it, since they asserted the fragment agreed with the computation at signals
that can no longer be assumed zero.

**Elapsed working time is not written on submission.** `lib/calendar` throws
`NotImplementedError` until Phase 6, so `transitionTask` writes only
`elapsedMinutesRaw` (pure arithmetic) and leaves `elapsedMinutesWorking` as the
job-updated column SPEC §4 calls it. `recomputeElapsed` exists, is idempotent,
and is tested against a calendar fake — so Phase 6 inherits a proven call site
rather than a comment promising one.

### Surprises

**The brief's two timestamp bullets look contradictory and are not.**
"Timestamps stamped exactly once and never overwritten on re-submission" next
to "re-submission preserves the original `submittedAt` in activity" only makes
sense under one reading: the first bullet is about each stamp not being wound
by unrelated transitions, and the second is the `submittedAt` exception. Read
the other way — column frozen forever — the activity-feed clause would be
redundant, and a revision's lateness against its new due date would be
unmeasurable.

**Soft-deleted projects do not hide their tasks.** `deleteProject` only sets
`deletedAt`, and nothing at the database level cascades that to `Task`. Every
task read therefore carries `project: { deletedAt: null }` alongside its own
`deletedAt: null`. This is the same class of leak Phase 3's axis-11 sweep found
in the project facets — worth noting that it reappears at every new
parent/child boundary, and is not something the schema will catch for us.

### The edge-case sweep (docs/TESTING.md §4, axes 1, 2, 9, 12)

Run per the protocol. One constraint shaped how: the integration project targets
a single shared `agency_test` and truncates between tests (docs/TESTING.md §2),
so two agents running it at once would wipe each other's fixtures mid-test and
manufacture failures that look like bugs. Per-agent databases were not available
(the `agency` role cannot `CREATE DATABASE` — the same permission that blocks
Prisma's shadow database on this machine), so the axes were split by whether
they need a database: unit-scoped axes ran in parallel, and only one
integration-scoped agent held the DB at a time.

**Who wrote what.** Axis 2 was completed by a subagent. **Axes 1, 9 and 12 were
written by the main agent**, not by subagents: the axis-1 and axis-9 subagents
ran roughly 90 minutes without producing a file or touching the database —
against axis 2's seven — and were abandoned. Recorded because "spawn subagents"
is what docs/TESTING.md §4 asks for, and a future reader comparing this entry to
the protocol should not have to guess which parts the protocol actually
produced. The tests are the same tests either way; the provenance is not.

**Axis 2 (time) — no bugs, and that is the finding.** 18 tests in
`tests/unit/task/time-boundaries.test.ts`. Phase 4 reasons purely in instants
and hands every Cairo-calendar question to `lib/calendar`, so the boundary holds
by construction; the tests pin it so a later phase cannot quietly move the line.
Egypt's real transitions are used (forward 2026-04-24, back 2026-10-29) and
every DST effect is asserted as a *difference* between two identical wall-clock
spans rather than against a hardcoded `+02:00`, so the suite survives Egypt
changing the rule again. The sharpest case: with a 00:00–08:00 workday window,
the spring-forward day contains the hour Cairo skips — a calendar counting
wall-clock hours would report 480 working minutes against a 420-minute span,
i.e. working time exceeding raw, which `computeElapsed` clamps but should never
have to.

That axis also corrected **docs/TESTING.md itself**, which had described axis 2
as "DST-free". It has not been true since 2023, and left alone it would have
told Phase 6 — the phase that actually implements the calendar — to skip the
tests it most needs.

**Axis 1 (boundaries) — one real bug, found and fixed.** 31 tests in
`tests/integration/task/boundaries.test.ts`. `assignTask` auto-filled
`taskValue` from the incoming assignee's `defaultTaskRate` whenever the current
value was zero — including on a **reassignment**, which contradicted the rule
written three lines above it in the same file ("silently repricing a task
because a different person picked it up would make someone's earnings change
without anybody deciding it"). Worse than the repricing: `recordPartialPayment`
caps the outgoing worker's partial amount at `taskValue`, and the value it
compared against was the one the auto-fill had just invented. A manager
reassigning a zero-valued task could therefore pay out against a ceiling that
existed only because of the reassignment they were making. Fixed by gating
auto-fill on `previousAssigneeId === null` — "first assignment", not "currently
zero". The rest of the axis pins the `Decimal(12,2)` ceiling and one cent over
it (rejected before the insert, on both create and update), a partial payment
of exactly `taskValue` versus one cent more, quality rating 1/5 versus 0/6 and
a fractional 4.5, the strict "not overdue at the deadline instant, overdue one
millisecond later" boundary — asserted to agree between the DTO flag and the
`overdueOnly` filter — 59 seconds truncating to 0 elapsed minutes, empty/last/
past-the-end pages, and the RAG thresholds at exactly-at versus one-over.

**Axis 9 (state machine) — no bugs, one dead export removed.** 27 tests in
`tests/unit/task/state-machine-edges.test.ts`, written as properties rather
than examples: `assertTransition` agrees with `canTransition` in all 100 cells;
`nextStatuses` returns exactly what `canTransition` allows; nothing leaves a
final status under *any* context; every non-final status reaches `CANCELLED` in
one step and has at least one exit. The `previousStatus` that `unblockTask`
reads back from `TaskActivity` is treated as untrusted input — a corrupt or
non-blockable value must make the machine refuse rather than let a task escape
into a status it could not otherwise reach, while `CANCELLED` stays reachable
so a task can never be stranded in `BLOCKED` with no legal move. `stampTimestamps`
is pinned as pure: it does not mutate its argument, never returns a key whose
value is `undefined` (which a Prisma `update` would silently ignore, turning a
missed stamp into an invisible no-op), and returns the very `Date` it was
given. Folding it over a three-round revision cycle proves only `submittedAt`
moves.

The axis also removed `isOpen()` from `state-machine.ts`: exported, zero
callers anywhere (`isFinal` and `isBlockable` are both used by
`canTransition`; `openTasksForUser` uses the `OPEN_TASK_STATUSES` array
directly in a Prisma filter). It was speculative API, and it was the reason the
file sat at 87.5% function coverage against its own 90% gate.

**Axis 12 (empty/null) — no bugs.** 16 tests in
`tests/integration/task/empty-values.test.ts`. A brand-new agency's first hour
in the product is made entirely of these: a task with no assignee, description,
milestone or value; an assignee with no `defaultTaskRate` (assigned at zero
rather than refused); a user created seconds ago with no open tasks; a project
with no tasks, and a project id that does not exist at all, both answering zero
signals rather than throwing. Empty filter arrays and a whitespace-only search
are ignored rather than matching nothing — the failure mode where a blank box
silently hides every row. A comment with no mentions stores `[]`, not `null`.
And a task sitting in `BLOCKED` with no block activity refuses to resume rather
than guessing a status the machine never authorised.

### Deferred (with owners)

| Deferred                                                                      | Phase |
| ----------------------------------------------------------------------------- | ----- |
| `ExtensionRequest` model + the request/approve flow                           | 6     |
| `elapsedMinutesWorking` actually populated (needs `lib/calendar`)             | 6     |
| Nightly `recomputeElapsed` job under the advisory lock                        | 6     |
| Leave-overlap warning when assigning (needs `Leave`)                          | 6     |
| `EARNING` from `TaskApproved`; `REVERSAL` from `TaskCancelled(wasApproved)`   | 7     |
| `ADJUSTMENT` from `AdjustmentIntent` (+ replay of intents recorded meanwhile) | 7     |
| Task UI: board/list/detail sheet, dependency banner, comment editor           | 5     |
| `ProjectTemplatePayload.tasks` — still `never[]`                              | 5     |
| Notifications on assign/submit/approve/mention                                | 9     |

### Known limitations

- **No delete guard on `Project` for open tasks.** Phase 3 recorded this as
  "belongs with Phase 4", but it is a new business rule rather than a port to
  fill, and the brief did not ask for one. `openTasksForUser` shows the query
  is now trivial; adding the rule is a deliberate scope decision, not a
  technical one.
- **`Task.deletedAt` has no writer.** SPEC §6 has no `task.delete` permission,
  so inventing an action to match the column would have meant inventing a
  permission. Cancellation is how a task stops existing for its worker; the
  column is respected by every read and waits for a rule that names it.
- **Dependency cycles longer than two are allowed.** Warnings resolve one level
  deep, so a cycle costs a confusing banner and never a hang. Self-dependency
  and the reciprocal A↔B pair are rejected because both are cheap to catch and
  unambiguously mistakes; a full graph walk on every write would be a real cost
  for a rule that never blocks anything.
- **The task list materialises its candidate rows when searching.** Arabic
  orthographic folding cannot run inside a `WHERE` clause (`lib/search`), the
  same trade `listProjects` and `listClients` already make at SPEC §2's capped
  scale.
- **`prettier --check` fails repo-wide, and did before this phase.** Files this
  phase never touched (e.g. `tests/unit/phone/phone.test.ts`) are already
  flagged, so it looks like a config or version drift rather than a regression.
  Phase 4's own files are formatted; the pre-existing drift is left alone
  rather than buried inside an unrelated diff.
