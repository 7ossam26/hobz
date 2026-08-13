# Agency OS — Phased Build Plan & Claude Code Prompts

13 phases. Each is a separate Claude Code session. **Never run two phases in one
session** — that's how context gets thin and quality drops.

## How to run a phase

1. Start a fresh Claude Code session in the repo.
2. Set the model with `/model` per the table below.
3. Paste the phase prompt.
4. When it finishes: run `pnpm test`, review, commit, then run the **edge-case
   sweep** (last line of every prompt) as a second message.
5. Only then move to the next phase.

## Model allocation

| Phase | Title | Model | Why |
|---|---|---|---|
| 0 | Foundation & Architecture | **Opus 5** | Sets every structural decision |
| 1 | Auth, RBAC, Users, Audit, Settings core | **Opus 5** | Security-critical |
| 2 | Design System & App Shell | **Opus 5** | You said UI matters very much |
| 3 | Clients, Projects, Milestones | **Sonnet 5** | Structured CRUD |
| 4 | Task Domain Engine | **Opus 5** | State machine + money trigger |
| 5 | Task Experience (board/list/calendar/sheet) | **Sonnet 5** | UI on a settled domain |
| 6 | Calendar, Leave & Lateness Engine | **Opus 5** | Hardest correctness logic |
| 7 | Ledger, Pay Profiles & Payout Cycles | **Opus 5** | Financial core |
| 8 | Penalties & Bonuses | **Opus 5** | The product's whole point |
| 9 | Notifications & WhatsApp | **Sonnet 5** | Mechanical |
| 10 | Dashboards, Performance & Reports | **Sonnet 5** | Composition over existing data |
| 11 | Import Module | **Sonnet 5** | Self-contained |
| 12 | Settings UI, PWA, Perf, E2E, Deploy | **Opus 5** | Cross-cutting hardening |

> Token strategy: Opus phases are short and deep — let them think. Sonnet phases
> are long and broad — they burn fewer tokens per unit of output. If a Sonnet
> phase produces something structurally wrong, don't patch it in Sonnet; re-run
> that slice in Opus.

---

## PHASE 0 — Foundation & Architecture · Opus 5

```
You are starting a greenfield project called Agency OS.

Before writing code, create these three files at the repo root and in docs/,
using the content I am providing separately in this session:
  CLAUDE.md, docs/SPEC.md, docs/TESTING.md
[paste SPEC.md, CLAUDE.md, TESTING.md content here]

Then read all three and build ONLY the foundation. No features.

Deliver:
1. Next.js 15 App Router + TypeScript (strict) + pnpm. ESLint + Prettier.
2. Tailwind configured for RTL (logical properties only), dark mode via class,
   IBM Plex Sans Arabic loaded locally (no CDN), tabular-nums utility.
3. shadcn/ui initialised and RTL-verified.
4. Prisma + PostgreSQL. Schema containing ONLY: User, Role, Permission,
   RolePermission, UserRole, AuditLog, Setting. Migration committed.
5. docker-compose.yml: app + postgres + a second postgres database `agency_test`.
   A Dokploy-ready Dockerfile (multi-stage, standalone output).
6. The lib skeleton with real implementations where trivial and typed stubs
   elsewhere: lib/db, lib/money (Decimal helpers: add/sub/mul/pct/round2/format
   — fully implemented and tested), lib/settings (typed Zod-validated cached
   accessor, fully implemented), lib/audit, lib/rbac, lib/calendar, lib/scheduler
   (node-cron + Postgres advisory lock, fully implemented).
7. src/i18n/ar.ts — the Arabic string table. No Arabic literals anywhere else.
8. The module folder convention from SPEC §3, with one example module showing
   the actions/service/queries/schema pattern.
9. Vitest + Playwright configured exactly per docs/TESTING.md, including
   tests/setup/db-guard.ts and the factories/helpers skeleton.
10. Seed script: creates SUPER_ADMIN from env vars (SEED_ADMIN_USERNAME /
    SEED_ADMIN_PASSWORD), does NOT force a password change, and seeds the full
    permission catalog from SPEC §6 plus default Settings values.
11. README with local setup + Dokploy deploy notes.

Constraints:
- No business features. No UI beyond a bare RTL layout proving the font and
  direction work.
- Every invariant in CLAUDE.md must be structurally possible to honour later.
- lib/money and lib/settings ship with full unit tests now.

Finish by running: pnpm typecheck, pnpm lint, pnpm test. All must pass.
```

