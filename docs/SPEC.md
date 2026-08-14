# Agency OS — Master Specification (v1)

> Single source of truth. Every phase prompt refers back to this file.
> Path in repo: `docs/SPEC.md`

---

## 1. Product summary

An internal operations system for a small digital agency (max ~100 users).
It tracks **projects → tasks → people → money**. Its core promise:

> Every worker's tasks, delays, earnings and deductions are calculated by the
> system, not by the manager's memory or judgement.

Clients never log in. There is no P&L, no invoicing, no CRM.

**Language:** Arabic only, full RTL. Code, DB, and identifiers in English.

---

## 2. Locked decisions

| ID | Decision |
|----|----------|
| Tenancy | Single tenant. Deploy the repo separately per agency. |
| Users | Max ~100. Invite-only, created by SUPER_ADMIN. Username + password. **No email anywhere.** |
| Roles | Fixed **permission catalog** in code. Roles are created/named/edited in the UI. `SUPER_ADMIN` is hardcoded, undeletable, has all permissions implicitly. |
| Worker flag | Every user has `isWorker` (bool) independent of role. Payment profile attaches to the user, not the role. |
| Pay models | `SALARY` (monthly), `PER_TASK`, or `HYBRID` (both) — set per user. |
| Penalties | **Fully automatic.** Computed daily by a scheduled job, written straight to the ledger. Reversible by permission, always audit-logged. |
| Penalty formula | Configured **per user** (global default in Settings, per-user override). |
| Penalty cap | None. |
| Penalty as income | Deductions are reported as agency income in reports only. No profit/margin math anywhere. |
| Bonuses | Manual only, with free-text reason. |
| Clients | Lightweight label on a project (name, optional phone, notes). **No money-in tracking.** |
| Currency | EGP only. `Decimal(12,2)`. Western numerals. |
| Files | **No file storage, no attachments, no uploads** — except `.xlsx` import (parsed in memory, never persisted). |
| Notifications | In-app only + WhatsApp deep links (`wa.me`). No API, no email, no SMS. |
| Real-time | Polling every 30s (configurable). No websockets. |
| Timezone | `Africa/Cairo` everywhere. Store UTC, render Cairo. |
| Revisions | `REVISION_REQUESTED` status exists. No round counting, no limits, no billing. |
| Statuses | Fixed enums. Arabic **labels** are editable in Settings; the enum values are not. |
| Hosting | Hostinger VPS via Dokploy, Docker. Postgres in a container. |
| Deletion | Soft-delete everywhere. Ledger entries are immutable — never updated, never deleted. |

### Decisions I made on your behalf (flagged for override)

- **T4 — revision lateness.** A revision request sets a **new due date**. Penalty already accrued on the original delivery stands and is frozen. The revision then accrues against the new due date, under a Settings flag `penalizeRevisionLateness` (**default: ON**). Turning it off costs one boolean.
- **M4 — reassignment mid-task.** Reassignment opens a dialog: *"Pay the previous assignee a partial amount?"* → optional amount → creates a manual `ADJUSTMENT` ledger entry. Never automatic.
- **R2 — per-user formula.** Implemented as a `PenaltyProfile` (mode + value + grace), defaulted globally and overridable per user. This satisfies "I configure it per person" without a formula parser.
- **B6 vs J3 — worker earnings.** Not on the worker dashboard (per J3), but on a separate `مستحقاتي` page showing their own ledger (per B6).

---

## 3. Tech stack

- **Next.js 15** (App Router, Server Components, Server Actions) + **TypeScript strict**
- **PostgreSQL 16** + **Prisma**
- **Tailwind CSS** + **shadcn/ui** (RTL-configured)
- **Auth.js v5** — Credentials provider, JWT session, bcrypt
- **Zod** — one schema per input, shared between server action and form
- **node-cron** in-process, guarded by a Postgres advisory lock
- **Vitest** (unit + integration) + **Playwright** (e2e)
- **Docker Compose** for local + Dokploy deploy

**Directory shape**

```
src/
  app/(auth)/ (app)/ api/
  modules/<domain>/{actions.ts,service.ts,schema.ts,queries.ts,types.ts}
  components/{ui,shared,layout}
  lib/{auth,db,rbac,money,calendar,settings,audit,notify}
prisma/
tests/{unit,integration,e2e,factories,fixtures}
docs/{SPEC.md,PHASES.md,TESTING.md}
```

**Rule:** business logic lives in `modules/*/service.ts` — pure, DB-injected, unit-testable. Server actions are thin: auth → permission check → zod parse → service call → revalidate.

---

## 4. Domain model

### Identity & access

