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
Task        id, projectId, milestoneId?, title, description?,
            assigneeId?, status, priority, categoryId,
            estimatedHours, taskValue,                 ← money the assignee earns
            dueDate, originalDueDate,
            assignedAt, startedAt, submittedAt, approvedAt,
            elapsedMinutesRaw, elapsedMinutesWorking,  ← denormalized, job-updated
            overdueWorkingDays, escalationLevel, escalatedAt?,  ← same (Phase 6)
            delayReason?, delayAttribution?,
            qualityRating?,                            ← 1–5, set on approval (§5.6)
            deletedAt
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
               ← NOT a table. See below.
Holiday        id, date, nameAr, isRecurring
Leave          id, userId, startDate, endDate, typeId, status, note,
               requestedById, decidedById?, decidedAt?, decisionNote?
```

**Calendar decisions settled in Phase 6**

- **`WorkCalendar` is a value object, not a model.** Weekend days, workday
  bounds and working-days-per-month are already Settings keys (`calendar.*`,
  §7), and invariant 7 says every business number comes from `lib/settings`. A
  one-row table holding the same four values would be a second authority, and
  the first time the two disagreed the penalty engine would pick one without
  anyone knowing which. `lib/calendar` materialises the Settings group into the
  shape this listing describes.
- **Holiday and Leave dates are `DATE` columns, not timestamps.** "7 يناير is a
  holiday" is true for the whole Cairo day; storing 00:00Z would make that
  statement depend on which side of midnight the reader sits.
- **`Holiday.isRecurring`** marks the fixed-Gregorian days (7 January, 25
  April, 1 May). The Islamic holidays move and are entered per year. A
  recurring row's stored year is its first occurrence; only month/day match.
- **`Holiday` has no `deletedAt`** — like `Milestone`. A soft-deleted holiday
  that one query forgot to filter would keep being a day off, which is the
  failure soft-delete exists to prevent, inverted.
- **`Leave.typeId`** is a stable id from Settings `calendar.leaveTypes`, not the
  Arabic label — the same split §7 settled for `tasks.categories`. Migrated in
  place by `20260817000000_calendar_leave_extension`.
- **`LeaveStatus` is `PENDING | APPROVED | REJECTED`.** No CANCELLED: a request
  withdrawn before a decision is rejected by whoever handles it, and a fourth
  value would be a second way to say "this leave does not apply" that every
  lateness query has to remember to exclude.
- **Only APPROVED leave reaches the calendar.** A pending request changes
  nobody's deduction until somebody with `leave.manage` says so.
- **`requestedById` is separate from `userId`** because a manager can *record*
  leave for a منفّذ rather than receive a request from them — the difference
  between "أحمد asked for Thursday off" and "أحمد was out sick and المدير
  logged it".

### Money — immutable ledger

```
LedgerEntry  id, userId, cycleId?, type, amount(signed Decimal 12,2),
             taskId?, note, isAutoGenerated, reversesEntryId?,
             createdById, createdAt          ← INSERT ONLY
             type ∈ EARNING | SALARY | PENALTY | BONUS | ADVANCE
                     | ADJUSTMENT | PAYOUT | REVERSAL

PayoutCycle  id, periodStart, periodEnd, status(OPEN|CLOSED|PAID), closedAt,
             closedById?
Payout       id, userId, cycleId, carriedForward, gross, penalties, bonuses,
             advances, adjustments, net,
             status(DRAFT|APPROVED|PAID), paidAmount, method, reference, note,
             approvedById, approvedAt, paidById, paidAt
PenaltyProfile id, name, mode, value, graceHours, isDefault
             mode ∈ FIXED_PER_DAY | PCT_TASK_VALUE_PER_DAY
                    | PCT_DAILY_RATE_PER_DAY | FIXED_ONCE | PCT_TASK_VALUE_ONCE