---

## PHASE 1 — Auth, RBAC, Users, Audit · Opus 5

```
Read CLAUDE.md, docs/SPEC.md (esp. §4 Identity, §6 Permissions), docs/TESTING.md.

Build authentication and the full access-control system. TESTS FIRST for
lib/rbac and the permission checks.

Deliver:
1. Auth.js v5 Credentials provider: username + password (bcrypt, cost 12),
   JWT session carrying userId + resolved permission set. Rate-limited login
   (in-memory + DB counter). No email anywhere, no self-signup, no password
   reset by user.
2. lib/rbac:
   - Permission catalog as a const in code, seeded to DB.
   - can(user, permission), assertCan(), and scope helpers:
     scopeProjects(user), scopeTasks(user) implementing view.all vs view.assigned
     from SPEC §6. These return Prisma where-clauses — scoping happens in the
     QUERY, never in the UI.
   - requirePermission() wrapper for server actions.
3. Roles module: create/edit/delete roles, name in Arabic + English, tick
   permissions grouped by domain. SUPER_ADMIN is hardcoded, undeletable,
   uneditable, implicitly holds every permission (including future ones).
4. Users module: create user (username, password, fullName, phone +20 validated
   & normalised, isWorker, payType, monthlySalary?, defaultTaskRate?,
   weeklyCapacityHours, roles[], penaltyProfile override slot), edit, deactivate,
   admin password reset. Deactivation is BLOCKED while the user has open tasks —
   return a clear Arabic error listing them.
5. Impersonation ("عرض كـ") for SUPER_ADMIN only: banner, exit button, every
   action while impersonating is audit-logged with both identities.
6. Audit log: append-only writer + a permission-gated viewer page with filters
   (actor, entity, date range) and a before/after diff view.
7. Middleware protecting all /(app) routes; permission-aware navigation.

Tests:
- Unit: can(), scope helpers, every permission key, password hashing.
- Integration: each server action called by a user lacking the permission must
  throw and must not mutate; a view.assigned user must not read another user's
  projects even by direct ID.
- e2e: flow #1 from docs/TESTING.md §6.

Then: spawn subagents to sweep axes 4, 11, 12 of docs/TESTING.md §4 and write
the resulting cases.
```

---

## PHASE 2 — Design System & App Shell · Opus 5

```
Read CLAUDE.md and docs/SPEC.md §9 (UI direction). This phase decides how the
entire product feels. Take it seriously — the users are freelancers who use
Linear, Notion and ClickUp daily.

Design brief: ClickUp's colour energy with Linear's discipline.
THE RULE: colour encodes data, chrome stays quiet. Neutral zinc surfaces, one
violet accent for actions/focus, and a distinct hue per task status, priority,
project and category. Every saturated colour on screen must mean something.

Explicitly banned: gradient buttons, glassmorphism, emoji as icons, blanket
rounded-3xl, stacked drop shadows, hero illustrations, generic AI-template
dashboard aesthetics.

Deliver:
1. Design tokens in Tailwind config: zinc-based surface scale (light + dark,
   never pure white or black), violet accent scale, a 10-hue semantic data
   palette with WCAG-AA-checked text pairings, spacing/radius/shadow scales
   (restrained), and a density scale driven by a CSS variable.
2. App shell: right-side collapsible sidebar (icon-only when collapsed, RTL
   correct), sticky contextual header with breadcrumb + primary action,
   notification bell placeholder, user menu, theme toggle, density toggle
   (persisted per user).
3. Ctrl+K command palette in Arabic: navigation, quick actions, entity search,
   with Arabic search normalization (alef/hamza/ya/ta-marbuta + diacritics
   stripped) implemented in lib/search and unit-tested.
4. The core component library on top of shadcn:
   - EntitySheet: the sheet-first primitive. Everything in this app is edited in
     a sheet or dialog over the current page, never by navigating away.
   - DataTable: server-driven pagination, sorting, faceted filters, saved views,
     column visibility, sticky header, virtualization above 100 rows, RTL.
   - StatusChip, PriorityFlag, HealthBadge, UserChip (avatar + WhatsApp button),
     MoneyText (tabular-nums, ar-EG, Western digits), DateText (Gregorian +
     Arabic month), RelativeTime, EmptyState (illustration-free, one clear CTA),
     Skeletons, ConfirmDialog (typed confirmation for destructive actions),
     Toast conventions, FormField wrappers bound to Zod.
5. A /design-system route (dev-only) rendering every component in both themes,
   both densities, with Arabic content.
6. Loading/error/not-found boundaries for the app segment.

Constraints:
- Server Components by default; 'use client' only where genuinely interactive.
- No Arabic literals in components — everything through src/i18n/ar.ts.
- Route JS budget < 180KB gzip; report the numbers when done.

Tests: component tests for DataTable, EntitySheet, MoneyText, DateText, the
search normalizer, and RTL rendering of the shell.
```