```
User        id, username(unique), passwordHash, fullName, phone(+20…),
            isWorker, isActive, mustChangePassword, timezone,
            payType(SALARY|PER_TASK|HYBRID), monthlySalary?, defaultTaskRate?,
            weeklyCapacityHours, penaltyProfileId?, createdAt, deletedAt
Role        id, nameAr, nameEn, isSystem, description
Permission  key (e.g. 'task.assign')   ← seeded from code catalog, not user-editable
RolePermission  roleId, permissionKey
UserRole        userId, roleId          ← many-to-many
AuditLog    id, actorId, impersonatorId?, action, entity, entityId,
            before(json), after(json), reason?, ip, createdAt   ← append-only
LoginThrottle   key, failures, firstFailureAt, lastFailureAt, lockedUntil?
                ← key is `user:<username>` or `ip:<addr>`; not an audit table
```

**Identity decisions settled in Phase 1**

- **`username` is immutable.** It is the login handle, the throttle key and the
  name in every audit row. Renaming it would lock the person out and orphan
  their history. Correcting one means creating a new account.
- **`mustChangePassword` is set `true` on admin-create and admin-reset**, and
  cleared only by the user changing their own password. It is what stops an
  admin from holding a working credential for someone else's account past the
  next login. The seeded `SUPER_ADMIN` is the one exception (the operator chose
  that password deliberately).
- **`AuditLog.impersonatorId` is a column, not a key inside `after`.** It keeps
  the before/after diff clean and makes "everything done while impersonating"
  an indexed query.
- **`LoginThrottle` is mutable and deletable** — it is a counter, not a record.
  The permanent record of a login attempt is the `AuditLog` row.
- **Only a SUPER_ADMIN may grant or revoke the `SUPER_ADMIN` role.** Assigning
  roles is part of `user.edit`, and one assignable role holds every permission
  implicitly — so without this, `user.edit` is transitively every permission in
  the catalog. The restriction is narrow: it applies to that one role, and only
  when the membership actually changes.
- **Role member counts exclude soft-deleted users.** A role is undeletable while
  it has members, so counting departed employees would strand it permanently.
  Deactivated users still count — that account exists and can be reactivated.

### Work

```
Client      id, name, phone?, notes, deletedAt
Project     id, code, name, clientId?, ownerId, engagementType,
            status, startDate, dueDate, healthOverride?, healthReason?,
            gracePeriodHours?, penalizeRevisionLateness?, deletedAt
ProjectMember    projectId, userId, roleInProject
Milestone   id, projectId, name, dueDate, order, status
Task        id, projectId, milestoneId?, title, description,
            assigneeId?, status, priority, categoryId,
            estimatedHours, taskValue,                 ← money the assignee earns
            dueDate, originalDueDate,
            assignedAt, startedAt, submittedAt, approvedAt,
            elapsedMinutesRaw, elapsedMinutesWorking,  ← denormalized, job-updated
            delayReason?, delayAttribution?, deletedAt
TaskWatcher      taskId, userId
TaskDependency   taskId, dependsOnTaskId              ← warning only, never blocking
TaskComment      id, taskId, authorId, body, mentions[]
TaskActivity     id, taskId, actorId, type, from, to, createdAt
ExtensionRequest id, taskId, requestedById, oldDueDate, newDueDate,
                 reason, status(PENDING|APPROVED|REJECTED), decidedById
ProjectTemplate  id, name, payload(json)              ← spawns milestones+tasks
```

### Calendar

```
WorkCalendar   weekendDays[] (default [FRI,SAT]), workdayStart, workdayEnd
Holiday        id, date, nameAr
Leave          id, userId, startDate, endDate, type, status, note
```

### Money — immutable ledger

```
LedgerEntry  id, userId, cycleId?, type, amount(signed Decimal 12,2),
             taskId?, note, isAutoGenerated, reversesEntryId?,
             createdById, createdAt          ← INSERT ONLY
             type ∈ EARNING | SALARY | PENALTY | BONUS | ADVANCE
                     | ADJUSTMENT | PAYOUT | REVERSAL

PayoutCycle  id, periodStart, periodEnd, status(OPEN|CLOSED|PAID), closedAt
Payout       id, userId, cycleId, gross, penalties, bonuses, advances, net,
             status(DRAFT|APPROVED|PAID), paidAmount, method, reference, note,
             approvedById, paidAt
PenaltyProfile id, name, mode, value, graceHours, isDefault
             mode ∈ FIXED_PER_DAY | PCT_TASK_VALUE_PER_DAY
                    | PCT_DAILY_RATE_PER_DAY | FIXED_ONCE | PCT_TASK_VALUE_ONCE
PaymentMethod  id, nameAr, isActive        ← Instapay, Vodafone Cash, bank, cash…
```