PaymentMethod  ← NOT a table. See below.
```

**Balance is always `SUM(amount)`.** There is no mutable balance column anywhere.

**Money decisions settled in Phase 7**

- **Append-only is enforced by the database**, not only by review. Two `BEFORE`
  triggers on `ledger_entries` reject `UPDATE` and `DELETE` outright, and their
  message names the `REVERSAL` that is the correct instrument instead. Three
  partial unique indexes carry the rest of the arithmetic: one `EARNING` per
  task, one `SALARY` per (worker, cycle), one `OPEN` cycle at a time. None of
  the four can be expressed in Prisma's schema language — they live in
  `20260818000000_money_ledger_payouts` and are listed at the bottom of
  `schema.prisma` so a future `migrate dev` does not quietly drop them.
- **The sign lives in the amount.** Credits to the منفّذ are positive, debits
  negative, fixed per type in `modules/ledger/sign.ts` and validated on the one
  write path. There is no `direction` column, because a second representation of
  the sign is a second thing that can disagree with the first — and every query
  that adds money up would then need to know which types to subtract.
- **Zero-amount entries are refused.** A movement that moves nothing is not a
  movement; approving a task worth `0.00` writes an audit row explaining that
  nobody was paid, rather than a row of noise on the منفّذ's statement.
- **`PaymentMethod` is not a table**, resolving the contradiction between this
  listing and §7. §7 settled that `payout.paymentMethods` is "the one remaining
  plain list of Arabic strings, and correctly so — nothing stores a reference to
  it", and that stays true: `Payout.method` is a **snapshot of the label chosen
  at payment time**, not a foreign key. A payment record must keep saying
  "فودافون كاش" after the operator renames the entry.
- **Three columns added to the `Payout` listing**, each so the figure reconciles
  on screen rather than only inside the service: `carriedForward` (the balance
  brought in — SPEC §5.4 promises this carry-forward and this is where it
  becomes visible), `adjustments` (signed; they move `net`, so a breakdown that
  omitted them would not add up), and the `approvedAt`/`paidById` counterparts
  of the `approvedById`/`paidAt` already listed. The identity the service
  maintains and the tests assert:

  `net = max(0, carriedForward + gross − penalties + bonuses − advances + adjustments)`

- **`LedgerEntry.cycleId` is attribution, not arithmetic.** It is stamped from
  the open cycle at insert. The money is computed from the balance, so an entry
  landing on the far side of a cycle boundary changes which statement it is
  *listed* on and never how much anybody is paid.

### Enums

```
ProjectStatus  DRAFT PROPOSED ACTIVE ON_HOLD IN_REVIEW COMPLETED CANCELLED ARCHIVED
TaskStatus     BACKLOG ASSIGNED IN_PROGRESS SUBMITTED IN_REVIEW
               REVISION_REQUESTED APPROVED DONE BLOCKED CANCELLED
Priority       LOW MEDIUM HIGH URGENT
EngagementType FIXED_PRICE RETAINER MILESTONE_BASED HOURLY   ← chosen per project
DelayAttribution WORKER CLIENT INTERNAL DEPENDENCY
LeaveStatus      PENDING APPROVED REJECTED                   ← Phase 6
ExtensionStatus  PENDING APPROVED REJECTED
EscalationLevel  NONE PM ADMIN                               ← §8 thresholds
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

**How the machine is read (settled in Phase 4, `modules/task/state-machine.ts`)**

- **`any(active)` is narrower than `any(non-final)`.** Two adjacent lines use two
  different words, so they name two different sets. *Active* — and therefore
  blockable — is work in flight: `BACKLOG` through `REVISION_REQUESTED`. An
  `APPROVED` task is finished being worked on; blocking it would say nothing.
  *Non-final* is everything except `DONE` and `CANCELLED`.
- **`APPROVED → CANCELLED` is therefore legal**, and it is the one cancellation
  that can land *after* an `EARNING` exists. Cancellation emits a
  `TaskCancelled` domain event carrying `wasApproved`, which Phase 7 subscribes
  to for the `REVERSAL`. Quietly making `APPROVED` uncancellable would have
  dodged the money question rather than answered it.