---

## PHASE 3 — Clients, Projects & Milestones · Sonnet 5

```
Read CLAUDE.md, docs/SPEC.md §4 (Work), §5.7, docs/TESTING.md.

Deliver:
1. Client module: name, optional phone (+20, WhatsApp button), notes.
   Lightweight only — NO financial tracking, no invoices, no payments.
2. Project module: code (auto-generated, editable), name, client, owner,
   members with per-project role, engagementType (chosen per project from the
   Settings-configurable list), status per SPEC enum, start/due dates,
   optional grace-period override, penalizeRevisionLateness override.
3. Milestones: name, due date, order, status; drag to reorder.
4. Project health (SPEC §5.7): computed RAG from Settings thresholds, plus a
   manual override that REQUIRES a reason and is audit-logged.
5. Project templates: save a project's milestone+task structure as a template;
   create a new project from a template.
6. UI: projects list (DataTable with status/health/owner/client facets),
   project detail page with tabs (Overview, Tasks placeholder, Team, Timeline),
   and create/edit via EntitySheet.
7. All reads go through scopeProjects() from lib/rbac — a view.assigned user
   must never see a project they aren't on, including by direct URL.

Tests: unit for health computation across threshold boundaries; integration for
RBAC scoping on every read path; audit assertions on health override.

Then: spawn subagents for edge-case axes 1, 4, 10, 11 of docs/TESTING.md §4.
```

---

## PHASE 4 — Task Domain Engine · Opus 5

```
Read CLAUDE.md, docs/SPEC.md §4, §5.1, §5.2. TESTS FIRST for the state machine.

This phase is domain logic only. Minimal UI — Phase 5 builds the experience.

Deliver:
1. Task model + migration exactly per SPEC §4, including originalDueDate,
   assignedAt/startedAt/submittedAt/approvedAt, elapsedMinutesRaw,
   elapsedMinutesWorking, delayReason, delayAttribution, taskValue.
2. A strict state machine in modules/task/state-machine.ts. Only the transitions
   in SPEC §5.1 are legal; anything else throws a typed DomainError. Each
   transition stamps its timestamp and writes a TaskActivity row.
3. Assignment: one accountable assignee + watchers. taskValue auto-fills from
   the assignee's defaultTaskRate and stays editable per task.
   Reassignment mid-task opens the SPEC "pay previous assignee?" decision —
   the service accepts an optional partialAmount and, if given, creates a manual
   ADJUSTMENT intent (the ledger itself lands in Phase 7; define the interface
   now and no-op it behind a clean port).
4. Dependencies: finish-to-start, WARNING ONLY. Starting a task whose dependency
   is unapproved must succeed and surface a warning — never block.
5. Comments with @mentions (parsed, stored) and a full TaskActivity feed.
   NO attachments, no uploads.
6. Priority, categories (from Settings), estimatedHours.
7. Elapsed time: computed as SPEC §5.2. Raw = submittedAt − assignedAt. Working
   excludes weekends/holidays/approved leave — call into lib/calendar, which
   Phase 6 will fully implement; define its interface now and unit-test against
   a fake implementation.
8. Approval flow: approve requires task.approve, captures a 1–5 quality rating,
   sets approvedAt, and emits a domain event `TaskApproved` that Phase 7 will
   subscribe to for the EARNING entry. Use an event/port boundary, not a direct
   ledger call.

Tests (write first):
- Every legal transition; every illegal transition throws.
- Timestamps stamped exactly once and never overwritten on re-submission.
- Re-submission after a revision preserves the original submittedAt in activity.
- Dependency warning does not block.

Then: spawn subagents for axes 1, 2, 9, 12.
```