**Balance is always `SUM(amount)`.** There is no mutable balance column anywhere.

### Enums

```
ProjectStatus  DRAFT PROPOSED ACTIVE ON_HOLD IN_REVIEW COMPLETED CANCELLED ARCHIVED
TaskStatus     BACKLOG ASSIGNED IN_PROGRESS SUBMITTED IN_REVIEW
               REVISION_REQUESTED APPROVED DONE BLOCKED CANCELLED
Priority       LOW MEDIUM HIGH URGENT
EngagementType FIXED_PRICE RETAINER MILESTONE_BASED HOURLY   ← chosen per project
DelayAttribution WORKER CLIENT INTERNAL DEPENDENCY
```

---

## 5. Business rules (the ones tests must prove)

### 5.1 Task state machine

Legal transitions only; anything else throws.

```
BACKLOG → ASSIGNED → IN_PROGRESS → SUBMITTED → IN_REVIEW
IN_REVIEW → APPROVED → DONE
IN_REVIEW → REVISION_REQUESTED → IN_PROGRESS → SUBMITTED …
any(active) → BLOCKED → previous
any(non-final) → CANCELLED
```

- `assignedAt` is stamped on entry to `ASSIGNED`.
- `submittedAt` is stamped on entry to `SUBMITTED`, and **frozen** — later revisions stamp `submittedAt` again but the original is preserved in `TaskActivity`.
- `APPROVED` is the only event that creates an `EARNING` ledger entry.
- Dependencies produce a **warning banner**, never a block.

### 5.2 Elapsed time

- `elapsedMinutesRaw = submittedAt − assignedAt` (wall clock).
- `elapsedMinutesWorking` excludes weekends, holidays, and the assignee's approved leave.
- **Edge case (T2):** if a worker submits on a weekend/holiday, that is allowed and the submission timestamp is real. Working-time simply does not accrue on that day, so it cannot increase the penalty. Working *voluntarily* on a day off never hurts and never helps.

### 5.3 Lateness

- Measured at `submittedAt` vs `dueDate`. Time sitting in review **never** counts against the worker.
- `lateWorkingDays = workingDaysBetween(dueDate + grace, min(now, submittedAt))`.
- Grace: project override → global default.
- An **approved extension** moves `dueDate`, keeps `originalDueDate`, and voids/recomputes any penalty accrued past the new date.
- Approved leave never generates lateness.

### 5.4 Penalty engine

Runs daily (03:00 Cairo) and on every task status change.

```
profile = user.penaltyProfile ?? settings.defaultPenaltyProfile
if lateWorkingDays <= 0 → no entry (reverse any existing auto entry)
amount = switch profile.mode
  FIXED_PER_DAY            → value × lateWorkingDays
  PCT_TASK_VALUE_PER_DAY   → task.taskValue × value% × lateWorkingDays
  PCT_DAILY_RATE_PER_DAY   → dailyRate(user) × value% × lateWorkingDays
  FIXED_ONCE               → value
  PCT_TASK_VALUE_ONCE      → task.taskValue × value%
dailyRate(user) = monthlySalary ÷ settings.workingDaysPerMonth
```

- **Idempotent:** exactly one active auto `PENALTY` entry per task. Recalculation = insert `REVERSAL` + insert new `PENALTY`. Never `UPDATE`.
- Frozen the moment the task reaches `SUBMITTED`.
- No cap. A payout may reach zero but **never goes negative** — surplus deduction carries to the next cycle as a debit balance.
- Worker gets a non-dismissable notification. Worker cannot contest in-system.
- Reversal requires `penalty.reverse` permission + a mandatory reason.

### 5.5 Payout cycle

- Cycle auto-closes on `settings.payoutCycleDay` (default 28) at 23:59 Cairo.
- On close: for each worker, generate a `Payout` in `DRAFT` with
  `net = SUM(all unpaid ledger entries in period)` where
  `gross = EARNING + SALARY`, minus `PENALTY`, plus `BONUS`, minus `ADVANCE`.
- Salaried workers get one `SALARY` entry per cycle. Approved leave is paid.
- `DRAFT → APPROVED` requires `payout.approve`. `APPROVED → PAID` records method,
  reference, date, and supports **partial payment** (remainder stays outstanding).
- Advances are recorded whenever, and settle automatically at cycle close because
  balance is a sum.

### 5.6 Performance score (0–100, weights in Settings)

Revision-rate is dropped (no revision tracking). Replacement weights:

| Component | Default weight |
|---|---|
| On-time delivery rate | 50% |
| Manual quality rating (1–5, set on approval) | 30% |
| Completed task volume vs peers | 10% |
| Estimate accuracy (`estimatedHours` vs working elapsed) | 10% |

Visible to the worker. Penalties/bonuses do **not** feed the score (money only, per G9).

### 5.7 Project health (RAG)

`RED` if any: overdue tasks > threshold, project past `dueDate`, blocked > N days.
`AMBER` if approaching. Manual override with mandatory reason.

---

## 6. Permission catalog (seeded, not user-editable)

```
user.view user.create user.edit user.deactivate user.resetPassword user.impersonate
role.view role.manage
client.view client.manage
project.view.all project.view.assigned project.create project.edit project.delete
task.view.all task.view.assigned task.create task.edit task.assign task.approve
task.extend task.cancel task.comment
calendar.manage leave.view leave.manage
ledger.view.all ledger.view.own
penalty.view penalty.create penalty.reverse
bonus.create bonus.reverse
advance.create
payout.view payout.generate payout.approve payout.markPaid
report.view report.export
settings.view settings.edit
import.run
audit.view
```

**Scoping rule:** `*.view.all` sees everything; `*.view.assigned` is limited to
projects where the user is owner/member, or tasks where they are assignee/watcher.
Enforcement lives in `lib/rbac` and is applied in **queries**, not in the UI.

**How that sentence is read (settled in Phase 1).** Literally, and per entity:
`scopeProjects` → owner or `ProjectMember`; `scopeTasks` → assignee or
`TaskWatcher`. A project owner holding only `task.view.assigned` therefore does
**not** see every task in their project — in practice such a manager holds
`task.view.all`. Widening this is a policy change and belongs here before it
belongs in code; restrictive is the safe direction to be wrong in.

The scope helpers also carry `deletedAt: null` (invariant 8), with an explicit
`includeDeleted` opt-in, because they are the one function every scoped read
already has to call.

**Enforcement layers, in order of authority:**

1. **The query layer** — `assertCan` in `queries.ts`, `requirePermission` on
   every action, against permissions re-read from the database. This is the
   enforcement.
2. **Middleware** — routes on the JWT's copy of the permission set. Runs at the
   edge where Prisma does not, so the copy can be up to one session stale. It
   decides where to send a browser, not what data exists.
3. **Navigation** — cosmetic. Hiding a link is not security.

---

## 7. Settings (global only, one permission-gated page)

Penalty defaults · grace period · working days per month · weekend days ·
holidays · leave types · payout cycle day · payment methods · notification rules
& thresholds · performance weights · task priorities & categories · engagement
types · project health thresholds · polling interval · status Arabic labels ·
`penalizeRevisionLateness` · **login throttle & password policy**
(`security.maxLoginAttempts`, `security.loginWindowMinutes`,
`security.lockoutMinutes`, `security.minPasswordLength`).

The security group is here for the same reason as everything else: during an
incident an operator has to tighten the lockout, and during a lockout storm
loosen it, and neither should need a redeploy.

Backed by a typed `Setting` table with a cached, Zod-validated accessor
(`getSetting('penalty.defaultGraceHours')`). **No magic numbers in code, ever.**

---

## 8. Notifications

In-app only. Bell + drawer + unread count. Per-user preferences, **except two
that cannot be disabled**: `TASK_ASSIGNED` and `TASK_OVERDUE`.

Events: assigned · due soon · overdue · submitted · revision requested · approved ·
penalty applied · bonus granted · payout approved · payout paid · mention ·
extension requested/decided.

Managers additionally get a **daily digest** (08:00 Cairo): overdue, awaiting
approval, at-risk projects.

**WhatsApp:** every user card, task assignee chip, and client record renders a
WhatsApp button → `https://wa.me/<phone>?text=<url-encoded Arabic template>`.
Templates configurable in Settings. No API, no integration.

---

## 9. UI/UX direction

Reference: **ClickUp's energy, Linear's discipline.** Colorful, fast, dense where
it matters.

**The anti-slop rule: color carries meaning, chrome stays quiet.**
Surfaces are neutral zinc. Every saturated color on screen must encode data —
status, priority, health, category. Decoration never gets a color.

- **Base:** zinc scale, not pure `#fff` / `#000`. Light default, full dark mode.
- **Accent:** one violet primary for actions/focus.
- **Data palette:** distinct hues per task status and per project — the ClickUp
  feel comes from status chips, priority flags, category dots and avatar colors,
  not from gradients.