- **There is no `ASSIGNED → BACKLOG`, so there is no "unassign".** Only the
  transitions listed above are legal, and adding an eleventh edge for a
  convenience action would stop this list being the contract. A wrong assignment
  is corrected by reassigning (`assignTask`) or by cancelling.
- **Timestamps stamp once, except `submittedAt`.** `assignedAt`, `startedAt` and
  `approvedAt` are never overwritten — re-entering `IN_PROGRESS` after a revision
  does not mean the work started again. `submittedAt` tracks the latest delivery
  (which is what the current revision's lateness is measured against under T4),
  and the first one survives as the `createdAt` of the first
  `STATUS_CHANGED → SUBMITTED` activity row.
- **`BLOCKED → previous` reads the activity feed**, not a column. `TaskActivity`
  already records every status change with its `from`; a `statusBeforeBlock`
  column would be a second copy of the same fact and a second thing that can be
  wrong. This makes the feed load-bearing, not decorative.
- **Elapsed time is written in two places.** `elapsedMinutesRaw` is stamped on
  submission (pure arithmetic). `elapsedMinutesWorking` is the job-updated column
  §4 calls it, written by `recomputeElapsed` once `lib/calendar` exists (Phase 6).

### 5.2 Elapsed time

- `elapsedMinutesRaw = submittedAt − assignedAt` (wall clock).
- `elapsedMinutesWorking` excludes weekends, holidays, and the assignee's approved leave.
- **Edge case (T2):** if a worker submits on a weekend/holiday, that is allowed and the submission timestamp is real. Working-time simply does not accrue on that day, so it cannot increase the penalty. Working *voluntarily* on a day off never hurts and never helps.

### 5.3 Lateness

- Measured at `submittedAt` vs `dueDate`. Time sitting in review **never** counts against the worker.
- `lateWorkingDays = workingDaysBetween(dueDate + grace, min(now, submittedAt))`
  **− the working days in that window the task spent `BLOCKED`.**
- Grace: project override → global default.
- An **approved extension** moves `dueDate`, keeps `originalDueDate`, and voids/recomputes any penalty accrued past the new date.
- Approved leave never generates lateness.
- **Time spent `BLOCKED` never generates lateness.**

**How that formula is read (settled in Phase 6, `modules/lateness/service.ts`)**

- **A working day counts when its own Cairo start falls in the half-open
  `[dueDate + grace, measuredAt)` range.** Everything the SPEC asks for falls
  out of that one rule with no special cases: due-and-submitted at the same
  instant is 0, one minute late is still 0, and each further midnight crossed
  into a working day adds exactly one. §5.2's T2 edge case is the same rule
  seen from the other side — moving a submission anywhere inside a weekend, a
  holiday or approved leave changes nothing, because those days contribute no
  boundary.
- **Grace is a duration, not working days.** 24 hours of grace on a Thursday
  deadline expires on the Friday even though Friday is not a working day; the
  working-day filter applies to what comes *after* the grace, not to the grace.
- **What stops the clock is delivery, not review.** `measuredAt` is
  `min(now, submittedAt)` exactly while the task is *delivered* — SUBMITTED,
  IN_REVIEW, APPROVED, DONE — and `now` otherwise. This is the same set
  `modules/task` computes its `isOverdue` flag from, deliberately: a task
  flagged overdue in the list and showing zero in the penalty breakdown would
  be a support ticket every week.
- **`REVISION_REQUESTED` restarts the clock** against the new due date (T4).
  The previous `submittedAt` is the *last* delivery, not a delivery of this
  revision, so freezing on it would make every revision costless. Falling out
  of the delivered set handles that with no special case.
- **`CANCELLED` is always zero.** A cancelled task is not late; it is gone.
- **`min(now, submittedAt)` is taken literally.** Clock skew between two
  containers must never manufacture days of lateness.

**`BLOCKED` pauses the clock — the operator's decision, taken in Phase 6.**
A منفّذ who cannot work cannot be late for not working, and this product exists
to make deductions defensible rather than merely automatic. The rule:

- **The exclusion is by *interval*, never by current status.** A task blocked
  for a week and then resumed still has that week excused; a task blocked today
  after three weeks overdue still owes the three weeks. Both readings of
  "skip it while `status === 'BLOCKED'`" are wrong, in opposite directions.
- **The intervals come from `TaskActivity`** — the `STATUS_CHANGED → BLOCKED`
  and `BLOCKED → …` rows §5.1 already makes load-bearing for `BLOCKED →
  previous`. There is no `blockedMinutes` column, for the same reason there is
  no `statusBeforeBlock` one.
- **Mechanically it is a subtraction**, and both halves go through the same
  `workingDaysBetween` with the same assignee. So a blocked Friday, a blocked
  holiday and a blocked day of approved leave are each worth zero on *both*
  sides and cannot be excused twice. Every other rule in this section survives
  untouched, by construction rather than by special-casing.
- **A day counts when its own start falls in the window**, so a block that
  begins at 09:00 does not un-count the day that had already begun. The منفّذ
  had that morning.
- **A task blocked out of a delivered status stays delivered.** The open
  interval carries the status it was blocked *from*, so blocking a task that is
  sitting in review does not restart the worker's clock — which is what the
  review rule above already forbids.
- **`Task.isOverdue` in list views deliberately does not read this.** It is a
  cheap "past the deadline and not yet delivered" flag on a row that has not
  loaded an activity feed, and a blocked task genuinely *is* past its deadline
  and worth showing as such. The money figure is `lateWorkingDays`, and the
  task sheet shows both, with `blockedWorkingDays` naming the difference.

**Extension requests (Phase 6).** The assignee raises one with a mandatory
reason; `task.extend` decides it. `oldDueDate` is the optimistic-concurrency
check: if the deadline moved between request and decision (a revision, another
extension), the request is stale and is refused rather than silently
overwriting the newer decision. A task that has already been delivered cannot
be extended — moving a line the منفّذ has already crossed is not an extension,
it is a retroactive pardon, and this product calls those reversals (§5.4).

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

**How the close is read (settled in Phase 7, `modules/payout/service.ts`)**

- **`net` is the balance at the moment of close, minus what earlier payouts
  still claim, floored at zero.** "SUM of all unpaid entries in period" and "the
  balance" agree exactly whenever the previous cycle was paid in full, and where
  they differ the balance is the correct one. Reading it this way is what makes
  three separate promises need no code at all: the payout that never goes
  negative (§5.4), the advance that settles itself, and the partial payment
  whose remainder stays outstanding. A per-period net would need bespoke
  carry-forward logic for each, and a bug in any one of them loses somebody's
  money quietly.
- **The claims subtraction is not optional.** A payout that is drafted or
  approved and not yet paid still leaves its money in the balance, so without
  it the next close would draft the same money a second time — the ordinary
  case of a disputed month or an absent finance user, not an exotic one. Every
  outstanding payout together therefore claims **at most** the منفّذ's balance,
  which is the invariant that makes both screens' totals true.
- **A deduction recorded after a close never shrinks an approved payout.** §5.4
  says the surplus carries to the *next* cycle, and Phase 8's engine writes
  penalties after a close routinely. The payment path validates against the
  payout's own remainder, never against the live balance.
- **A payment appends a negative `PAYOUT` entry**, attributed to the cycle it
  settles. So the remainder is not a column: it is simply still in the balance,
  and it turns up in the next cycle by itself. `SUM(PAYOUT entries)` for a
  (منفّذ, cycle) always equals `−paidAmount`.
- **Closing is refused three ways**, because closing opens the next cycle
  immediately and a second close would settle a zero-length one: `already-closed`,
  `not-started` (the cycle's `periodStart` has not passed), and `not-due` (it has
  not reached `periodEnd` and the caller did not ask for an early close). The
  scheduler never asks, so the unattended path cannot make that mistake at all;
  the early close is the permissioned decision this section already describes.
- **`periodEnd` is the plan and `closedAt` is the fact**, and they are not
  collapsed. The next cycle starts at the fact, so no instant belongs to two
  cycles; the plan survives so that a cycle closed late still knows which month
  it was *for*. Overwriting the plan costs a salaried منفّذ a whole month's pay
  the first time a close runs late — the accrual's month test is anchored on
  `min(closedAt, periodEnd)` for exactly that reason.
- **Salary is at most one entry per cycle *and* per Cairo month.** The per-cycle
  rule is what this section says; the per-month rule is what "monthly salary"
  means, and it is the one that holds when an operator deliberately closes twice
  in August. The first is a unique index, the second a guard in the accrual.
- **Approved leave is paid in full, and the absence of proration is the
  feature.** Nothing in the accrual reads the calendar or asks `modules/leave`
  anything, and a test asserts it — so the first person to reach for
  `workingDaysBetween` there is contradicted by a failing test rather than by a
  comment.
- **A worker is paid what they are owed even with no movements this cycle.** The
  close drafts a payout for anyone with entries in the cycle *or* a non-zero
  balance, so a carried debt stays visible every month instead of only in the
  month it was incurred.

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

`RED` if any: overdue tasks > threshold, project past `dueDate`, blocked > N days,
**or any task escalated to admin level** (§8, added in Phase 6).
`AMBER` if approaching. Manual override with mandatory reason.

**Why escalation is a signal and not an override (settled in Phase 6).** The
phase brief says admin-level escalation "forces project health RED".
`healthOverride` means *a human decided this* and carries a mandatory reason, so
a nightly job writing to it would erase whichever manager had set it and make
"manual override" a lie. Escalation is instead a fourth input to
`computeProjectHealth`, counted with an indexed query on `Task.escalationLevel`.

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

**Three Phase-6 reads that no key in this catalog covers, and how they are gated:**

- **Reading holidays** — `requireAuth`, no permission. Which days the agency is
  closed is not confidential, every منفّذ needs it to read their own deadlines,
  and there is no `calendar.view` key. Writing them needs `calendar.manage`.
- **Reading leave** — `leave.view` (or `leave.manage`) sees everyone; everybody
  else sees **their own**. A منفّذ who cannot see the request they filed cannot
  tell whether Thursday is approved. This applies the scoping rule's intent to
  the one entity whose "assigned" simply means "mine".
- **Requesting leave or an extension** — `requireAuth` plus an ownership check
  in the service. There is no key for "ask for time off", and inventing one
  would be inventing a permission. A `leave.manage` holder may file for someone
  else (and it lands APPROVED, because they have already decided); a
  `task.extend` holder may raise a request on a task that is not theirs.

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

**Taxonomy settings carry an id, not just a label (settled in Phase 4).**
`tasks.categories` is a list of `{ id, label }` — a stable latin kebab-case
identifier plus the editable Arabic name. `Task.categoryId` stores the id, so
renaming a category in Settings is a label change and not a silent
re-categorisation of every task ever filed under it. It is the same split §2
already makes for statuses ("Arabic labels are editable; the enum values are
not"), applied to a list the operator also creates entries in.

**`calendar.leaveTypes` followed in Phase 6**, for the same reason and with the
same shape: `Leave.typeId` stores the id, so renaming "إجازة طارئة" does not
re-type every leave ever recorded under it. `payout.paymentMethods` is the one
remaining plain list of Arabic strings, and correctly so — nothing stores a
reference to it.

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
default. Phase 5's per-user task view preference (board/list/calendar,
`agency_task_view`) follows the same cookie shape and the same trade, for the
same reason — it is not business data, and there is no per-user preference
table in the schema to put it in instead. The URL's `?view=` always wins when
present, so the cookie is only what a fresh visit falls back to.

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