---

## PHASE 5 — Task Experience · Sonnet 5

```
Read CLAUDE.md, docs/SPEC.md §9, and the Phase 2 component library. The domain
is settled — do not change modules/task/service.ts logic.

Deliver:
1. Kanban board: columns by status, drag-and-drop transitions that respect the
   state machine (illegal drops snap back with an Arabic toast), colour-coded
   cards showing assignee, priority, due date, overdue flag. RTL drag correct.
2. List view: DataTable with faceted filters (project, assignee, status,
   priority, category, overdue-only, due-this-week), saved views, bulk actions
   (assign, change priority, change due date).
3. Calendar view: month + week, tasks on their due dates, colour by status,
   click opens the detail sheet. This is the only timeline view — no Gantt.
4. Per-user remembered view preference (board/list/calendar).
5. Task detail EntitySheet — the heart of the app. In one sheet: title,
   description, status transition control, assignee + watchers, due date,
   priority, category, estimated hours, task value, elapsed time (raw and
   working, clearly labelled), dependencies with warnings, comments with
   @mentions, and the activity feed. Everything editable inline, optimistically,
   without leaving the page.
6. Quick-create task from the command palette and from the board column footer.
7. 30-second polling (interval from Settings) on board/list/calendar, pausing
   when the tab is hidden.

Constraints: no layout shift on optimistic update; virtualize columns over 100
cards; keep route JS under budget and report it.

Tests: component + integration tests for drag transitions (legal and illegal),
filters, optimistic rollback on server rejection, and RTL drag direction.
```

---

## PHASE 6 — Calendar, Leave & Lateness Engine · Opus 5

```
Read CLAUDE.md, docs/SPEC.md §4 (Calendar), §5.2, §5.3. TESTS FIRST — this is
the most correctness-critical logic in the product after the ledger.

Deliver:
1. lib/calendar, fully implemented, replacing the Phase 4 interface:
   - workingDaysBetween(from, to, userId?) — excludes configured weekend days
     (default Friday+Saturday), holidays, and that user's APPROVED leave.
   - workingMinutesBetween() for elapsed working time.
   - isWorkingDay(), addWorkingDays(), nextWorkingDay().
   - All Africa/Cairo, all storing UTC. Never subtract Dates directly.
2. Settings-driven WorkCalendar: weekend days, workday start/end, working days
   per month (used for daily-rate maths).
3. Holidays CRUD (Arabic name + date, recurring option) with an import path.
4. Leave module: request/record leave per user with type and date range,
   approve/reject with permission leave.manage, overlap detection, and a
   warning (not a block) when assigning a task that falls inside approved leave.
5. Lateness service per SPEC §5.3:
   - lateWorkingDays(task) measured at submittedAt vs dueDate + grace
     (project override → global default).
   - Time in review NEVER counts against the worker — prove this with a test.
   - Approved leave never generates lateness.
6. Extension requests: assignee requests with a reason; task.extend approves;
   approval moves dueDate, preserves originalDueDate, and triggers penalty
   recomputation (via the port — Phase 8 implements the recompute).
7. Escalation rules from Settings: N days overdue → notify PM; M days → notify
   admin + force project health RED. Emit events; Phase 9 delivers them.
8. Scheduled job (03:00 Cairo) recomputing elapsed working time and overdue
   flags, running under the advisory lock, idempotent.

Tests (write first, and be exhaustive):
- Deadline landing on Friday, on Saturday, on a holiday, on the eve of a holiday.
- A leave range spanning the deadline; leave starting mid-task; leave rejected.
- Submission ON a weekend/holiday must not increase lateness and must not
  decrease it (SPEC §5.2 edge case).
- Grace period 0h, 24h, 72h; project override beating global default.
- Task submitted on time but approved 10 days later → zero lateness.
- Extension approved before due date → zero lateness; approved after → recompute.
- Month boundaries, February, and the 28th/31st.

Then: spawn subagents for axes 1, 2, 3, 5, 12.
```

---

## PHASE 7 — Ledger, Pay Profiles & Payout Cycles · Opus 5