- **Banned:** gradient buttons, glassmorphism, emoji as icons, `rounded-3xl`
  everything, drop-shadow stacks, hero illustrations, "✨ AI-powered" copy,
  centered marketing layouts inside the app.
- **Type:** IBM Plex Sans Arabic. `font-variant-numeric: tabular-nums` on every
  money and duration value.
- **Layout:** right-side collapsible sidebar (RTL-correct), sticky contextual
  header, `Ctrl+K` command palette in Arabic.
- **Interaction model (your "modules" ask):** everything is edited in a **sheet or
  dialog over the current page** — click a task → detail sheet; click a user →
  profile sheet; assign, approve, penalize, pay, all without navigation. Full
  pages exist only for lists, dashboards, settings, and reports.
- **Feedback:** optimistic updates + toast, skeletons on first load only, real
  empty states with a primary action, destructive actions need typed confirmation.
- **Density toggle** (comfortable / compact) persisted per user.

**Performance budget (enforced in Phase 12):**
LCP < 1.8s on 4G · route JS < 180KB gzip · zero client-side data waterfalls ·
Server Components by default · every list paginated & indexed · virtualize any
list over 100 rows · no chart library on the initial dashboard bundle.

### How this is implemented (settled in Phase 2)

**Tokens live in `src/app/globals.css`, not in a `tailwind.config`.** Tailwind v4
has no JS config; `@theme` *is* the config. Three groups, and the separation is
load-bearing: a **surface** ramp (zinc, chrome only, never a hue), one **accent**
ramp (violet, actions and focus only), and ten **data** hues. The data hues avoid
the 275–300° band the accent occupies, so a status chip can never be mistaken for
a button.

**Colour is bound to data, not chosen.** A component declares *which datum* it is
showing — `data-hue="emerald"` — and reads `--hue-surface` / `--hue-text` /
`--hue-line` / `--hue-solid`. There is no `color` prop anywhere in the component
library. `src/lib/palette.ts` is the dictionary (status → hue, priority → hue,
ledger type → hue, and a stable hash for project/category/avatar identity); a
value with no entry there renders neutral, which is the correct outcome for
decoration.

**Contrast is asserted, not claimed.** `tests/unit/design/palette-contrast.test.ts`
parses `globals.css` and measures every pairing the components produce: text ≥
4.5:1 on its chip tint *and* on all three neutral surfaces, solid marks ≥ 3:1,
button and active-nav pairings ≥ 4.5:1, in both themes. Retuning a colour to look
nicer now costs a failing test rather than a silent regression.

**Density is a CSS-variable scale**, set as `data-density` on `<html>`. Row
height, cell padding, control height, gaps and text size all derive from it, so a
new component is dense-correct without taking a prop.

**Theme, density and sidebar state are cookies, not Settings and not columns.**
Settings are global (§7) and these are personal; nothing about a payout changes
because someone prefers compact rows. The server reads the cookies while
rendering `<html>`, so the first paint is already correct — no flash, no
correcting `useEffect`, no client JS on first paint. The trade, named
deliberately: the preference is per browser, so a second machine starts at the
default.

**Table state lives in the URL.** Page, sort, facets, search and column
visibility are inputs to a Prisma query that runs in a Server Component, so they
must survive a request. A filtered list is therefore linkable and the back button
steps through filter changes. **Saved views** are named shortcuts to such a URL,
stored per browser in `localStorage` — losing one is an inconvenience, not data
loss.

**`/design-system` is development-only** and 404s in production. It is not
permission-gated, because a permission would imply somebody could be granted it.

---

## 10. Import

`.xlsx` only. Entities: **users, clients, projects, tasks.**
Flow: download Arabic-headed template → upload → **dry-run preview**
(will create N, will update M, K invalid rows with per-row reasons) → confirm →
transactional write. Nothing persists before confirmation. Files are parsed in
memory and discarded.

---

## 11. Non-negotiable engineering invariants

1. `LedgerEntry` is append-only. No `UPDATE`, no `DELETE`. Corrections are `REVERSAL` entries.
2. Money is `Decimal`, never `float`. All arithmetic in `lib/money`.
3. Every permission check happens server-side in the query layer. UI hiding is cosmetic only.
4. Every money, permission, assignment, and status change writes an `AuditLog` row.
5. Penalty recalculation is idempotent — running the job 10× produces one penalty.
6. All dates stored UTC; all business-day math goes through `lib/calendar`.
7. No hardcoded business numbers — read from Settings.
8. Soft-delete respected by every query (Prisma middleware or explicit filters).
9. The scheduler holds a Postgres advisory lock so a restart cannot double-charge.
10. Tests never touch a database whose name doesn't end in `_test`.
