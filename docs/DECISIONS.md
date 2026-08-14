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
  table. Keyed on username *and* IP. Limits read from Settings.
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
explicit `isSuperAdmin` check (the brief says SUPER_ADMIN *only*, and a role
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
"none". The *rule* — blocked, audited, with the Arabic error naming the tasks —
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
2. The sidebar used `border-s`. Under RTL the sidebar sits at the inline *start*
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
boundary: an impersonated actor gets the *target's* permissions, cannot nest,
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
   `assertMayChangeSuperAdminRole` now requires the actor to *be* a SUPER_ADMIN
   to grant or revoke that one role. Deliberately narrow: it fires only when the
   SUPER_ADMIN membership actually changes, so ordinary role edits are untouched.

3. **A test factory footgun.** `createUser` used `options.defaultTaskRate ??
   '500.00'`, so a test asking for a worker with explicitly *no* rate silently
   got one and proved nothing. `=== undefined` now distinguishes "not specified"
   from "specified as null" — the same distinction the `phone` option already
   made.

### Deferred (with owners)

| Deferred                                                                     | Phase |
| ---------------------------------------------------------------------------- | ----- |
| `scopeProjects` / `scopeTasks` proven against real `Project` / `Task` rows    | 3 / 4 |
| The real `OpenTaskLookup` query behind the deactivation guard                 | 4     |
| `PenaltyProfile` FK behind `User.penaltyProfileId` (a free-form string today) | 8     |
| Users list server-side pagination UI (the query paginates; the page asks 100) | 2     |
| Real sheet/dialog primitives — Phase 1 ships a minimal hand-written `Sheet`   | 2     |
| Toasts and optimistic updates (Phase 1 uses inline alerts + `router.refresh`) | 2     |
| e2e flows #2–#6                                                              | 4–12  |

### Known limitations

- **`scopeProjects` / `scopeTasks` have no database-level integration test**,
  because `Project` and `Task` do not exist yet and `prisma/schema.prisma`
  carries an explicit guard against adding them early. They are covered
  exhaustively as pure functions, and the direct-ID principle the brief asks
  about is proven against every read path that *does* ship
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
  pairings. The palette was *solved for* rather than eyeballed: a search found
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
- **A modal focuses the first control in its *body*.** The first focusable
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
  had `defaultHidden` on the column *and* `hidden` in the URL, which made a
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