```
Read CLAUDE.md, docs/SPEC.md §4 (Money), §5.5. TESTS FIRST. This is the
financial core — treat every invariant as a hard requirement.

Deliver:
1. LedgerEntry: append-only. Enforce it at the database level (a trigger or rule
   rejecting UPDATE/DELETE) as well as in code. There is NO balance column.
   Balances are always SUM(amount), computed in a single indexed query.
2. Pay profiles on User: SALARY, PER_TASK, or HYBRID, with monthlySalary and
   defaultTaskRate. dailyRate(user) = monthlySalary ÷ settings.workingDaysPerMonth.
3. Earnings: subscribe to the TaskApproved event from Phase 4. Approval — and
   only approval — creates an EARNING entry equal to task.taskValue. Cancelled
   tasks never create earnings. Approving twice must not double-pay.
4. Salary accrual: one SALARY entry per salaried worker per cycle. Approved
   leave is fully paid.
5. Advances (سلفة): recorded any time by advance.create as a negative ADVANCE
   entry. They settle automatically at month-end because balance is a sum —
   do not write special-case deduction code.
6. Manual ADJUSTMENT entries (used by Phase 4's reassignment decision), requiring
   a reason.
7. PayoutCycle: auto-closes on settings.payoutCycleDay at 23:59 Cairo via the
   scheduler; also closeable early by permission. Closing generates one DRAFT
   Payout per worker with unpaid entries in the period:
     gross = EARNING + SALARY; net = gross − PENALTY + BONUS − ADVANCE.
8. Payout lifecycle DRAFT → APPROVED (payout.approve) → PAID (payout.markPaid),
   with partial payment: paidAmount ≤ net, remainder stays outstanding.
   Payment methods from a Settings-configurable list, plus reference + note.
   A payout can never be negative — if deductions exceed earnings, the payout
   floors at zero and the surplus carries forward as a debit balance into the
   next cycle. Write this test explicitly.
9. Worker-facing "مستحقاتي" page: their own ledger, current balance, cycle
   history, payout statements. Gated by ledger.view.own. NOT on their dashboard.
10. Every ledger write and payout state change writes an AuditLog row.

Tests (write first):
- Balance = sum, across thousands of entries, with correct 2dp rounding.
- Double approval → one earning.
- Deductions exceeding earnings → payout is 0, carry-forward is exact.
- Advance larger than the cycle → carries correctly.
- Partial payment arithmetic across two payments.
- Concurrent cycle close (two calls) → one cycle, one payout per worker.
- Any attempt to UPDATE or DELETE a ledger row fails at the DB level.

Then: spawn subagents for axes 5, 6, 7, 8, 12.
```

---

## PHASE 8 — Penalties & Bonuses · Opus 5

```
Read CLAUDE.md, docs/SPEC.md §5.4. TESTS FIRST.

This is the reason the product exists: the manager must be able to say
"this is the system's calculation, not my decision." Deductions are AUTOMATIC.

Deliver:
1. PenaltyProfile: mode (FIXED_PER_DAY, PCT_TASK_VALUE_PER_DAY,
   PCT_DAILY_RATE_PER_DAY, FIXED_ONCE, PCT_TASK_VALUE_ONCE), value, graceHours.
   One global default in Settings; an optional per-user override. Managed in UI.
   NO CAP on penalty amount — this is deliberate.
2. Penalty calculation service per SPEC §5.4, using lib/calendar for
   lateWorkingDays and lib/money for arithmetic. No magic numbers.
3. The daily job (03:00 Cairo, advisory lock) plus recomputation on every task
   status change and on extension approval:
   - Exactly ONE active auto PENALTY entry per task at any time.
   - Recalculation NEVER updates a row: insert REVERSAL, then insert the new
     PENALTY. Prove idempotency: running the job 10× yields one net penalty.
   - Accrual freezes the moment the task reaches SUBMITTED.
   - If lateness drops to zero (extension approved), the existing penalty is
     reversed to zero.
4. Revision lateness: honour settings.penalizeRevisionLateness (default ON).
   Penalty from the original delivery is frozen and stands; the revision accrues
   separately against the new due date. Both are visible and separately labelled.
5. Manual penalties: reason is free text only ("أخرى") per the agreed design,
   requiring penalty.create.
6. Bonuses: manual only, amount + free-text reason, requiring bonus.create.
7. Reversal: requires penalty.reverse / bonus.reverse, mandatory reason, inserts
   an offsetting REVERSAL entry, never deletes. Reversing an already-reversed
   entry must fail. Reversing an entry inside a PAID payout must fail with a
   clear Arabic error.
8. Worker notification on every penalty and bonus (non-dismissable for
   penalties). The worker CANNOT contest in-system — no dispute UI. The
   notification shows the full calculation breakdown: due date, grace, working
   days late, formula, amount.
9. Manager UI: a penalties/bonuses register with filters, a per-task breakdown
   panel inside the task sheet, and a one-click reverse with reason.
10. Reports: total deductions per period surfaced as agency income (SPEC R4).
    No profit or margin calculations anywhere.

Tests (write first):
- Every mode against hand-computed expected values, at 2dp.
- Idempotency: 1×, 3×, 10× job runs.
- Freeze on submission; no further accrual while in review.
- Extension approved after penalty accrued → reversed to exactly zero.
- Revision lateness with the flag ON and OFF.
- Reversal permission denial; double reversal; reversal after PAID.
- Penalty on a salaried worker uses dailyRate; on a per-task worker uses
  taskValue; on a HYBRID worker resolves per the task type.

Then: spawn subagents for axes 1, 3, 5, 6, 7, 8.
```

---

## PHASE 9 — Notifications & WhatsApp · Sonnet 5

```
Read CLAUDE.md, docs/SPEC.md §8.

Deliver:
1. Notification model + in-app delivery only. Bell with unread count, drawer,
   mark-read / mark-all-read, deep link to the entity, 30s polling.
2. All events from SPEC §8, emitted by the existing domain events — do not
   scatter notify() calls through services; subscribe to events centrally.
3. Per-user preferences page. TASK_ASSIGNED and TASK_OVERDUE cannot be
   disabled — enforce server-side, and grey them out with an explanation in UI.
4. Daily manager digest at 08:00 Cairo (scheduler): overdue tasks, tasks awaiting
   approval, at-risk projects. Delivered as a single in-app notification with a
   summary view.
5. WhatsApp deep links everywhere a person appears: user chips, task assignee,
   client record, payout row, penalty notification. Format
   https://wa.me/<normalised phone>?text=<encoded Arabic template>.
   Templates configurable in Settings with variables ({name}, {task}, {due},
   {amount}). No API, no integration, no message sending — link only.
6. Escalation notifications wired to the Phase 6 rules.

Tests: preference enforcement (the two mandatory types cannot be disabled even
via a direct action call), digest aggregation correctness, phone normalisation
(01xxxxxxxxx → +201xxxxxxxxx) and URL encoding of Arabic templates.
```

---

## PHASE 10 — Dashboards, Performance & Reports · Sonnet 5

```
Read CLAUDE.md, docs/SPEC.md §5.6, and the J-series answers.

Deliver:
1. Manager dashboard: overdue tasks, projects at risk, tasks awaiting my
   approval — as the three primary widgets. Secondary: workload heatmap across
   workers, this cycle's pending payouts, this month's total deductions.
   Server Components, no client waterfalls, no chart library in the initial
   bundle (lazy-load charts below the fold).
2. Worker dashboard: my active tasks, what's due next, awaiting my submission vs
   awaiting review, my performance score with its component breakdown.
   Do NOT show earnings here — earnings live on the separate مستحقاتي page.
3. Performance scoring per SPEC §5.6, weights read from Settings:
   on-time 50%, quality rating 30%, volume 10%, estimate accuracy 10%.
   Penalties and bonuses do NOT affect the score. Computed on demand with a
   cached daily recomputation. Visible to the worker.
4. Workload/capacity: utilisation = Σ estimatedHours of active tasks ÷
   weeklyCapacityHours, shown as a bar per worker with over-capacity warning on
   the assignment screen.
5. Reports, all permission-gated and all exportable to .xlsx (Arabic headers,
   RTL sheet direction, Western numerals, correct column widths):
   - Payout statement per worker per cycle
   - Project summary (tasks, completion, overdue, health)
   - Worker performance report
   - Monthly agency summary (completed tasks, total paid, total deductions
     as agency income, on-time rate)
6. Global calendar view of all deadlines, filterable by project/worker.

Constraints: every dashboard query indexed and measured — log query times and
report anything over 100ms. Paginate everything.

Tests: performance score maths at boundaries (no tasks, all late, all on time),
utilisation maths, .xlsx export round-trip with Arabic content, RBAC on every
report.
```

---

## PHASE 11 — Import Module · Sonnet 5

```
Read CLAUDE.md, docs/SPEC.md §10.

Deliver:
1. Template download: generate .xlsx templates with Arabic headers, RTL sheet
   direction, an instructions sheet, data-validation dropdowns for enums, and a
   sample row — for users, clients, projects, tasks.
2. Upload + parse in memory (SheetJS). Files are NEVER written to disk or any
   storage. Enforce a size limit and row cap.
3. Dry-run preview: a table showing exactly what will be created, what will be
   updated, and every invalid row with a per-row, per-field Arabic error. Nothing
   is written until the user confirms.
4. Confirmed import runs in a single transaction: all-or-nothing per entity type,
   with a result summary and an audit log entry recording the row counts.
5. Relationship resolution by human-readable key (project by code, user by
   username, client by name) with clear errors when unresolved.
6. Permission-gated by import.run.

Tests: Arabic text round-trip (no mojibake), mixed valid/invalid files, duplicate
usernames, unresolved references, empty file, wrong template version, and a
guarantee that a failed import leaves zero rows behind.

Then: spawn subagents for axes 1, 10, 12, plus e2e flow #6 from docs/TESTING.md.
```

---

## PHASE 12 — Settings UI, PWA, Performance, E2E & Deploy · Opus 5

```
Read CLAUDE.md and docs/SPEC.md §7, §9, §11. This is the hardening phase.

Deliver:
1. Settings UI: one permission-gated page (settings.view / settings.edit) with
   sections for every group in SPEC §7 — penalty defaults, grace, working days
   per month, weekend days, holidays, leave types, payout cycle day, payment
   methods, notification rules & thresholds, performance weights, task priorities
   & categories, engagement types, health thresholds, polling interval, Arabic
   status labels, WhatsApp templates, penalizeRevisionLateness.
   Every change validated, audit-logged, and cache-invalidated immediately.
2. Audit sweep: grep the codebase for hardcoded business numbers and move any
   survivors into Settings. Report what you found.
3. Installable PWA: manifest, icons, offline shell, "add to home screen" prompt.
   No offline data sync.
4. Performance pass: measure and report route-by-route JS bundle size and LCP.
   Fix anything over 180KB gzip or 1.8s. Add missing DB indexes based on the
   actual query plans — run EXPLAIN on the ten heaviest queries and show me the
   results. Virtualize any list still rendering over 100 rows.
5. Security pass: verify every server action performs a permission check
   (write a test that enumerates all actions and asserts each one throws for an
   unprivileged user). Rate-limit login. Set security headers. Confirm no secret
   is bundled client-side.
6. Complete the six Playwright e2e flows from docs/TESTING.md §6. All must pass.
7. Nightly pg_dump job retained 14 days, written to a server path. NO download
   button in the UI.
8. Dokploy deployment: production Dockerfile, healthcheck endpoint, migration-on-
   deploy strategy, env var documentation, and a rollback note.
9. Demo seed: a MODEST dataset — about 12 workers, 5 projects, 60 tasks across
   all statuses, one closed payout cycle, a handful of penalties and bonuses, all
   with realistic Arabic names and content. Keep it small and readable, not a
   data dump.
10. Final docs pass: update docs/SPEC.md with anything that changed, complete
    docs/DECISIONS.md, and write docs/RUNBOOK.md (how to add a permission, add a
    setting, add a penalty mode, close a cycle manually, restore a backup).

Finish with the full suite green, coverage gates met (90% financial/RBAC/
calendar/penalty, 70% global), and a written summary of known limitations.
```

---

## After the build

Deferred by design, in rough priority order if you want them later:
recurring tasks for retainers · client read-only portal · file attachments (needs
R2) · WhatsApp Business API · Gantt · multi-currency · client invoicing ·
historical snapshots · freelancer skills & assignment suggestions.

Each is additive against this schema. None requires a rewrite — which was the
point of the ledger and settings decisions in Phase 0.
